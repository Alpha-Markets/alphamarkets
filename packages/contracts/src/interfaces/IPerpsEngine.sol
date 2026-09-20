// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TriggerKind} from "./DataTypes.sol";

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

    /// @notice Like {openPosition}, but the position is backed by the whole account (cross margin).
    function openPositionCross(
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

    /// @notice Places a resting order that opens a position once the mark price reaches
    /// `triggerPrice` (at or below it for a long, at or above it for a short).
    function placeLimitOrder(
        bytes32 marketId,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 expiry
    ) external returns (uint256 orderId);

    /// @notice Cancels an open order; only its owner can.
    function cancelLimitOrder(uint256 orderId) external;

    /// @notice Fills an open order whose trigger has been reached. Callable by anyone.
    function executeLimitOrder(uint256 orderId) external returns (uint256 positionId);

    /// @notice Attaches a stop-loss or take-profit to an open position; see the engine for the
    /// side each kind must sit on relative to the current mark price.
    function placeTriggerOrder(uint256 positionId, TriggerKind kind, uint256 triggerPrice, uint256 expiry)
        external
        returns (uint256 orderId);

    /// @notice Cancels an open trigger order; only its owner can.
    function cancelTriggerOrder(uint256 orderId) external;

    /// @notice Closes the position of an open trigger order whose trigger has been reached.
    /// Callable by anyone.
    function executeTriggerOrder(uint256 orderId) external;
}
