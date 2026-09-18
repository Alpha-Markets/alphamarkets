// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OptionSettlement} from "../../src/options/OptionSettlement.sol";

contract OptionSettlementTest is Test {
    uint256 internal constant WAD = 1e18;

    function test_callIntrinsicValue_itm() public pure {
        assertEq(OptionSettlement.callIntrinsicValue(200e18, 190e18), 10e18);
    }

    function test_callIntrinsicValue_otm() public pure {
        assertEq(OptionSettlement.callIntrinsicValue(180e18, 190e18), 0);
    }

    function test_putIntrinsicValue_itm() public pure {
        assertEq(OptionSettlement.putIntrinsicValue(180e18, 190e18), 10e18);
    }

    function test_putIntrinsicValue_otm() public pure {
        assertEq(OptionSettlement.putIntrinsicValue(200e18, 190e18), 0);
    }

    function test_payout_scalesWithContracts() public pure {
        uint256 single = OptionSettlement.payout(10e18, WAD, 1);
        uint256 ten = OptionSettlement.payout(10e18, WAD, 10);
        assertEq(ten, single * 10);
    }

    /// @dev Invariant: intrinsic value is never negative (guaranteed by uint256 return
    /// type) and is exactly the max() formula from PROJECT_BRIEF.md Section 9.
    function testFuzz_callIntrinsicValue(uint256 settlementPrice, uint256 strike) public pure {
        settlementPrice = bound(settlementPrice, 0, 1_000_000e18);
        strike = bound(strike, 0, 1_000_000e18);

        uint256 intrinsic = OptionSettlement.callIntrinsicValue(settlementPrice, strike);
        if (settlementPrice > strike) {
            assertEq(intrinsic, settlementPrice - strike);
        } else {
            assertEq(intrinsic, 0);
        }
    }

    function testFuzz_putIntrinsicValue(uint256 settlementPrice, uint256 strike) public pure {
        settlementPrice = bound(settlementPrice, 0, 1_000_000e18);
        strike = bound(strike, 0, 1_000_000e18);

        uint256 intrinsic = OptionSettlement.putIntrinsicValue(settlementPrice, strike);
        if (strike > settlementPrice) {
            assertEq(intrinsic, strike - settlementPrice);
        } else {
            assertEq(intrinsic, 0);
        }
    }

    /// @dev Invariant: payout scales linearly with contract count.
    function testFuzz_payoutLinearInContracts(uint256 intrinsic, uint256 contractSize, uint8 contracts) public pure {
        intrinsic = bound(intrinsic, 0, 100_000e18);
        contractSize = bound(contractSize, 1e15, 10e18);
        vm.assume(contracts > 0);

        uint256 one = OptionSettlement.payout(intrinsic, contractSize, 1);
        uint256 many = OptionSettlement.payout(intrinsic, contractSize, contracts);
        assertEq(many, one * contracts);
    }
}
