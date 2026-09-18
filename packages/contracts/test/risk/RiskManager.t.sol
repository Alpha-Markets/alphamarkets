// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";

contract RiskManagerTest is BaseTest {
    function test_checkLeverage_allowedTierPasses() public view {
        riskManager.checkLeverage(NVDA, 5);
    }

    function test_checkLeverage_disallowedTierReverts() public {
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        riskManager.checkLeverage(NVDA, 7);
    }

    function test_checkPositionSize_overCapReverts() public {
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        riskManager.checkPositionSize(NVDA, 600_000e18);
    }

    function test_checkOpenInterest_overCapReverts() public {
        vm.expectRevert(RiskManager.OpenInterestLimitExceeded.selector);
        riskManager.checkOpenInterest(NVDA, true, 6_000_000e18);
    }

    function test_recordOpenInterestDelta_onlyEngineRole() public {
        vm.expectRevert();
        riskManager.recordOpenInterestDelta(NVDA, true, 1e18);
    }

    function test_recordOpenInterestDelta_updatesTracking() public {
        vm.prank(address(perpsEngine));
        riskManager.recordOpenInterestDelta(NVDA, true, 1_000e18);
        assertEq(riskManager.openInterestLong(NVDA), 1_000e18);

        vm.prank(address(perpsEngine));
        riskManager.recordOpenInterestDelta(NVDA, true, -400e18);
        assertEq(riskManager.openInterestLong(NVDA), 600e18);
    }
}
