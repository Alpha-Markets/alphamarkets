// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {MarketRegistry} from "../../src/core/MarketRegistry.sol";
import {MarketConfig} from "../../src/interfaces/DataTypes.sol";

contract MarketRegistryTest is BaseTest {
    function test_seedMarket_isActiveAndEnabled() public view {
        assertTrue(marketRegistry.isActive(NVDA));
        assertTrue(marketRegistry.isOptionsEnabled(NVDA));
        assertTrue(marketRegistry.isPerpsEnabled(NVDA));
    }

    function test_addMarket_duplicateReverts() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistry.MarketAlreadyExists.selector, NVDA));
        marketRegistry.addMarket(
            MarketConfig({
                marketId: NVDA,
                underlyingToken: address(0xBEEF),
                oracleId: NVDA,
                optionsEnabled: true,
                perpsEnabled: true,
                maxLeverage: 10,
                openInterestCap: 1,
                active: true
            })
        );
    }

    function test_setActive_pausesMarket() public {
        vm.prank(admin);
        marketRegistry.setActive(NVDA, false);
        assertFalse(marketRegistry.isActive(NVDA));
    }

    function test_nonAdmin_cannotAddMarket() public {
        vm.prank(alice);
        vm.expectRevert();
        marketRegistry.addMarket(
            MarketConfig({
                marketId: bytes32("TSLA"),
                underlyingToken: address(0xCAFE),
                oracleId: bytes32("TSLA"),
                optionsEnabled: true,
                perpsEnabled: true,
                maxLeverage: 5,
                openInterestCap: 1,
                active: true
            })
        );
    }
}
