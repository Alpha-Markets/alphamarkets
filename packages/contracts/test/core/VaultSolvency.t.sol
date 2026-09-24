// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {AlphaMarketsVault} from "../../src/core/AlphaMarketsVault.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";

/// @notice The vault may not owe more than it holds. A trader's profit is paid from the pool, and a
/// credit larger than the pool reverts instead of leaving the vault insolvent.
contract VaultSolvencyTest is BaseTest {
    /// A small pool, so a modest profit reaches its limit.
    function _poolSeed() internal pure override returns (uint256) {
        return 100;
    }

    function _openLong(address user, uint256 collateral, uint256 leverage) internal returns (uint256 id) {
        vm.prank(user);
        id = perpsEngine.openPosition(NVDA, true, collateral, leverage, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_poolStartsAtTheSeed_andCreditsNoAccount() public view {
        assertEq(vault.poolBalance(address(usdc)), 100e18);
        // Only the two funded users are owed anything.
        assertEq(vault.totalLiabilities(address(usdc)), 200_000e18);
        assertEq(usdc.balanceOf(address(vault)), 200_100e18);
    }

    function test_anyoneCanFundThePool_andItCreditsNoAccount() public {
        address funder = makeAddr("funder");
        usdc.mint(funder, 500e18);
        vm.startPrank(funder);
        usdc.approve(address(vault), 500e18);
        vault.fundPool(address(usdc), 500e18);
        vm.stopPrank();

        assertEq(vault.poolBalance(address(usdc)), 600e18);
        assertEq(vault.availableBalance(funder, address(usdc)), 0, "the funder holds no claim on the vault");
        assertEq(vault.totalLiabilities(address(usdc)), 200_000e18, "liabilities unchanged");
    }

    function test_fundPool_rejectsZero() public {
        vm.expectRevert(AlphaMarketsVault.ZeroAmount.selector);
        vault.fundPool(address(usdc), 0);
    }

    function test_profitWithinThePool_isPaid() public {
        uint256 id = _openLong(alice, 1_000e18, 5); // size 5,000
        _setPrice(190e18 * 1005 / 1000); // +0.5%: profit about 25
        vm.prank(alice);
        perpsEngine.closePosition(id, 0, block.timestamp + 1 hours);
        assertFalse(perpPositionManager.getPosition(id).open);
        assertLt(vault.poolBalance(address(usdc)), 100e18, "the pool paid the profit");
    }

    function test_profitBeyondThePool_revertsInsteadOfMakingTheVaultInsolvent() public {
        uint256 id = _openLong(alice, 10_000e18, 10); // size 100,000, with no losing side to pay for a win
        _setPrice(190e18 * 110 / 100); // +10%: profit about 10,000, the pool holds 100

        vm.prank(alice);
        // Profit is 10% of 100,000 = 10,000; the pool holds 100.
        vm.expectRevert(abi.encodeWithSelector(AlphaMarketsVault.InsufficientPoolReserves.selector, 10_000e18, 100e18));
        perpsEngine.closePosition(id, 0, block.timestamp + 1 hours);
        assertLe(vault.totalLiabilities(address(usdc)), usdc.balanceOf(address(vault)), "vault stays solvent");
        assertTrue(perpPositionManager.getPosition(id).open, "the position is still open");
    }

    function test_aLosingSideRefillsThePool_soAWinnerCanBePaid() public {
        // Alice wins, Bob loses the same amount on an equal and opposite position.
        uint256 aliceId = _openLong(alice, 10_000e18, 10);
        vm.prank(bob);
        uint256 bobId = perpsEngine.openPosition(NVDA, false, 10_000e18, 10, 0, block.timestamp + 1 hours);
        _setPrice(190e18 * 105 / 100); // +5%: Alice +5,000, Bob -5,000

        // Alice cannot be paid first: the pool holds 100 and Bob's loss is not realized yet.
        vm.prank(alice);
        vm.expectRevert();
        perpsEngine.closePosition(aliceId, 0, block.timestamp + 1 hours);

        // Bob realizes his loss, which the pool keeps; now Alice can be paid.
        vm.prank(bob);
        perpsEngine.closePosition(bobId, type(uint256).max, block.timestamp + 1 hours);
        vm.prank(alice);
        perpsEngine.closePosition(aliceId, 0, block.timestamp + 1 hours);

        assertLe(vault.totalLiabilities(address(usdc)), usdc.balanceOf(address(vault)));
    }

    function test_totalLiabilitiesTrackEveryLedgerChange() public {
        uint256 id = _openLong(alice, 1_000e18, 5);
        vm.prank(bob);
        vault.withdraw(address(usdc), 1_000e18);
        _setPrice(190e18 * 1002 / 1000);
        vm.prank(alice);
        perpsEngine.closePosition(id, 0, block.timestamp + 1 hours);

        uint256 ledger = collateralManager.balanceOf(alice, address(usdc))
            + collateralManager.balanceOf(bob, address(usdc))
            + collateralManager.balanceOf(address(insuranceFund), address(usdc));
        assertEq(vault.totalLiabilities(address(usdc)), ledger, "the counter equals the sum of ledger balances");
    }

    function test_poolBalanceIsNeverAboveWhatTheVaultHolds() public view {
        assertLe(vault.poolBalance(address(usdc)), usdc.balanceOf(address(vault)));
    }

    /// A vault upgraded from code that did not count liabilities has a counter at zero while users hold
    /// balances. Without the bootstrap, every withdrawal would underflow the counter.
    function test_bootstrap_makesAnUpgradedVaultWorkAgain() public {
        bytes32 slot = keccak256(abi.encode(address(usdc), uint256(2))); // totalLiabilities, appended after withdrawGuard
        vm.store(address(vault), slot, bytes32(0)); // what an upgraded vault looks like

        vm.prank(alice);
        vm.expectRevert(); // counter underflow
        vault.withdraw(address(usdc), 1_000e18);

        vm.prank(admin);
        vault.bootstrapLiabilities(address(usdc));
        assertEq(
            vault.totalLiabilities(address(usdc)), usdc.balanceOf(address(vault)), "counts every held token as owed"
        );
        assertEq(vault.poolBalance(address(usdc)), 0, "and the pool as empty");

        vm.prank(alice);
        vault.withdraw(address(usdc), 1_000e18);
        assertEq(usdc.balanceOf(alice), 1_000_000e18 - 100_000e18 + 1_000e18);
    }

    function test_bootstrap_onlyOnce_andOnlyByTheAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.bootstrapLiabilities(address(usdc));

        vm.prank(admin);
        vm.expectRevert(AlphaMarketsVault.AlreadyTracked.selector); // the counter is already above zero
        vault.bootstrapLiabilities(address(usdc));
    }
}
