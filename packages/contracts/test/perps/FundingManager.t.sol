// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";

/// @notice NOTE: OracleRouter resolves `getMarkPrice` and `getIndexPrice` identically for
/// MVP (no independent onchain mark price source — see OracleRouter's NatSpec), so
/// `updateFundingRate`'s `(mark - index) / index` is always exactly 0 in this contract
/// suite: funding is structurally a no-op until a real mark-price mechanism exists. That is
/// intentional per the approved Phase 1 plan, not a bug — these tests assert that actual
/// (degenerate) behavior, and exercise `settleFunding`'s zero-sum accounting logic directly
/// via the funding index rather than relying on `updateFundingRate` to move it.
contract FundingManagerTest is BaseTest {
    using stdStorage for StdStorage;

    function _openLong(address user, uint256 collateral, uint256 leverage) internal returns (uint256) {
        vm.prank(user);
        return perpsEngine.openPosition(NVDA, true, collateral, leverage, type(uint256).max, block.timestamp + 1 hours);
    }

    function _openShort(address user, uint256 collateral, uint256 leverage) internal returns (uint256) {
        vm.prank(user);
        return perpsEngine.openPosition(NVDA, false, collateral, leverage, 0, block.timestamp + 1 hours);
    }

    function test_updateFundingRate_isNoopWhenMarkEqualsIndex() public {
        fundingManager.updateFundingRate(NVDA);
        assertEq(fundingManager.cumulativeFundingIndex(NVDA), 0);
        assertEq(fundingManager.currentFundingRateBps(NVDA), 0);
    }

    function test_updateFundingRate_noopBeforeIntervalElapsed() public {
        fundingManager.updateFundingRate(NVDA);
        uint256 firstTimestamp = fundingManager.lastFundingTimestamp(NVDA);

        vm.warp(block.timestamp + 10 minutes); // default interval is 1 hour
        fundingManager.updateFundingRate(NVDA);

        assertEq(fundingManager.lastFundingTimestamp(NVDA), firstTimestamp);
    }

    /// @dev Invariant: whatever a long position pays in funding for a given index delta,
    /// an equal-size short pays the exact negative — a zero-sum transfer routed through the
    /// shared Vault pool. Forces a non-zero index delta directly (bypassing
    /// `updateFundingRate`, which cannot move under MVP's mark==index oracle) to exercise
    /// `settleFunding`'s accounting math on both sides of the trade.
    function testFuzz_settleFunding_zeroSumBetweenEqualSizedLongAndShort(int32 rateBpsRaw) public {
        int256 forcedIndex = bound(int256(rateBpsRaw), -10_000, 10_000);
        vm.assume(forcedIndex != 0);

        uint256 longId = _openLong(alice, 10_000e18, 2);
        uint256 shortId = _openShort(bob, 10_000e18, 2);

        // Both positions opened at the same funding index (0); force the market's
        // cumulative index forward directly to simulate elapsed funding accrual. Uses
        // stdstore to locate the mapping slot rather than a hardcoded layout guess.
        stdstore.target(address(fundingManager))
            .sig(fundingManager.cumulativeFundingIndex.selector)
            .with_key(NVDA)
            .checked_write(uint256(forcedIndex));
        assertEq(fundingManager.cumulativeFundingIndex(NVDA), forcedIndex);

        uint256 aliceBefore = vault.availableBalance(alice, address(usdc));
        uint256 bobBefore = vault.availableBalance(bob, address(usdc));

        vm.prank(address(perpsEngine));
        int256 longFunding = fundingManager.settleFunding(longId);
        vm.prank(address(perpsEngine));
        int256 shortFunding = fundingManager.settleFunding(shortId);

        assertEq(longFunding, -shortFunding);

        uint256 aliceAfter = vault.availableBalance(alice, address(usdc));
        uint256 bobAfter = vault.availableBalance(bob, address(usdc));

        assertEq(int256(aliceAfter) - int256(aliceBefore), longFunding);
        assertEq(int256(bobAfter) - int256(bobBefore), shortFunding);
    }
}
