// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {FeeConfig} from "../../src/interfaces/DataTypes.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";
import {PerpOrderManager} from "../../src/perps/PerpOrderManager.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";
import {DeadlineExpired} from "../../src/interfaces/Errors.sol";

contract LimitOrdersTest is BaseTest {
    uint256 internal constant EXPIRY_IN = 1 hours;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        feeManager.setFeeConfig(
            NVDA,
            FeeConfig({
                makerFee: 0, takerFee: 10, optionOpenFee: 0, optionCloseFee: 0, settlementFee: 0, liquidationFee: 0
            })
        );
    }

    function _place(address user, bool isLong, uint256 collateral, uint256 leverage, uint256 trigger)
        internal
        returns (uint256 orderId)
    {
        vm.prank(user);
        orderId = perpsEngine.placeLimitOrder(NVDA, isLong, collateral, leverage, trigger, block.timestamp + EXPIRY_IN);
    }

    // ---- placing ------------------------------------------------------------

    function test_place_storesOrderAndReservesNothing() public {
        uint256 before = vault.availableBalance(alice, address(usdc));
        uint256 orderId = _place(alice, true, 1_000e18, 5, 180e18);

        assertEq(orderId, 1);
        PerpOrderManager.LimitOrder memory order = perpOrderManager.getOrder(orderId);
        assertEq(order.owner, alice);
        assertEq(order.triggerPrice, 180e18);
        assertEq(uint8(order.status), uint8(PerpOrderManager.OrderStatus.OPEN));
        assertEq(vault.availableBalance(alice, address(usdc)), before);
        assertEq(perpOrderManager.getUserOrders(alice).length, 1);
    }

    function test_place_emitsEvent() public {
        vm.expectEmit(true, true, true, true, address(perpsEngine));
        emit PerpsEngine.LimitOrderPlaced(1, alice, NVDA, true, 1_000e18, 5, 180e18, block.timestamp + EXPIRY_IN);
        _place(alice, true, 1_000e18, 5, 180e18);
    }

    function test_place_rejectsBadInput() public {
        vm.startPrank(alice);
        vm.expectRevert(PerpsEngine.ZeroAmount.selector);
        perpsEngine.placeLimitOrder(NVDA, true, 0, 5, 180e18, block.timestamp + 1 hours);
        vm.expectRevert(PerpsEngine.InvalidTriggerPrice.selector);
        perpsEngine.placeLimitOrder(NVDA, true, 1_000e18, 5, 0, block.timestamp + 1 hours);
        vm.expectRevert(abi.encodeWithSelector(DeadlineExpired.selector, block.timestamp, block.timestamp));
        perpsEngine.placeLimitOrder(NVDA, true, 1_000e18, 5, 180e18, block.timestamp);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector); // 4x is not a tier
        perpsEngine.placeLimitOrder(NVDA, true, 1_000e18, 4, 180e18, block.timestamp + 1 hours);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector); // above the position cap
        perpsEngine.placeLimitOrder(NVDA, true, 100_000e18, 10, 180e18, block.timestamp + 1 hours);
        vm.stopPrank();
    }

    function test_place_pausedMarketReverts() public {
        vm.prank(admin);
        marketRegistry.setActive(NVDA, false);
        vm.prank(alice);
        vm.expectRevert();
        perpsEngine.placeLimitOrder(NVDA, true, 1_000e18, 5, 180e18, block.timestamp + 1 hours);
    }

    // ---- executing ----------------------------------------------------------

    function test_execute_longFillsOnceMarkFallsToTrigger() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 185e18);

        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.LimitPriceNotReached.selector, orderId, 185e18, 190e18));
        vm.prank(keeper);
        perpsEngine.executeLimitOrder(orderId);

        _setPrice(184e18);
        uint256 before = vault.availableBalance(alice, address(usdc));
        vm.prank(keeper); // anyone can fill it
        uint256 positionId = perpsEngine.executeLimitOrder(orderId);

        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertEq(pos.owner, alice);
        assertTrue(pos.isLong);
        assertEq(pos.entryPrice, 184e18); // the mark, better than the 185 trigger
        assertEq(pos.size, 5_000e18);
        assertEq(pos.collateral, 1_000e18);
        // Margin plus the 0.10% taker fee on 5,000, both from the owner, nothing from the keeper.
        assertEq(before - vault.availableBalance(alice, address(usdc)), 1_005e18);
        assertEq(vault.availableBalance(keeper, address(usdc)), 0);

        PerpOrderManager.LimitOrder memory order = perpOrderManager.getOrder(orderId);
        assertEq(uint8(order.status), uint8(PerpOrderManager.OrderStatus.EXECUTED));
        assertEq(order.positionId, positionId);
        assertEq(riskManager.openInterestLong(NVDA), 5_000e18);
    }

    function test_execute_shortFillsOnceMarkRisesToTrigger() public {
        uint256 orderId = _place(alice, false, 1_000e18, 2, 195e18);

        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.LimitPriceNotReached.selector, orderId, 195e18, 190e18));
        perpsEngine.executeLimitOrder(orderId);

        _setPrice(196e18);
        uint256 positionId = perpsEngine.executeLimitOrder(orderId);
        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertFalse(pos.isLong);
        assertEq(pos.entryPrice, 196e18);
        assertEq(riskManager.openInterestShort(NVDA), 2_000e18);
    }

    function test_execute_emitsEvent() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18); // triggers at the current price
        vm.expectEmit(true, true, true, true, address(perpsEngine));
        emit PerpsEngine.LimitOrderExecuted(orderId, alice, 1, 190e18);
        perpsEngine.executeLimitOrder(orderId);
    }

    function test_execute_cannotFillTwice() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18);
        perpsEngine.executeLimitOrder(orderId);
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderNotOpen.selector, orderId));
        perpsEngine.executeLimitOrder(orderId);
    }

    function test_execute_unknownOrderReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderNotOpen.selector, 99));
        perpsEngine.executeLimitOrder(99);
    }

    function test_execute_expiredOrderReverts() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18);
        uint256 expiry = perpOrderManager.getOrder(orderId).expiry;
        vm.warp(expiry + 1);
        _setPrice(190e18); // refresh the feed so the price is not stale
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderExpired.selector, orderId, expiry));
        perpsEngine.executeLimitOrder(orderId);
    }

    function test_execute_failsWhenOwnerWithdrewMargin() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18);
        vm.prank(alice);
        vault.withdraw(address(usdc), 100_000e18);
        vm.expectRevert(PerpsEngine.InsufficientCollateral.selector);
        perpsEngine.executeLimitOrder(orderId);
        // Still open: it can fill if the owner deposits again.
        assertEq(uint8(perpOrderManager.getOrder(orderId).status), uint8(PerpOrderManager.OrderStatus.OPEN));
    }

    function test_execute_respectsOpenInterestCapAtFillTime() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18);
        vm.startPrank(admin);
        RiskManager.RiskConfig memory config = riskManager.getRiskConfig(NVDA);
        config.openInterestCap = 4_000e18;
        riskManager.setRiskConfig(NVDA, config);
        vm.stopPrank();
        vm.expectRevert(RiskManager.OpenInterestLimitExceeded.selector);
        perpsEngine.executeLimitOrder(orderId);
    }

    function test_execute_pausedMarketReverts() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18);
        vm.prank(admin);
        marketRegistry.setActive(NVDA, false);
        vm.expectRevert();
        perpsEngine.executeLimitOrder(orderId);
    }

    // ---- cancelling ---------------------------------------------------------

    function test_cancel_ownerCancelsAndOrderCannotFill() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18);
        vm.expectEmit(true, true, false, true, address(perpsEngine));
        emit PerpsEngine.LimitOrderCancelled(orderId, alice);
        vm.prank(alice);
        perpsEngine.cancelLimitOrder(orderId);

        assertEq(uint8(perpOrderManager.getOrder(orderId).status), uint8(PerpOrderManager.OrderStatus.CANCELLED));
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderNotOpen.selector, orderId));
        perpsEngine.executeLimitOrder(orderId);
    }

    function test_cancel_onlyOwner() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18);
        vm.prank(bob);
        vm.expectRevert(PerpsEngine.NotPositionOwner.selector);
        perpsEngine.cancelLimitOrder(orderId);
    }

    function test_cancel_notOpenReverts() public {
        uint256 orderId = _place(alice, true, 1_000e18, 5, 190e18);
        perpsEngine.executeLimitOrder(orderId);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpsEngine.OrderNotOpen.selector, orderId));
        perpsEngine.cancelLimitOrder(orderId);
    }

    // ---- storage access -----------------------------------------------------

    function test_orderManager_onlyEngineWrites() public {
        PerpOrderManager.LimitOrder memory order;
        vm.expectRevert();
        perpOrderManager.createOrder(order);
        vm.expectRevert();
        perpOrderManager.markExecuted(1, 1);
        vm.expectRevert();
        perpOrderManager.markCancelled(1);
    }

    function test_orderManager_unknownOrderReverts() public {
        vm.prank(address(perpsEngine));
        vm.expectRevert(abi.encodeWithSelector(PerpOrderManager.OrderNotFound.selector, 5));
        perpOrderManager.markCancelled(5);
        vm.prank(address(perpsEngine));
        vm.expectRevert(abi.encodeWithSelector(PerpOrderManager.OrderNotFound.selector, 5));
        perpOrderManager.markExecuted(5, 1);
    }

    // ---- fuzz ---------------------------------------------------------------

    /// A long fills only at or below its trigger, a short only at or above, and always at the mark.
    function testFuzz_execute_neverFillsWorseThanTrigger(bool isLong, uint256 trigger, uint256 mark) public {
        trigger = bound(trigger, 100e18, 300e18);
        mark = bound(mark, 100e18, 300e18);
        uint256 orderId = _place(alice, isLong, 1_000e18, 2, trigger);
        _setPrice(mark);

        try perpsEngine.executeLimitOrder(orderId) returns (uint256 positionId) {
            uint256 entry = perpPositionManager.getPosition(positionId).entryPrice;
            assertEq(entry, mark);
            if (isLong) assertLe(entry, trigger);
            else assertGe(entry, trigger);
        } catch {
            if (isLong) assertGt(mark, trigger);
            else assertLt(mark, trigger);
            assertEq(uint8(perpOrderManager.getOrder(orderId).status), uint8(PerpOrderManager.OrderStatus.OPEN));
        }
    }
}
