// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AlphaMarketsVault} from "./AlphaMarketsVault.sol";

/// @notice The protocol's loss buffer, the last step of the clearing waterfall (PROJECT_BRIEF.md
/// Section 40, "clearing infrastructure"). When a liquidated position has lost more than its owner
/// holds, the shortfall is paid from this fund's Vault balance instead of being left unbacked, and
/// only what the fund cannot cover is bad debt.
///
/// The fund is an ordinary account in the Vault: it holds a ledger balance in the settlement token,
/// plus any other collateral seized from an under-margined cross account (see CrossMarginManager).
/// Anyone can top it up. Only FUND_ADMIN_ROLE takes money out, and it is meant to sit behind a
/// multisig and a timelock before mainnet (Section 37).
contract InsuranceFund is UpgradeableBase, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant FUND_ADMIN_ROLE = keccak256("FUND_ADMIN_ROLE");

    AlphaMarketsVault public immutable vault;
    address public immutable settlementToken;

    error ZeroAddress();
    error ZeroAmount();

    event Deposited(address indexed from, address indexed token, uint256 amount);
    event Withdrawn(address indexed to, address indexed token, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address vault_, address settlementToken_) {
        if (vault_ == address(0) || settlementToken_ == address(0)) revert ZeroAddress();
        vault = AlphaMarketsVault(vault_);
        settlementToken = settlementToken_;
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        __UpgradeableBase_init(admin);
        __ReentrancyGuard_init();
        _grantRole(FUND_ADMIN_ROLE, admin);
    }

    /// @notice Adds `amount` of `token` (a supported collateral token) to the fund. Caller approves
    /// this contract first.
    function deposit(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(token).forceApprove(address(vault), amount);
        vault.deposit(token, amount);
        emit Deposited(msg.sender, token, amount);
    }

    function withdraw(address token, address to, uint256 amount) external onlyRole(FUND_ADMIN_ROLE) nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        vault.withdraw(token, amount);
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(to, token, amount);
    }

    /// @notice What the fund holds of `token` in the Vault.
    function balance(address token) external view returns (uint256) {
        return vault.availableBalance(address(this), token);
    }
}
