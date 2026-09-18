// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {FeeConfig} from "../../src/interfaces/DataTypes.sol";

contract FeeManagerTest is BaseTest {
    function test_collectFee_routesShareToBuyback() public {
        vm.startPrank(admin);
        feeManager.setFeeConfig(
            NVDA,
            FeeConfig({
                makerFee: 0, takerFee: 10, optionOpenFee: 0, optionCloseFee: 0, settlementFee: 0, liquidationFee: 0
            })
        );
        feeManager.setBuybackModule(address(buybackModule));
        feeManager.setBuybackShare(3000); // 30%
        vm.stopPrank();

        vm.prank(address(perpsEngine));
        feeManager.collectFee(NVDA, alice, address(usdc), 1_000e18, "TAKER");

        assertEq(usdc.balanceOf(address(buybackModule)), 300e18);
        assertEq(buybackModule.accruedForBuyback(address(usdc)), 300e18);
        assertEq(usdc.balanceOf(address(feeManager)), 700e18);
        assertEq(vault.availableBalance(alice, address(usdc)), 100_000e18 - 1_000e18);
    }

    function test_collectFee_onlyEngineRole() public {
        vm.expectRevert();
        feeManager.collectFee(NVDA, alice, address(usdc), 1e18, "TAKER");
    }

    function test_setBuybackShare_overMaxReverts() public {
        vm.prank(admin);
        vm.expectRevert();
        feeManager.setBuybackShare(10_001);
    }
}
