// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {OrionisVault} from "../../src/core/OrionisVault.sol";

contract OrionisVaultTest is BaseTest {
    function test_deposit_creditsLedger() public {
        assertEq(vault.availableBalance(alice, address(usdc)), 100_000e18);
    }

    function test_withdraw_returnsTokens() public {
        vm.prank(alice);
        vault.withdraw(address(usdc), 1_000e18);
        assertEq(usdc.balanceOf(alice), 1_000e18 + 900_000e18); // minted 1,000,000, deposited 100,000
        assertEq(vault.availableBalance(alice, address(usdc)), 99_000e18);
    }

    function test_withdraw_moreThanAvailable_reverts() public {
        vm.prank(alice);
        vm.expectRevert(OrionisVault.InsufficientCollateral.selector);
        vault.withdraw(address(usdc), 200_000e18);
    }

    function test_withdraw_afterLockedMargin_reverts() public {
        vm.prank(address(perpsEngine));
        vault.lockMargin(alice, address(usdc), 50_000e18);

        assertEq(vault.availableBalance(alice, address(usdc)), 50_000e18);

        vm.prank(alice);
        vm.expectRevert(OrionisVault.InsufficientCollateral.selector);
        vault.withdraw(address(usdc), 60_000e18);
    }

    function test_settlePnl_creditAndDebit() public {
        vm.prank(address(optionsEngine));
        vault.settlePnl(alice, address(usdc), 500e18);
        assertEq(vault.availableBalance(alice, address(usdc)), 100_500e18);

        vm.prank(address(optionsEngine));
        vault.settlePnl(alice, address(usdc), -1000e18);
        assertEq(vault.availableBalance(alice, address(usdc)), 99_500e18);
    }

    function test_onlyEngineRole_canLockMargin() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.lockMargin(alice, address(usdc), 1e18);
    }
}
