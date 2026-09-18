// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {CollateralManager} from "../../src/core/CollateralManager.sol";

contract CollateralManagerTest is BaseTest {
    function test_deposit_unsupportedTokenReverts() public {
        vm.prank(address(vault));
        vm.expectRevert(abi.encodeWithSelector(CollateralManager.UnsupportedToken.selector, address(0xDEAD)));
        collateralManager.deposit(alice, address(0xDEAD), 1e18);
    }

    function test_deposit_onlyVaultRole() public {
        vm.expectRevert();
        collateralManager.deposit(alice, address(usdc), 1e18);
    }

    function test_withdraw_underflowReverts() public {
        vm.prank(address(vault));
        vm.expectRevert();
        collateralManager.withdraw(bob, address(usdc), 200_000e18); // exceeds bob's 100k ledger balance
    }

    function test_removeSupportedToken_blocksFutureDeposits() public {
        vm.prank(admin);
        collateralManager.removeSupportedToken(address(usdc));

        vm.prank(address(vault));
        vm.expectRevert(abi.encodeWithSelector(CollateralManager.UnsupportedToken.selector, address(usdc)));
        collateralManager.deposit(alice, address(usdc), 1e18);
    }
}
