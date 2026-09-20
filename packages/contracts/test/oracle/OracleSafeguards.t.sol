// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";
import {OracleRouter} from "../../src/oracle/OracleRouter.sol";
import {MockPriceFeed} from "../../src/oracle/MockPriceFeed.sol";

/// @dev The oracle safeguards PROJECT_BRIEF.md Section 16 requires: stale-price rejection,
/// deviation rejection, a fallback source, and an emergency pause.
contract OracleSafeguardsTest is BaseTest {
    MockPriceFeed internal fallbackFeed;

    function _addFallback(uint256 price) internal {
        vm.startPrank(admin);
        fallbackFeed = new MockPriceFeed(admin, 18, price);
        oracleRouter.setFallbackSource(NVDA, address(fallbackFeed), 18);
        vm.stopPrank();
    }

    // ---- PriceValidator -----------------------------------------------------

    function test_validator_freshnessUsesDefaultAndOverride() public {
        uint256 ts = block.timestamp;
        vm.warp(ts + 1 hours);
        priceValidator.validateFreshness(ts, NVDA); // exactly at the limit is still fresh
        vm.warp(ts + 1 hours + 1);
        vm.expectRevert(PriceValidator.StaleOraclePrice.selector);
        priceValidator.validateFreshness(ts, NVDA);

        vm.prank(admin);
        priceValidator.setMaxPriceAge(NVDA, 2 hours);
        priceValidator.validateFreshness(ts, NVDA);
    }

    function test_validator_deviationUsesDefaultAndOverride() public {
        priceValidator.validateDeviation(100e18, 110e18, NVDA); // 9.09% is inside the 10% default
        vm.expectRevert(PriceValidator.InvalidOraclePrice.selector);
        priceValidator.validateDeviation(100e18, 120e18, NVDA);
        vm.expectRevert(PriceValidator.InvalidOraclePrice.selector);
        priceValidator.validateDeviation(120e18, 100e18, NVDA); // symmetric

        vm.prank(admin);
        priceValidator.setMaxDeviationBps(NVDA, 2500);
        priceValidator.validateDeviation(100e18, 120e18, NVDA);
    }

    function test_validator_zeroPriceIsIgnored() public view {
        priceValidator.validateDeviation(0, 100e18, NVDA);
        priceValidator.validateDeviation(100e18, 0, NVDA);
    }

    function test_validator_settersAreAdminOnly() public {
        vm.startPrank(alice);
        vm.expectRevert();
        priceValidator.setMaxPriceAge(NVDA, 1);
        vm.expectRevert();
        priceValidator.setMaxDeviationBps(NVDA, 1);
        vm.stopPrank();
    }

    function testFuzz_validator_deviationIsSymmetric(uint128 a, uint128 b) public {
        bool aThenB;
        try priceValidator.validateDeviation(a, b, NVDA) {
            aThenB = true;
        } catch {}
        bool bThenA;
        try priceValidator.validateDeviation(b, a, NVDA) {
            bThenA = true;
        } catch {}
        assertEq(aThenB, bThenA);
    }

    // ---- fallback source ----------------------------------------------------

    function test_router_fallbackServesWhenPrimaryIsStale() public {
        _addFallback(190e18);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(admin);
        fallbackFeed.setPrice(191e18); // only the fallback is fresh

        (uint256 price,) = oracleRouter.getIndexPrice(NVDA);
        assertEq(price, 191e18);
    }

    function test_router_primaryWinsWhenBothAgree() public {
        _addFallback(195e18);
        (uint256 price,) = oracleRouter.getIndexPrice(NVDA);
        assertEq(price, 190e18);
    }

    function test_router_deviatingSourcesReject() public {
        _addFallback(230e18); // 190 vs 230 is far beyond 10%
        vm.expectRevert(PriceValidator.InvalidOraclePrice.selector);
        oracleRouter.getIndexPrice(NVDA);
    }

    function test_router_noFreshSourceReverts() public {
        _addFallback(190e18);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.NoPriceSource.selector, NVDA));
        oracleRouter.getIndexPrice(NVDA);
    }

    function test_router_unknownMarketHasNoSource() public {
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.NoPriceSource.selector, bytes32("TSLA")));
        oracleRouter.getIndexPrice("TSLA");
    }

    function test_router_normalizesDecimals() public {
        vm.startPrank(admin);
        MockPriceFeed eightDecimals = new MockPriceFeed(admin, 8, 190e8);
        MockPriceFeed twentyDecimals = new MockPriceFeed(admin, 20, 190e20);
        oracleRouter.setPrimarySource("A8", address(eightDecimals), 8);
        oracleRouter.setPrimarySource("A20", address(twentyDecimals), 20);
        vm.stopPrank();

        (uint256 up,) = oracleRouter.getIndexPrice("A8");
        (uint256 down,) = oracleRouter.getIndexPrice("A20");
        assertEq(up, 190e18);
        assertEq(down, 190e18);
    }

    function test_router_adminSettersRejectZeroAndNonAdmins() public {
        vm.prank(admin);
        vm.expectRevert(OracleRouter.ZeroAddress.selector);
        oracleRouter.setPrimarySource(NVDA, address(0), 18);

        vm.startPrank(alice);
        vm.expectRevert();
        oracleRouter.setPrimarySource(NVDA, address(1), 18);
        vm.expectRevert();
        oracleRouter.setFallbackSource(NVDA, address(1), 18);
        vm.expectRevert();
        oracleRouter.pauseMarket(NVDA);
        vm.stopPrank();
    }

    function test_router_lastPriceAndSettlementReads() public {
        (uint256 last,) = oracleRouter.getLastPrice(NVDA);
        assertEq(last, 0);

        uint256 expiry = block.timestamp + 1 days;
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.SettlementNotRecorded.selector, NVDA, expiry));
        oracleRouter.getSettlementPrice(NVDA, expiry);

        vm.warp(expiry);
        _setPrice(200e18);
        oracleRouter.ensureSettlementPrice(NVDA, expiry);
        (uint256 settled, uint256 at) = oracleRouter.getSettlementPrice(NVDA, expiry);
        assertEq(settled, 200e18);
        assertEq(at, expiry);
        (uint256 price,) = oracleRouter.getPrice(NVDA);
        assertEq(price, 200e18);
    }

    function test_mockFeed_onlyOwnerCanPush() public {
        vm.prank(alice);
        vm.expectRevert(MockPriceFeed.NotOwner.selector);
        priceFeed.setPrice(1);
        assertEq(priceFeed.decimals(), 18);
    }
}
