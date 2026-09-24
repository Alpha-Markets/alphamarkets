// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {Subaccount} from "../../src/accounts/Subaccount.sol";
import {SubaccountFactory} from "../../src/accounts/SubaccountFactory.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";

contract SubaccountsTest is BaseTest {
    SubaccountFactory internal factory;
    Subaccount internal sub;
    address internal desk = makeAddr("desk");

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        factory = SubaccountFactory(_proxyFor(address(new SubaccountFactory(address(vault))), admin));
        factory.setTargetAllowed(address(perpsEngine), true);
        vm.stopPrank();

        vm.startPrank(alice);
        sub = Subaccount(factory.createSubaccount(1));
        usdc.approve(address(sub), type(uint256).max);
        sub.deposit(address(usdc), 10_000e18);
        vm.stopPrank();
    }

    function _openCall(uint256 collateral, uint256 leverage) internal pure returns (bytes memory) {
        return abi.encodeCall(
            PerpsEngine.openPosition, (NVDA, true, collateral, leverage, type(uint256).max, type(uint256).max)
        );
    }

    // ---- creation -----------------------------------------------------------

    function test_create_isDeterministicAndRecorded() public {
        address predicted = factory.computeAddress(bob, 7);
        vm.expectEmit(true, true, false, true, address(factory));
        emit SubaccountFactory.SubaccountCreated(bob, 7, predicted);
        vm.prank(bob);
        address created = factory.createSubaccount(7);
        assertEq(created, predicted);
        assertEq(Subaccount(created).owner(), bob);
        assertEq(Subaccount(created).index(), 7);
        assertEq(factory.subaccountsOf(bob).length, 1);
        assertTrue(created != factory.computeAddress(bob, 8));
        assertTrue(created != factory.computeAddress(alice, 7), "the owner is part of the address");
    }

    function test_create_sameIndexTwiceReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SubaccountFactory.AlreadyExists.selector, address(sub)));
        factory.createSubaccount(1);
    }

    // ---- funds --------------------------------------------------------------

    function test_deposit_creditsTheSubaccountNotTheOwner() public {
        assertEq(vault.availableBalance(address(sub), address(usdc)), 10_000e18);
        assertEq(vault.availableBalance(alice, address(usdc)), 100_000e18, "the main account is untouched");
    }

    function test_deposit_onlyOwner() public {
        vm.prank(bob);
        vm.expectRevert(Subaccount.NotOwner.selector);
        sub.deposit(address(usdc), 1);
    }

    function test_withdraw_goesToTheOwner() public {
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        sub.withdraw(address(usdc), 4_000e18);
        assertEq(usdc.balanceOf(alice) - before, 4_000e18);
        assertEq(vault.availableBalance(address(sub), address(usdc)), 6_000e18);
    }

    function test_withdraw_onlyOwnerNotDelegate() public {
        vm.prank(alice);
        sub.setDelegate(desk, true);
        vm.prank(desk);
        vm.expectRevert(Subaccount.NotOwner.selector);
        sub.withdraw(address(usdc), 1);
    }

    // ---- trading ------------------------------------------------------------

    function test_owner_tradesThroughTheSubaccount() public {
        vm.prank(alice);
        bytes memory result = sub.execute(address(perpsEngine), _openCall(1_000e18, 5));
        uint256 positionId = abi.decode(result, (uint256));

        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertEq(pos.owner, address(sub), "the engine sees the subaccount as the trader");
        assertEq(vault.lockedMargin(address(sub), address(usdc)), 1_000e18);
        assertEq(vault.lockedMargin(alice, address(usdc)), 0, "the main account carries no margin for it");
    }

    function test_delegate_canTradeButNotWithdraw() public {
        vm.prank(alice);
        sub.setDelegate(desk, true);
        vm.prank(desk);
        sub.execute(address(perpsEngine), _openCall(1_000e18, 5));
        assertEq(perpPositionManager.getUserPositions(address(sub)).length, 1);

        vm.prank(alice);
        sub.setDelegate(desk, false);
        vm.prank(desk);
        vm.expectRevert(Subaccount.NotAuthorized.selector);
        sub.execute(address(perpsEngine), _openCall(1_000e18, 5));
    }

    function test_stranger_cannotExecute() public {
        vm.prank(bob);
        vm.expectRevert(Subaccount.NotAuthorized.selector);
        sub.execute(address(perpsEngine), _openCall(1_000e18, 5));
    }

    function test_execute_onlyAllowedTargets() public {
        // Neither the vault nor a token can be reached, so a delegate cannot pull money out.
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Subaccount.TargetNotAllowed.selector, address(vault)));
        sub.execute(address(vault), abi.encodeWithSignature("withdraw(address,uint256)", address(usdc), 1e18));
        vm.expectRevert(abi.encodeWithSelector(Subaccount.TargetNotAllowed.selector, address(usdc)));
        sub.execute(address(usdc), abi.encodeWithSignature("transfer(address,uint256)", alice, 1e18));
        vm.stopPrank();
    }

    function test_factory_neverAllowsTheVault() public {
        vm.prank(admin);
        vm.expectRevert("the vault is not a valid target");
        factory.setTargetAllowed(address(vault), true);
    }

    function test_targetAdminOnly() public {
        vm.prank(bob);
        vm.expectRevert();
        factory.setTargetAllowed(address(perpsEngine), false);
    }

    function test_execute_bubblesTheTargetsOwnError() public {
        vm.prank(alice);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        sub.execute(address(perpsEngine), _openCall(1_000e18, 4)); // 4x is not a tier
    }

    function test_multicall_isAllOrNothing() public {
        address[] memory targets = new address[](2);
        bytes[] memory data = new bytes[](2);
        targets[0] = address(perpsEngine);
        targets[1] = address(perpsEngine);
        data[0] = _openCall(1_000e18, 5);
        data[1] = _openCall(1_000e18, 4); // fails

        vm.prank(alice);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        sub.multicall(targets, data);
        assertEq(perpPositionManager.getUserPositions(address(sub)).length, 0, "the first leg was rolled back");

        data[1] = _openCall(500e18, 2);
        vm.prank(alice);
        sub.multicall(targets, data);
        assertEq(perpPositionManager.getUserPositions(address(sub)).length, 2);
    }

    function test_multicall_lengthMismatchReverts() public {
        vm.prank(alice);
        vm.expectRevert(Subaccount.LengthMismatch.selector);
        sub.multicall(new address[](1), new bytes[](0));
    }

    function test_subaccounts_areIsolatedFromEachOther() public {
        vm.startPrank(alice);
        Subaccount other = Subaccount(factory.createSubaccount(2));
        usdc.approve(address(other), type(uint256).max);
        other.deposit(address(usdc), 500e18);
        vm.expectRevert(); // 1,000 of margin against a 500 balance
        other.execute(address(perpsEngine), _openCall(1_000e18, 5));
        vm.stopPrank();
        assertEq(
            vault.availableBalance(address(sub), address(usdc)), 10_000e18, "the other subaccount's money is not used"
        );
    }

    function test_owner_canCloseAndWithdrawTheProceeds() public {
        vm.startPrank(alice);
        uint256 positionId = abi.decode(sub.execute(address(perpsEngine), _openCall(1_000e18, 5)), (uint256));
        sub.execute(address(perpsEngine), abi.encodeCall(PerpsEngine.closePosition, (positionId, 0, type(uint256).max)));
        sub.withdraw(address(usdc), vault.availableBalance(address(sub), address(usdc)));
        vm.stopPrank();
        assertEq(vault.availableBalance(address(sub), address(usdc)), 0);
    }
}
