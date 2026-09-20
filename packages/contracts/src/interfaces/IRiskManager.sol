// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Per-market risk config and enforcement checks, consumed by OptionsEngine,
/// PerpsEngine, and LiquidationEngine so no engine hardcodes its own limits (Section 19).
/// Not one of the 5 interfaces named in PROJECT_BRIEF.md Section 6 — added so engines
/// depend on an interface rather than the concrete RiskManager contract.
interface IRiskManager {
    function checkLeverage(bytes32 marketId, uint256 leverage) external view;

    /// @notice Reverts unless `size / collateral` stays within the market's maximum leverage. Used
    /// where a position's leverage is a result rather than a chosen tier (increasing a position).
    function checkResultingLeverage(bytes32 marketId, uint256 size, uint256 collateral) external view;

    function checkPositionSize(bytes32 marketId, uint256 notional) external view;

    function checkOpenInterest(bytes32 marketId, bool isLong, uint256 notionalDelta) external view;

    function checkMargin(uint256 collateral, uint256 requiredMargin) external pure;

    function recordOpenInterestDelta(bytes32 marketId, bool isLong, int256 notionalDelta) external;

    function maxLeverage(bytes32 marketId) external view returns (uint256);

    function maintenanceMarginRateBps(bytes32 marketId) external view returns (uint256);
}
