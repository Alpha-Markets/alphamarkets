// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Tracks which tokens are accepted as collateral and per-user/per-token ledger
/// balances. Deliberately holds no tokens itself and does no custody — OrionisVault holds
/// actual token custody and is the only account permitted to move ledger balances here,
/// keeping token-support rules separate from settlement logic (PROJECT_BRIEF.md Section 7).
contract CollateralManager is AccessControl {
    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    mapping(address => bool) public supportedTokens;
    mapping(address => mapping(address => uint256)) public balances;

    error UnsupportedToken(address token);
    error ZeroAddress();

    event SupportedTokenAdded(address indexed token);
    event SupportedTokenRemoved(address indexed token);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VAULT_ADMIN_ROLE, admin);
    }

    function addSupportedToken(address token) external onlyRole(VAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        supportedTokens[token] = true;
        emit SupportedTokenAdded(token);
    }

    function removeSupportedToken(address token) external onlyRole(VAULT_ADMIN_ROLE) {
        supportedTokens[token] = false;
        emit SupportedTokenRemoved(token);
    }

    /// @notice Credits `amount` to `user`'s ledger balance for `token`. Called by
    /// OrionisVault both for real deposits and for ledger-only credits (PnL, funding).
    function deposit(address user, address token, uint256 amount) external onlyRole(VAULT_ROLE) {
        if (!supportedTokens[token]) revert UnsupportedToken(token);
        balances[user][token] += amount;
    }

    /// @notice Debits `amount` from `user`'s ledger balance for `token`. Reverts on
    /// underflow if `amount` exceeds the tracked balance. Called by OrionisVault both for
    /// real withdrawals and for ledger-only debits (PnL, funding, fees).
    function withdraw(address user, address token, uint256 amount) external onlyRole(VAULT_ROLE) {
        balances[user][token] -= amount;
    }

    function balanceOf(address user, address token) external view returns (uint256) {
        return balances[user][token];
    }
}
