// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {FeeConfig, TriggerKind} from "../../src/interfaces/DataTypes.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";
import {PerpOrderManager} from "../../src/perps/PerpOrderManager.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {MarginEngine} from "../../src/risk/MarginEngine.sol";
import {DeadlineExpired} from "../../src/interfaces/Errors.sol";

/// @dev Stop-loss and take-profit orders attached to an open perpetual position.
contract TriggerOrdersTest is BaseTest {
    uint256 internal constant EXPIRY_IN = 1 hours;
    uint256 internal constant TAKER_BPS = 10; // 0.10%

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        feeManager.setFeeConfig(
            NVDA,
            FeeConfig({
                makerFee: 0,
                takerFee: TAKER_BPS,
                optionOpenFee: 0,
                optionCloseFee: 0,
                settlementFee: 0,
                liquidationFee: 0
            })
        );
    }

    function _open(address user, bool isLong) internal returns (uint256 positionId) {
        vm.prank(user);
        positionId = perpsEngine.openPosition(
            NVDA, isLong, 1_000e18, 5, isLong ? type(uint256).max : 0, block.timestamp + 1 hours
        );
    }

    function _place(address user, uint256 positionId, TriggerKind kind, uint256 trigger)
        internal
        returns (uint256 orderId)
    {
        vm.prank(user);
        orderId = perpsEngine.placeTriggerOrder(positionId, kind, trigger, block.timestamp + EXPIRY_IN);
    }

    function _status(uint256 orderId) internal view returns (PerpOrderManager.OrderStatus) {
        return perpOrderManager.getTriggerOrder(orderId).status;
    }

    // ---- placing ------------------------------------------------------------

    function test_place_storesOrderAndEmits() public {
        uint256 positionId = _open(alice, true);
        vm.expectEmit(true, true, true, true, address(perpsEngine));
        emit PerpsEngine.TriggerOrderPlaced(
            1, alice, positionId, TriggerKind.STOP_LOSS, 170e18, block.timestamp + EXPIRY_IN
        );
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 170e18);

        assertEq(orderId, 1);
        PerpOrderManager.TriggerOrder memory order = perpOrderManager.getTriggerOrder(orderId);
        assertEq(order.positionId, positionId);
        assertEq(order.owner, alice);
        assertEq(order.triggerPrice, 170e18);
        assertEq(uint8(order.kind), uint8(TriggerKind.STOP_LOSS));
        assertEq(uint8(order.status), uint8(PerpOrderManager.OrderStatus.OPEN));
        assertEq(perpOrderManager.getUserTriggerOrders(alice).length, 1);
        // Trigger ids are separate from limit-order ids.
        assertEq(perpOrderManager.nextOrderId(), 0);
    }

    function test_place_longSideRules() public {
        uint256 positionId = _open(alice, true); // mark 190
        vm.startPrank(alice);
        vm.expectRevert(PerpsEngine.InvalidTriggerPrice.selector); // stop-loss above the mark
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.STOP_LOSS, 200e18, block.timestamp + 1 hours);
        vm.expectRevert(PerpsEngine.InvalidTriggerPrice.selector); // stop-loss at the mark
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.STOP_LOSS, 190e18, block.timestamp + 1 hours);
        vm.expectRevert(PerpsEngine.InvalidTriggerPrice.selector); // take-profit below the mark
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.TAKE_PROFIT, 180e18, block.timestamp + 1 hours);
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.TAKE_PROFIT, 210e18, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_place_shortSideRules() public {
        uint256 positionId = _open(alice, false); // mark 190
        vm.startPrank(alice);
        vm.expectRevert(PerpsEngine.InvalidTriggerPrice.selector); // stop-loss below the mark
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.STOP_LOSS, 180e18, block.timestamp + 1 hours);
        vm.expectRevert(PerpsEngine.InvalidTriggerPrice.selector); // take-profit above the mark
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.TAKE_PROFIT, 200e18, block.timestamp + 1 hours);
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.STOP_LOSS, 200e18, block.timestamp + 1 hours);
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.TAKE_PROFIT, 170e18, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_place_rejectsBadInput() public {
        uint256 positionId = _open(alice, true);
        vm.startPrank(alice);
        vm.expectRevert(PerpsEngine.InvalidTriggerPrice.selector);
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.STOP_LOSS, 0, block.timestamp + 1 hours);
        vm.expectRevert(abi.encodeWithSelector(DeadlineExpired.selector, block.timestamp, block.timestamp));
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.STOP_LOSS, 170e18, block.timestamp);
        vm.stopPrank();
    }

    function test_place_onlyPositionOwner() public {
        uint256 positionId = _open(alice, true);
        vm.prank(bob);
        vm.expectRevert(PerpsEngine.NotPositionOwner.selector);
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.STOP_LOSS, 170e18, block.timestamp + 1 hours);
    }

    function test_place_closedPositionReverts() public {
        uint256 positionId = _open(alice, true);
        vm.prank(alice);
        perpsEngine.closePosition(positionId, 0, block.timestamp + 1 hours);
        vm.prank(alice);
        vm.expectRevert(PerpsEngine.PositionNotOpen.selector);
        perpsEngine.placeTriggerOrder(positionId, TriggerKind.STOP_LOSS, 170e18, block.timestamp + 1 hours);
    }

    // ---- executing ----------------------------------------------------------

    function test_execute_longStopLossClosesAtLoss() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);

        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.TriggerPriceNotReached.selector, orderId, 180e18, 190e18));
        vm.prank(keeper);
        perpsEngine.executeTriggerOrder(orderId);

        _setPrice(178e18); // gapped through the trigger
        uint256 balanceBefore = vault.availableBalance(alice, address(usdc));
        int256 expectedPnl = MarginEngine.unrealizedPnl(true, 190e18, 178e18, 5_000e18);
        uint256 fee = (5_000e18 * TAKER_BPS) / 10_000;

        vm.expectEmit(true, true, true, true, address(perpsEngine));
        emit PerpsEngine.TriggerOrderExecuted(orderId, alice, positionId, 178e18);
        vm.prank(keeper); // anyone can fire it
        perpsEngine.executeTriggerOrder(orderId);

        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertFalse(pos.open);
        assertEq(pos.realizedPnl, expectedPnl);
        assertLt(expectedPnl, 0);
        // Margin comes back, less the loss and the taker fee; the keeper gets nothing.
        assertEq(
            vault.availableBalance(alice, address(usdc)),
            uint256(int256(balanceBefore) + 1_000e18 + expectedPnl - int256(fee))
        );
        assertEq(vault.availableBalance(keeper, address(usdc)), 0);
        assertEq(uint8(_status(orderId)), uint8(PerpOrderManager.OrderStatus.EXECUTED));
        assertEq(riskManager.openInterestLong(NVDA), 0);
    }

    function test_execute_longTakeProfitClosesAtGain() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.TAKE_PROFIT, 200e18);

        _setPrice(199e18);
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.TriggerPriceNotReached.selector, orderId, 200e18, 199e18));
        perpsEngine.executeTriggerOrder(orderId);

        _setPrice(205e18);
        perpsEngine.executeTriggerOrder(orderId);
        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertFalse(pos.open);
        assertGt(pos.realizedPnl, 0);
        assertEq(pos.realizedPnl, MarginEngine.unrealizedPnl(true, 190e18, 205e18, 5_000e18));
    }

    function test_execute_shortStopLossFiresOnRise() public {
        uint256 positionId = _open(alice, false);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 200e18);

        _setPrice(180e18); // the short is in profit: a stop-loss must not fire
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.TriggerPriceNotReached.selector, orderId, 200e18, 180e18));
        perpsEngine.executeTriggerOrder(orderId);

        _setPrice(201e18);
        perpsEngine.executeTriggerOrder(orderId);
        assertFalse(perpPositionManager.getPosition(positionId).open);
        assertLt(perpPositionManager.getPosition(positionId).realizedPnl, 0);
        assertEq(riskManager.openInterestShort(NVDA), 0);
    }

    function test_execute_shortTakeProfitFiresOnFall() public {
        uint256 positionId = _open(alice, false);
        uint256 orderId = _place(alice, positionId, TriggerKind.TAKE_PROFIT, 170e18);

        _setPrice(160e18);
        perpsEngine.executeTriggerOrder(orderId);
        assertFalse(perpPositionManager.getPosition(positionId).open);
        assertGt(perpPositionManager.getPosition(positionId).realizedPnl, 0);
    }

    function test_execute_closesRemainingSizeAfterPartialReduce() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.TAKE_PROFIT, 200e18);
        vm.prank(alice);
        perpsEngine.reducePosition(positionId, 2_000e18, 0, block.timestamp + 1 hours);

        _setPrice(210e18);
        perpsEngine.executeTriggerOrder(orderId);
        assertFalse(perpPositionManager.getPosition(positionId).open);
        assertEq(riskManager.openInterestLong(NVDA), 0);
    }

    function test_execute_cannotFireTwice() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);
        _setPrice(170e18);
        perpsEngine.executeTriggerOrder(orderId);
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderNotOpen.selector, orderId));
        perpsEngine.executeTriggerOrder(orderId);
    }

    function test_execute_unknownOrderReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderNotOpen.selector, 99));
        perpsEngine.executeTriggerOrder(99);
    }

    function test_execute_expiredOrderReverts() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);
        uint256 expiry = perpOrderManager.getTriggerOrder(orderId).expiry;
        vm.warp(expiry + 1);
        _setPrice(170e18); // refresh the feed so the price is not stale
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderExpired.selector, orderId, expiry));
        perpsEngine.executeTriggerOrder(orderId);
    }

    function test_execute_positionAlreadyClosedReverts() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);
        vm.prank(alice);
        perpsEngine.closePosition(positionId, 0, block.timestamp + 1 hours);

        _setPrice(170e18);
        vm.expectRevert(PerpsEngine.PositionNotOpen.selector);
        perpsEngine.executeTriggerOrder(orderId);
        // The order stays open (nothing to close); the owner can cancel it.
        assertEq(uint8(_status(orderId)), uint8(PerpOrderManager.OrderStatus.OPEN));
    }

    function test_execute_worksWhileMarketPaused() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);
        _setPrice(170e18);
        vm.prank(admin);
        marketRegistry.setActive(NVDA, false);
        // Like closePosition, a paused market does not lock a user out of closing.
        perpsEngine.executeTriggerOrder(orderId);
        assertFalse(perpPositionManager.getPosition(positionId).open);
    }

    // ---- cancelling ---------------------------------------------------------

    function test_cancel_ownerCancelsAndOrderCannotFire() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);

        vm.expectEmit(true, true, false, true, address(perpsEngine));
        emit PerpsEngine.TriggerOrderCancelled(orderId, alice);
        vm.prank(alice);
        perpsEngine.cancelTriggerOrder(orderId);
        assertEq(uint8(_status(orderId)), uint8(PerpOrderManager.OrderStatus.CANCELLED));

        _setPrice(170e18);
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderNotOpen.selector, orderId));
        perpsEngine.executeTriggerOrder(orderId);
        assertTrue(perpPositionManager.getPosition(positionId).open);
    }

    function test_cancel_onlyOwner() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);
        vm.prank(bob);
        vm.expectRevert(PerpsEngine.NotPositionOwner.selector);
        perpsEngine.cancelTriggerOrder(orderId);
    }

    function test_cancel_notOpenReverts() public {
        uint256 positionId = _open(alice, true);
        uint256 orderId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);
        _setPrice(170e18);
        perpsEngine.executeTriggerOrder(orderId);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderNotOpen.selector, orderId));
        perpsEngine.cancelTriggerOrder(orderId);
    }

    // ---- two orders on one position ----------------------------------------

    function test_stopLossAndTakeProfitTogether_firstToFireWins() public {
        uint256 positionId = _open(alice, true);
        uint256 stopId = _place(alice, positionId, TriggerKind.STOP_LOSS, 180e18);
        uint256 profitId = _place(alice, positionId, TriggerKind.TAKE_PROFIT, 200e18);

        _setPrice(205e18);
        perpsEngine.executeTriggerOrder(profitId);

        // The stop-loss is left open on a closed position and cannot fire.
        _setPrice(170e18);
        vm.expectRevert(PerpsEngine.PositionNotOpen.selector);
        perpsEngine.executeTriggerOrder(stopId);
    }

    // ---- storage access -----------------------------------------------------

    function test_orderManager_onlyEngineWritesTriggers() public {
        PerpOrderManager.TriggerOrder memory order;
        vm.expectRevert();
        perpOrderManager.createTriggerOrder(order);
        vm.expectRevert();
        perpOrderManager.markTriggerExecuted(1);
        vm.expectRevert();
        perpOrderManager.markTriggerCancelled(1);
    }

    function test_orderManager_unknownTriggerReverts() public {
        vm.prank(address(perpsEngine));
        vm.expectRevert(abi.encodeWithSelector(PerpOrderManager.OrderNotFound.selector, 5));
        perpOrderManager.markTriggerCancelled(5);
        vm.prank(address(perpsEngine));
        vm.expectRevert(abi.encodeWithSelector(PerpOrderManager.OrderNotFound.selector, 5));
        perpOrderManager.markTriggerExecuted(5);
    }

    // ---- fuzz ---------------------------------------------------------------

    /// A trigger fires only when the mark has reached it on the right side, and always exits at the
    /// mark, whatever the kind and direction.
    function testFuzz_execute_firesOnlyWhenReached(bool isLong, bool isStop, uint256 gap, uint256 mark) public {
        uint256 positionId = _open(alice, isLong);
        TriggerKind kind = isStop ? TriggerKind.STOP_LOSS : TriggerKind.TAKE_PROFIT;
        bool below = isStop == isLong;
        gap = bound(gap, 1e18, 50e18);
        uint256 trigger = below ? 190e18 - gap : 190e18 + gap;
        uint256 orderId = _place(alice, positionId, kind, trigger);

        mark = bound(mark, 100e18, 300e18);
        _setPrice(mark);
        bool reached = below ? mark <= trigger : mark >= trigger;

        try perpsEngine.executeTriggerOrder(orderId) {
            assertTrue(reached);
            PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
            assertFalse(pos.open);
            assertEq(pos.realizedPnl, MarginEngine.unrealizedPnl(isLong, 190e18, mark, 5_000e18));
        } catch {
            assertFalse(reached);
            assertTrue(perpPositionManager.getPosition(positionId).open);
            assertEq(uint8(_status(orderId)), uint8(PerpOrderManager.OrderStatus.OPEN));
        }
    }
}
