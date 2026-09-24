// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";

/// @notice `maxNetOpenInterest` bounds the difference between long and short open interest, because the
/// vault is the counterparty to that difference.
contract NetOpenInterestTest is BaseTest {
    function _cap(uint256 value) internal {
        vm.prank(admin);
        riskManager.setMaxNetOpenInterest(NVDA, value);
    }

    function _open(address user, bool isLong, uint256 collateral, uint256 leverage) internal {
        vm.prank(user);
        perpsEngine.openPosition(
            NVDA, isLong, collateral, leverage, isLong ? type(uint256).max : 0, block.timestamp + 1 hours
        );
    }

    function test_unset_meansNoNetLimit() public {
        assertEq(riskManager.maxNetOpenInterest(NVDA), 0);
        _open(alice, true, 10_000e18, 10); // 100,000 long, nothing short
        assertEq(riskManager.openInterestLong(NVDA), 100_000e18);
    }

    function test_blocksAPositionThatWidensTheGapPastTheLimit() public {
        _cap(50_000e18);
        _open(alice, true, 5_000e18, 10); // net 50,000: exactly at the limit, allowed
        vm.prank(alice);
        vm.expectRevert(RiskManager.NetOpenInterestLimitExceeded.selector);
        perpsEngine.openPosition(NVDA, true, 100e18, 10, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_allowsAPositionOnTheSmallerSide_evenWhileOverTheLimit() public {
        _open(alice, true, 10_000e18, 10); // 100,000 long
        _cap(50_000e18); // now the market is over its limit
        _open(bob, false, 1_000e18, 10); // 10,000 short reduces the gap, so it is allowed
        assertEq(riskManager.openInterestShort(NVDA), 10_000e18);
    }

    function test_shortsAndLongsCancel() public {
        _cap(10_000e18);
        _open(alice, true, 1_000e18, 10); // net 10,000
        _open(bob, false, 1_000e18, 10); // net 0
        _open(alice, true, 1_000e18, 10); // net 10,000 again, still within the limit
        assertEq(riskManager.openInterestLong(NVDA), 20_000e18);
        assertEq(riskManager.openInterestShort(NVDA), 10_000e18);
    }

    function test_onlyRiskAdminSetsIt() public {
        vm.prank(alice);
        vm.expectRevert();
        riskManager.setMaxNetOpenInterest(NVDA, 1);
    }

    function testFuzz_gapNeverExceedsTheLimitByMoreThanAnOpenTrade(uint256 seed) public {
        uint256 cap = 30_000e18;
        _cap(cap);
        for (uint256 i; i < 12; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            bool isLong = seed % 2 == 0;
            uint256 collateral = (1 + (seed >> 8) % 2_000) * 1e18;
            vm.prank(isLong ? alice : bob);
            try perpsEngine.openPosition(
                NVDA, isLong, collateral, 5, isLong ? type(uint256).max : 0, block.timestamp + 1 hours
            ) {}
                catch {}
            uint256 l = riskManager.openInterestLong(NVDA);
            uint256 s = riskManager.openInterestShort(NVDA);
            assertLe(l > s ? l - s : s - l, cap, "the gap is above the limit");
        }
    }
}
