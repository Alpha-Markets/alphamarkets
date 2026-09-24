// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAlphaMarketsVault} from "../interfaces/IAlphaMarketsVault.sol";
import {IWithdrawGuard} from "../interfaces/IWithdrawGuard.sol";
import {CollateralManager} from "./CollateralManager.sol";

/// @notice The collateral and settlement layer (PROJECT_BRIEF.md Section 7): deposits,
/// withdrawals, locked margin, available balance, PnL settlement, funding transfers, and
/// fee transfers. Raw ledger balances live in CollateralManager; this contract holds actual
/// token custody and enforces locking/withdrawal rules on top of that ledger.
contract AlphaMarketsVault is IAlphaMarketsVault, UpgradeableBase, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Granted to OptionsEngine, PerpsEngine, LiquidationEngine, FundingManager —
    /// the contracts permitted to move margin/PnL/funding on a user's behalf.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");
    /// @notice Granted only to FeeManager — the sole caller permitted to pull fees.
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");

    CollateralManager public immutable collateralManager;

    mapping(address => mapping(address => uint256)) public lockedMargin;

    /// @notice Optional check run before every withdrawal: it keeps a cross-margin account from
    /// withdrawing the free balance that backs its positions. Zero means no check.
    IWithdrawGuard public withdrawGuard;

    /// @notice The sum of every account's ledger balance in `token`, kept by this contract on each ledger
    /// change (only the vault can write to CollateralManager). It is what the vault owes its users.
    /// Appended after `withdrawGuard`, so it does not move any existing storage slot.
    mapping(address => uint256) public totalLiabilities;
    /// @notice Whether `bootstrapLiabilities` was used for a token. See that function.
    mapping(address => bool) public liabilitiesBootstrapped;

    event WithdrawGuardUpdated(address indexed guard);
    /// @notice Capital added to the pool that backs trader profit. It is credited to no account.
    event PoolFunded(address indexed funder, address indexed token, uint256 amount);

    event LiabilitiesBootstrapped(address indexed token, uint256 amount);

    error AlreadyTracked();
    error InsufficientCollateral();
    /// @notice A profit credit was refused because the tokens the vault holds would no longer cover what
    /// it owes. `available` is the pool balance at that moment, `needed` the credit asked for.
    error InsufficientPoolReserves(uint256 needed, uint256 available);
    error ZeroAddress();
    error ZeroAmount();

    event CollateralDeposited(address indexed user, address indexed token, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed token, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address collateralManager_) {
        if (collateralManager_ == address(0)) revert ZeroAddress();
        collateralManager = CollateralManager(collateralManager_);
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        __UpgradeableBase_init(admin);
        __ReentrancyGuard_init();
        _grantRole(VAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // User-facing custody
    // ---------------------------------------------------------------------

    function deposit(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        collateralManager.deposit(msg.sender, token, amount);
        totalLiabilities[token] += amount;
        emit CollateralDeposited(msg.sender, token, amount);
    }

    /// @notice Adds capital to the pool that pays trader profit, without crediting any account. Anyone
    /// may add to it (the treasury at launch, liquidity providers later). The vault is the counterparty
    /// to every position, and a winner is paid from this pool while the loser's side is still unrealized.
    /// Pool funds leave only as payouts to traders: there is deliberately no admin function to take
    /// them out.
    function fundPool(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, token, amount);
    }

    /// @notice Only for a vault that was upgraded from code that did not count `totalLiabilities`, so its
    /// users already hold ledger balances the counter has not seen. Sets the counter to every token the
    /// vault holds, which counts the whole balance as owed and the pool as empty: the safe side, since the
    /// true figure cannot be above it. Usable once per token, and only while the counter is still zero.
    /// A vault deployed with this code never needs it.
    function bootstrapLiabilities(address token) external onlyRole(VAULT_ADMIN_ROLE) {
        if (liabilitiesBootstrapped[token] || totalLiabilities[token] != 0) revert AlreadyTracked();
        liabilitiesBootstrapped[token] = true;
        uint256 held = IERC20(token).balanceOf(address(this));
        totalLiabilities[token] = held;
        emit LiabilitiesBootstrapped(token, held);
    }

    function setWithdrawGuard(address guard) external onlyRole(VAULT_ADMIN_ROLE) {
        withdrawGuard = IWithdrawGuard(guard);
        emit WithdrawGuardUpdated(guard);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > availableBalance(msg.sender, token)) revert InsufficientCollateral();
        if (address(withdrawGuard) != address(0)) withdrawGuard.check(msg.sender, token, amount);

        collateralManager.withdraw(msg.sender, token, amount);
        totalLiabilities[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, token, amount);
    }

    // ---------------------------------------------------------------------
    // Engine-only margin/PnL/funding movement
    // ---------------------------------------------------------------------

    function lockMargin(address user, address token, uint256 amount) external onlyRole(ENGINE_ROLE) {
        if (amount > availableBalance(user, token)) revert InsufficientCollateral();
        lockedMargin[user][token] += amount;
    }

    function releaseMargin(address user, address token, uint256 amount) external onlyRole(ENGINE_ROLE) {
        lockedMargin[user][token] -= amount;
    }

    /// @notice Applies a signed realized-PnL adjustment to `user`'s ledger balance.
    /// Positive credits the user; negative debits them.
    ///
    /// A credit is a payout from the pool, so it reverts with {InsufficientPoolReserves} unless the tokens
    /// the vault holds still cover everything it owes afterwards. A debit is a loss the pool keeps, which
    /// adds to the pool. This is what stops the vault from owing more than it holds, which would leave
    /// the last users to withdraw unable to.
    function settlePnl(address user, address token, int256 amount) external onlyRole(ENGINE_ROLE) {
        if (amount > 0) {
            uint256 credit = uint256(amount);
            uint256 held = IERC20(token).balanceOf(address(this));
            uint256 owed = totalLiabilities[token];
            if (owed + credit > held) revert InsufficientPoolReserves(credit, held > owed ? held - owed : 0);
            collateralManager.deposit(user, token, credit);
            totalLiabilities[token] = owed + credit;
        } else if (amount < 0) {
            uint256 debit = uint256(-amount);
            collateralManager.withdraw(user, token, debit);
            totalLiabilities[token] -= debit;
        }
    }

    function transferFundingPayment(address payer, address receiver, address token, uint256 amount)
        external
        onlyRole(ENGINE_ROLE)
    {
        if (amount == 0) return;
        collateralManager.withdraw(payer, token, amount);
        collateralManager.deposit(receiver, token, amount);
    }

    /// @notice Debits `amount` from `user`'s ledger and transfers the underlying token to
    /// the caller (FeeManager), which routes it onward per its own fee/buyback config.
    function transferFee(
        address user,
        address token,
        uint256 amount,
        bytes32 /* feeType */
    )
        external
        onlyRole(FEE_MANAGER_ROLE)
    {
        if (amount == 0) return;
        collateralManager.withdraw(user, token, amount);
        totalLiabilities[token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice The tokens the vault holds beyond what it owes its users: seeded capital, plus the losses and
    /// fees it has kept, minus what it paid out. A profit credit larger than this reverts.
    function poolBalance(address token) external view returns (uint256) {
        uint256 held = IERC20(token).balanceOf(address(this));
        uint256 owed = totalLiabilities[token];
        return held > owed ? held - owed : 0;
    }

    function availableBalance(address user, address token) public view returns (uint256) {
        uint256 balance = collateralManager.balanceOf(user, token);
        uint256 locked = lockedMargin[user][token];
        if (locked >= balance) return 0;
        return balance - locked;
    }
}
