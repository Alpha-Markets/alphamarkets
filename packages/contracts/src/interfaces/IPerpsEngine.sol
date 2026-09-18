// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice External surface for opening, increasing, reducing, and closing perpetual positions.
/// Every price-sensitive action carries a deadline and a slippage bound (Section 36 requirement).
interface IPerpsEngine {
    /// @param limitPrice Worst acceptable entry price: an upper bound when `isLong` is true,
    /// a lower bound when `isLong` is false.
    function openPosition(
        bytes32 marketId,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 limitPrice,
        uint256 deadline
    ) external returns (uint256 positionId);

    /// @param limitPrice Worst acceptable price for the added size: an upper bound for a
    /// long position, a lower bound for a short position.
    function increasePosition(
        uint256 positionId,
        uint256 addCollateral,
        uint256 addSize,
        uint256 limitPrice,
        uint256 deadline
    ) external;

    /// @param limitPrice Worst acceptable exit price: a lower bound for a long position,
    /// an upper bound for a short position.
    function reducePosition(uint256 positionId, uint256 sizeDelta, uint256 limitPrice, uint256 deadline) external;

    /// @param limitPrice Worst acceptable exit price, direction as in {reducePosition}.
    function closePosition(uint256 positionId, uint256 limitPrice, uint256 deadline) external;
}
