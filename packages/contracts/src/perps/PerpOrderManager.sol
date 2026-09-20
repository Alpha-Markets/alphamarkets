// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {TriggerKind} from "../interfaces/DataTypes.sol";

/// @notice Resting limit-order and trigger-order (stop-loss, take-profit) storage only
/// (PROJECT_BRIEF.md Section 39). It holds no funds and
/// no pricing logic: PerpsEngine validates, fills and cancels orders, this contract records them.
/// An order reserves nothing in the Vault; the collateral is taken when the order fills, so an
/// order whose owner has withdrawn the money simply cannot fill (and can be cancelled or left to
/// expire).
contract PerpOrderManager is AccessControl {
    /// @notice Granted to PerpsEngine.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    enum OrderStatus {
        OPEN,
        EXECUTED,
        CANCELLED
    }

    struct LimitOrder {
        bytes32 marketId;
        bool isLong;
        /// @dev Margin to post when the order fills, settlement-token units.
        uint256 collateral;
        uint256 leverage;
        /// @dev Worst acceptable entry price, 18 decimals: a long fills at or below it, a short at
        /// or above it.
        uint256 triggerPrice;
        /// @dev Unix seconds after which the order can no longer fill.
        uint256 expiry;
        address owner;
        OrderStatus status;
        /// @dev Set when the order fills; 0 until then.
        uint256 positionId;
    }

    /// @notice A stop-loss or take-profit attached to an open position. It closes the whole
    /// position at the mark price once the trigger is reached. Ids are separate from limit orders.
    struct TriggerOrder {
        uint256 positionId;
        TriggerKind kind;
        /// @dev Mark price that fires the order, 18 decimals. For a long a stop-loss sits below the
        /// mark at placement and a take-profit above it; a short is the mirror image.
        uint256 triggerPrice;
        /// @dev Unix seconds after which the order can no longer fire.
        uint256 expiry;
        address owner;
        OrderStatus status;
    }

    error OrderNotFound(uint256 orderId);

    mapping(uint256 => LimitOrder) private _orders;
    mapping(address => uint256[]) private _userOrders;
    uint256 public nextOrderId;

    mapping(uint256 => TriggerOrder) private _triggerOrders;
    mapping(address => uint256[]) private _userTriggerOrders;
    uint256 public nextTriggerOrderId;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function createOrder(LimitOrder calldata order) external onlyRole(ENGINE_ROLE) returns (uint256 orderId) {
        orderId = ++nextOrderId;
        _orders[orderId] = order;
        _userOrders[order.owner].push(orderId);
    }

    function markExecuted(uint256 orderId, uint256 positionId) external onlyRole(ENGINE_ROLE) {
        LimitOrder storage order = _orders[orderId];
        if (order.owner == address(0)) revert OrderNotFound(orderId);
        order.status = OrderStatus.EXECUTED;
        order.positionId = positionId;
    }

    function markCancelled(uint256 orderId) external onlyRole(ENGINE_ROLE) {
        LimitOrder storage order = _orders[orderId];
        if (order.owner == address(0)) revert OrderNotFound(orderId);
        order.status = OrderStatus.CANCELLED;
    }

    function getOrder(uint256 orderId) external view returns (LimitOrder memory) {
        return _orders[orderId];
    }

    function getUserOrders(address user) external view returns (uint256[] memory) {
        return _userOrders[user];
    }

    function createTriggerOrder(TriggerOrder calldata order) external onlyRole(ENGINE_ROLE) returns (uint256 orderId) {
        orderId = ++nextTriggerOrderId;
        _triggerOrders[orderId] = order;
        _userTriggerOrders[order.owner].push(orderId);
    }

    function markTriggerExecuted(uint256 orderId) external onlyRole(ENGINE_ROLE) {
        TriggerOrder storage order = _triggerOrders[orderId];
        if (order.owner == address(0)) revert OrderNotFound(orderId);
        order.status = OrderStatus.EXECUTED;
    }

    function markTriggerCancelled(uint256 orderId) external onlyRole(ENGINE_ROLE) {
        TriggerOrder storage order = _triggerOrders[orderId];
        if (order.owner == address(0)) revert OrderNotFound(orderId);
        order.status = OrderStatus.CANCELLED;
    }

    function getTriggerOrder(uint256 orderId) external view returns (TriggerOrder memory) {
        return _triggerOrders[orderId];
    }

    function getUserTriggerOrders(address user) external view returns (uint256[] memory) {
        return _userTriggerOrders[user];
    }
}
