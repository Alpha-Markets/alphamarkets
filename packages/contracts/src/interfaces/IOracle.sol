// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Price abstraction distinguishing the 4 price types Orionis relies on:
/// Index (reference underlying price), Mark (used for PnL/margin/liquidation/risk),
/// Last (most recent executed derivatives price), Settlement (validated expiry price).
interface IOracle {
    function getPrice(bytes32 asset) external view returns (uint256 price, uint256 timestamp);

    function getIndexPrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp);

    function getMarkPrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp);

    function getLastPrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp);

    function getSettlementPrice(bytes32 marketId, uint256 expiry)
        external
        view
        returns (uint256 price, uint256 timestamp);
}
