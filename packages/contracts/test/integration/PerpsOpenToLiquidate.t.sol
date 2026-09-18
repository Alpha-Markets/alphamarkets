// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";

contract PerpsOpenToLiquidateTest is BaseTest {
    function _openLong(address user, uint256 collateral, uint256 leverage) internal returns (uint256 positionId) {
        vm.prank(user);
        positionId =
            perpsEngine.openPosition(NVDA, true, collateral, leverage, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_openLong_thenCloseAtProfit() public {
        uint256 positionId = _openLong(alice, 1_000e18, 5);

        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertEq(pos.entryPrice, 190e18);
        assertEq(pos.size, 5_000e18);
        assertTrue(pos.open);

        uint256 balanceAfterOpen = vault.availableBalance(alice, address(usdc));

        _setPrice(200e18); // +5.26% move, well within maintenance margin
        vm.prank(alice);
        perpsEngine.closePosition(positionId, 0, block.timestamp + 1 hours);

        pos = perpPositionManager.getPosition(positionId);
        assertFalse(pos.open);
        // profit = size * (200-190)/190 = 5000 * 10/190 ~= 263.15
        assertGt(vault.availableBalance(alice, address(usdc)), balanceAfterOpen);
    }

    function test_openLong_thenLiquidateOnCrash() public {
        uint256 positionId = _openLong(alice, 1_000e18, 10);

        // 10x long, maintenance margin 5%. A price drop of ~9.5% wipes equity below
        // maintenance margin (loss = size * drop/entry, size = 10,000).
        _setPrice(170e18); // ~10.5% drop from 190

        assertTrue(liquidationEngine.isLiquidatable(positionId));

        vm.prank(keeper);
        liquidationEngine.liquidate(positionId);

        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertFalse(pos.open);
        assertGt(vault.availableBalance(keeper, address(usdc)), 0); // liquidator reward paid
    }

    function test_liquidate_notEligible_reverts() public {
        uint256 positionId = _openLong(alice, 1_000e18, 2);

        vm.prank(keeper);
        vm.expectRevert(LiquidationEngine.PositionNotLiquidatable.selector);
        liquidationEngine.liquidate(positionId);
    }

    function test_openPosition_leverageNotInTierList_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        perpsEngine.openPosition(NVDA, true, 1_000e18, 4, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_reducePosition_partialClose() public {
        uint256 positionId = _openLong(alice, 1_000e18, 5);

        vm.prank(alice);
        perpsEngine.reducePosition(positionId, 2_500e18, 0, block.timestamp + 1 hours);

        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertTrue(pos.open);
        assertEq(pos.size, 2_500e18);
    }
}
