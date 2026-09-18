// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Collateral/settlement surface consumed by the options and perps engines,
/// the funding manager, and the liquidation engine. OrionisVault is the sole implementer.
interface IOrionisVault {
    function lockMargin(address user, address token, uint256 amount) external;

    function releaseMargin(address user, address token, uint256 amount) external;

    function settlePnl(address user, address token, int256 amount) external;

    function transferFundingPayment(address payer, address receiver, address token, uint256 amount) external;

    function transferFee(address user, address token, uint256 amount, bytes32 feeType) external;

    function availableBalance(address user, address token) external view returns (uint256);
}
