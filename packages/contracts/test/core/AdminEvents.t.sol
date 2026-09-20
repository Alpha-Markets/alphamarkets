// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";
import {FundingManager} from "../../src/perps/FundingManager.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";

/// @dev Cross-cutting rule: every privileged action emits an event, so the indexer and any
/// monitoring can see a parameter change. These cover the setters that had none.
contract AdminEventsTest is BaseTest {
    function test_priceValidator_emitsWhenMaxPriceAgeChanges() public {
        vm.expectEmit(true, false, false, true, address(priceValidator));
        emit PriceValidator.MaxPriceAgeUpdated(NVDA, 2 hours);
        vm.prank(admin);
        priceValidator.setMaxPriceAge(NVDA, 2 hours);
    }

    function test_priceValidator_emitsWhenMaxDeviationChanges() public {
        vm.expectEmit(true, false, false, true, address(priceValidator));
        emit PriceValidator.MaxDeviationUpdated(NVDA, 250);
        vm.prank(admin);
        priceValidator.setMaxDeviationBps(NVDA, 250);
    }

    function test_fundingManager_emitsWhenMaxRateChanges() public {
        vm.expectEmit(true, false, false, true, address(fundingManager));
        emit FundingManager.MaxFundingRateUpdated(NVDA, 25);
        vm.prank(admin);
        fundingManager.setMaxFundingRateBps(NVDA, 25);
    }

    function test_perpsEngine_emitsWhenTheRfqManagerIsWired() public {
        vm.startPrank(admin);
        PerpsEngine fresh = new PerpsEngine(
            address(marketRegistry),
            address(oracleRouter),
            address(vault),
            address(feeManager),
            address(riskManager),
            address(perpPositionManager),
            address(perpOrderManager),
            address(fundingManager),
            address(usdc),
            address(crossMargin)
        );
        vm.expectEmit(true, false, false, false, address(fresh));
        emit PerpsEngine.RfqManagerSet(address(rfqManager));
        fresh.setRfqManager(address(rfqManager));
        vm.stopPrank();
    }
}
