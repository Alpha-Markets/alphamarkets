// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MarginEngine} from "../../src/risk/MarginEngine.sol";

contract MarginEngineTest is Test {
    function test_initialMargin() public pure {
        assertEq(MarginEngine.initialMargin(10_000e18, 1000), 1_000e18);
    }

    function test_maintenanceMargin() public pure {
        assertEq(MarginEngine.maintenanceMargin(10_000e18, 500), 500e18);
    }

    function test_unrealizedPnl_longProfit() public pure {
        int256 pnl = MarginEngine.unrealizedPnl(true, 100e18, 110e18, 1000e18);
        assertEq(pnl, 100e18);
    }

    function test_unrealizedPnl_shortProfit() public pure {
        int256 pnl = MarginEngine.unrealizedPnl(false, 100e18, 90e18, 1000e18);
        assertEq(pnl, 100e18);
    }

    /// @dev Invariant: margin ratio never underflows (floors at 0) even when the loss
    /// exceeds collateral.
    function testFuzz_marginRatio_neverReverts(uint256 collateral, int256 pnl, uint256 notional) public pure {
        collateral = bound(collateral, 0, 1_000_000e18);
        notional = bound(notional, 1, 1_000_000e18);
        pnl = bound(pnl, -1_000_000e18, 1_000_000e18);

        uint256 ratio = MarginEngine.marginRatio(collateral, pnl, notional);
        int256 equity = int256(collateral) + pnl;
        if (equity <= 0) {
            assertEq(ratio, 0);
        } else {
            assertEq(ratio, (uint256(equity) * 10_000) / notional);
        }
    }

    /// @dev Invariant: a long position's liquidation price is below entry, a short
    /// position's is above entry, whenever collateral exceeds maintenance margin at entry.
    function testFuzz_liquidationPrice_direction(
        bool isLong,
        uint256 entryPrice,
        uint256 collateral,
        uint256 size,
        uint256 maintenanceMarginRateBps
    ) public pure {
        entryPrice = bound(entryPrice, 1e18, 100_000e18);
        size = bound(size, 1e18, 1_000_000e18);
        maintenanceMarginRateBps = bound(maintenanceMarginRateBps, 1, 5000);
        uint256 maintMargin = MarginEngine.maintenanceMargin(size, maintenanceMarginRateBps);
        // Ensure collateral starts safely above maintenance margin.
        collateral = bound(collateral, maintMargin + 1, maintMargin + 1_000_000e18);

        uint256 liqPrice = MarginEngine.liquidationPrice(isLong, entryPrice, collateral, size, maintenanceMarginRateBps);

        if (isLong) {
            assertLe(liqPrice, entryPrice);
        } else {
            assertGe(liqPrice, entryPrice);
        }
    }

    /// @dev Invariant: unrealized PnL fuzz — a long position's PnL sign matches the price
    /// move direction, and a short position's is the mirror image. A non-strict bound (>=
    /// / <=) is used because integer division can round a tiny price move on tiny size
    /// down to exactly 0, which is not a violation of direction.
    function testFuzz_unrealizedPnl_sign(bool isLong, uint256 entryPrice, uint256 markPrice, uint256 size) public pure {
        entryPrice = bound(entryPrice, 1e18, 100_000e18);
        markPrice = bound(markPrice, 1e18, 100_000e18);
        size = bound(size, 0, 1_000_000e18);

        int256 pnl = MarginEngine.unrealizedPnl(isLong, entryPrice, markPrice, size);

        if (markPrice == entryPrice || size == 0) {
            assertEq(pnl, 0);
        } else if (isLong) {
            if (markPrice > entryPrice) assertGe(pnl, 0);
            else assertLe(pnl, 0);
        } else {
            if (markPrice < entryPrice) assertGe(pnl, 0);
            else assertLe(pnl, 0);
        }
    }
}
