// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Consulted by the Vault before a withdrawal. It reverts when taking `amount` of `token`
/// out would leave the user's account under-margined (see CrossMarginManager).
interface IWithdrawGuard {
    function check(address user, address token, uint256 amount) external view;
}
