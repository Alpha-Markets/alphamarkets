// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";
import {OracleRouter} from "../../src/oracle/OracleRouter.sol";

contract OracleRouterTest is BaseTest {
    function test_getIndexPrice_readsConfiguredFeed() public view {
        (uint256 price,) = oracleRouter.getIndexPrice(NVDA);
        assertEq(price, 190e18);
    }

    function test_getMarkPrice_matchesIndexForMvp() public view {
        (uint256 mark,) = oracleRouter.getMarkPrice(NVDA);
        (uint256 index,) = oracleRouter.getIndexPrice(NVDA);
        assertEq(mark, index);
    }

    function test_stalePriceReverts() public {
        vm.warp(block.timestamp + 2 hours); // beyond DEFAULT_MAX_PRICE_AGE (1 hour)
        vm.expectRevert(PriceValidator.StaleOraclePrice.selector);
        oracleRouter.getIndexPrice(NVDA);
    }

    function test_pausedMarketReverts() public {
        vm.prank(admin);
        oracleRouter.pauseMarket(NVDA);

        vm.expectRevert(abi.encodeWithSelector(OracleRouter.MarketOraclePaused.selector, NVDA));
        oracleRouter.getIndexPrice(NVDA);
    }

    function test_unpauseMarket_restoresReads() public {
        vm.startPrank(admin);
        oracleRouter.pauseMarket(NVDA);
        oracleRouter.unpauseMarket(NVDA);
        vm.stopPrank();

        (uint256 price,) = oracleRouter.getIndexPrice(NVDA);
        assertEq(price, 190e18);
    }

    function test_updateLastPrice_onlyEngineRole() public {
        vm.expectRevert();
        oracleRouter.updateLastPrice(NVDA, 200e18);
    }

    function test_ensureSettlementPrice_beforeExpiryReverts() public {
        uint256 expiry = block.timestamp + 1 days;
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.SettlementNotYetDue.selector, NVDA, expiry));
        oracleRouter.ensureSettlementPrice(NVDA, expiry);
    }

    function test_ensureSettlementPrice_recordsOnceAndIsImmutable() public {
        uint256 expiry = block.timestamp + 1 days;
        vm.warp(expiry);
        _setPrice(190e18); // keeper refreshes the feed at expiry before settlement

        uint256 recorded = oracleRouter.ensureSettlementPrice(NVDA, expiry);
        assertEq(recorded, 190e18);

        _setPrice(250e18);
        uint256 recordedAgain = oracleRouter.ensureSettlementPrice(NVDA, expiry);
        assertEq(recordedAgain, 190e18); // unchanged despite price moving after recording
    }
}
