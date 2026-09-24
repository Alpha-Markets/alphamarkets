// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {OptionsEngine} from "../../src/options/OptionsEngine.sol";
import {OptionType} from "../../src/interfaces/DataTypes.sol";

/// @notice A signed premium is bounded on chain, so a compromised quoter key cannot sell an option for nothing
/// or buy one back for more than the underlying is worth.
contract PremiumBoundsTest is BaseTest {
    // Spot is 190. Ten contracts of one token each.
    uint256 internal constant CONTRACTS = 10;

    function _params(OptionType optionType, uint256 strike, uint256 premium)
        internal
        view
        returns (IOptionsEngine.OpenPositionParams memory)
    {
        return IOptionsEngine.OpenPositionParams({
            marketId: NVDA,
            optionType: optionType,
            strike: strike,
            expiry: block.timestamp + 7 days,
            contracts: CONTRACTS,
            premium: premium,
            deadline: block.timestamp + 1 hours
        });
    }

    function _open(OptionType optionType, uint256 strike, uint256 premium) internal returns (uint256 id) {
        IOptionsEngine.OpenPositionParams memory p = _params(optionType, strike, premium);
        IOptionsEngine.Quote memory quote = _openQuote(alice, p);
        vm.prank(alice);
        id = optionsEngine.openPosition(p, quote);
    }

    function _expectOutOfBounds(OptionType optionType, uint256 strike, uint256 premium) internal {
        IOptionsEngine.OpenPositionParams memory p = _params(optionType, strike, premium);
        IOptionsEngine.Quote memory quote = _openQuote(alice, p);
        vm.prank(alice);
        vm.expectPartialRevert(OptionsEngine.PremiumOutOfBounds.selector);
        optionsEngine.openPosition(p, quote);
    }

    function test_open_rejectsAFreeOption() public {
        _expectOutOfBounds(OptionType.CALL, 190e18, 0);
    }

    function test_open_acceptsAnAtTheMoneyPremium() public {
        assertGt(_open(OptionType.CALL, 190e18, 50e18), 0);
    }

    function test_open_rejectsAnInTheMoneyCallSoldBelowItsIntrinsicValue() public {
        // Strike 100 with spot 190: intrinsic value is 90 x 10 = 900.
        _expectOutOfBounds(OptionType.CALL, 100e18, 5e18);
        assertGt(_open(OptionType.CALL, 100e18, 900e18), 0);
    }

    function test_open_rejectsAnInTheMoneyPutSoldBelowItsIntrinsicValue() public {
        // Strike 250 with spot 190: intrinsic value is 60 x 10 = 600.
        _expectOutOfBounds(OptionType.PUT, 250e18, 10e18);
        assertGt(_open(OptionType.PUT, 250e18, 600e18), 0);
    }

    function test_open_toleratesAPriceThatMovedALittleSinceTheQuote() public {
        // 1.5% under the intrinsic value of 900 is inside the 2% tolerance.
        assertGt(_open(OptionType.CALL, 100e18, 900e18 * 985 / 1000), 0);
        // 3% under it is not.
        _expectOutOfBounds(OptionType.CALL, 100e18, 900e18 * 970 / 1000);
    }

    function test_open_rejectsAPremiumAboveTheValueOfTheUnderlying() public {
        // The underlying is worth 190 x 10 = 1,900 (the strike is 190).
        _expectOutOfBounds(OptionType.CALL, 190e18, 1_901e18);
        assertGt(_open(OptionType.CALL, 190e18, 1_900e18), 0);
    }

    function test_close_rejectsAPremiumAboveTheValueOfTheUnderlying() public {
        uint256 id = _open(OptionType.CALL, 190e18, 50e18);
        IOptionsEngine.Quote memory quote = _closeQuote(alice, id, 1_901e18);
        vm.prank(alice);
        vm.expectPartialRevert(OptionsEngine.PremiumOutOfBounds.selector);
        optionsEngine.closePosition(id, 1_901e18, block.timestamp + 1 hours, quote);
    }

    function test_close_allowsAnyPremiumWithinTheCeiling_evenBelowIntrinsic() public {
        uint256 id = _open(OptionType.CALL, 190e18, 50e18);
        IOptionsEngine.Quote memory quote = _closeQuote(alice, id, 1e18);
        vm.prank(alice);
        optionsEngine.closePosition(id, 1e18, block.timestamp + 1 hours, quote);
    }

    function test_open_needsAFreshOraclePrice() public {
        vm.warp(block.timestamp + 5 hours); // the mock feed is stale after an hour
        IOptionsEngine.OpenPositionParams memory p = _params(OptionType.CALL, 190e18, 50e18);
        p.expiry = block.timestamp + 7 days;
        p.deadline = block.timestamp + 1 hours;
        IOptionsEngine.Quote memory quote = _openQuote(alice, p);
        vm.prank(alice);
        vm.expectRevert(); // StaleOraclePrice
        optionsEngine.openPosition(p, quote);
    }

    function testFuzz_open_acceptsExactlyThePremiumsInsideTheBounds(uint256 premium) public {
        premium = bound(premium, 0, 3_000e18);
        // Strike 150, spot 190, 10 contracts: intrinsic 400, floor 392 (2% tolerance), ceiling 1,900.
        IOptionsEngine.OpenPositionParams memory p = _params(OptionType.CALL, 150e18, premium);
        IOptionsEngine.Quote memory quote = _openQuote(alice, p);
        vm.prank(alice);
        if (premium < 392e18 || premium > 1_900e18) {
            vm.expectPartialRevert(OptionsEngine.PremiumOutOfBounds.selector);
        }
        optionsEngine.openPosition(p, quote);
    }
}
