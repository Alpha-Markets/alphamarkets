// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {OptionsEngine} from "../../src/options/OptionsEngine.sol";
import {OptionType} from "../../src/interfaces/DataTypes.sol";

/// @notice The premium bounds on a 6-decimal settlement token, the shape of USDG and USDC on Robinhood Chain.
/// The bounds are worked out in 18 decimals and converted to the token's base units, so the same limits must hold
/// at 6 decimals as at 18.
contract PremiumBoundsSixDecimalsTest is BaseTest {
    uint256 internal constant DOLLAR = 1e6;

    function _settlementDecimals() internal pure override returns (uint8) {
        return 6;
    }

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
            contracts: 10,
            premium: premium,
            deadline: block.timestamp + 1 hours
        });
    }

    function _tryOpen(OptionType optionType, uint256 strike, uint256 premium, bool expectRevert_) internal {
        IOptionsEngine.OpenPositionParams memory p = _params(optionType, strike, premium);
        IOptionsEngine.Quote memory quote = _openQuote(alice, p);
        vm.prank(alice);
        if (expectRevert_) vm.expectPartialRevert(OptionsEngine.PremiumOutOfBounds.selector);
        optionsEngine.openPosition(p, quote);
    }

    // Spot is 190, ten contracts of one token each.

    function test_atTheMoney_acceptsAnOrdinaryPremium_rejectsFreeOnes() public {
        _tryOpen(OptionType.CALL, 190e18, 50 * DOLLAR, false);
        _tryOpen(OptionType.CALL, 190e18, 0, true);
    }

    function test_inTheMoneyCall_floorIsTheIntrinsicValueInTokenUnits() public {
        // Strike 100: intrinsic 90 x 10 = 900 dollars, floor 882 with the 2% tolerance.
        _tryOpen(OptionType.CALL, 100e18, 881 * DOLLAR, true);
        _tryOpen(OptionType.CALL, 100e18, 883 * DOLLAR, false);
    }

    function test_ceilingIsTheValueOfTheUnderlyingInTokenUnits() public {
        // The underlying is worth 190 x 10 = 1,900 dollars (strike 190).
        _tryOpen(OptionType.CALL, 190e18, 1_901 * DOLLAR, true);
        _tryOpen(OptionType.CALL, 190e18, 1_900 * DOLLAR, false);
    }

    function test_inTheMoneyPut_floorIsTheIntrinsicValueInTokenUnits() public {
        // Strike 250: intrinsic 60 x 10 = 600 dollars, floor 588.
        _tryOpen(OptionType.PUT, 250e18, 587 * DOLLAR, true);
        _tryOpen(OptionType.PUT, 250e18, 590 * DOLLAR, false);
    }
}
