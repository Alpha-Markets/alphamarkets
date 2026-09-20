// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOrionisVault} from "../interfaces/IOrionisVault.sol";
import {IWithdrawGuard} from "../interfaces/IWithdrawGuard.sol";
import {CollateralManager} from "./CollateralManager.sol";

/// @notice The collateral and settlement layer (PROJECT_BRIEF.md Section 7): deposits,
/// withdrawals, locked margin, available balance, PnL settlement, funding transfers, and
/// fee transfers. Raw ledger balances live in CollateralManager; this contract holds actual
/// token custody and enforces locking/withdrawal rules on top of that ledger.
contract OrionisVault is IOrionisVault, AccessControl, ReentrancyGuard {
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

    event WithdrawGuardUpdated(address indexed guard);

    error InsufficientCollateral();
    error ZeroAddress();
    error ZeroAmount();

    event CollateralDeposited(address indexed user, address indexed token, uint256 amount);
    event CollateralWithdrawn(address indexed user, address indexed token, uint256 amount);

    constructor(address admin, address collateralManager_) {
        if (admin == address(0) || collateralManager_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VAULT_ADMIN_ROLE, admin);
        collateralManager = CollateralManager(collateralManager_);
    }

    // ---------------------------------------------------------------------
    // User-facing custody
    // ---------------------------------------------------------------------

    function deposit(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        collateralManager.deposit(msg.sender, token, amount);
        emit CollateralDeposited(msg.sender, token, amount);
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
    /// Positive credits the user; negative debits them. The protocol's shared custody pool
    /// backs this — solvency is enforced upstream by RiskManager/LiquidationEngine, not here.
    function settlePnl(address user, address token, int256 amount) external onlyRole(ENGINE_ROLE) {
        if (amount > 0) {
            collateralManager.deposit(user, token, uint256(amount));
        } else if (amount < 0) {
            collateralManager.withdraw(user, token, uint256(-amount));
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
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function availableBalance(address user, address token) public view returns (uint256) {
        uint256 balance = collateralManager.balanceOf(user, token);
        uint256 locked = lockedMargin[user][token];
        if (locked >= balance) return 0;
        return balance - locked;
    }
}
