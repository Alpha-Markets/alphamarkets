// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {OptionType} from "../../src/interfaces/DataTypes.sol";
import {OptionPositionManager} from "../../src/options/OptionPositionManager.sol";

contract OptionsOpenToSettleTest is BaseTest {
    function _params(OptionType optionType, uint256 strike, uint256 expiry, uint256 premium)
        internal
        view
        returns (IOptionsEngine.OpenPositionParams memory)
    {
        return IOptionsEngine.OpenPositionParams({
            marketId: NVDA,
            optionType: optionType,
            strike: strike,
            expiry: expiry,
            contracts: 10,
            premium: premium,
            deadline: block.timestamp + 1 hours
        });
    }

    function test_openCallOption_itmAtExpiry_paysOut() public {
        uint256 strike = 190e18;
        uint256 expiry = block.timestamp + 7 days;
        uint256 premium = 5e18;

        IOptionsEngine.OpenPositionParams memory params = _params(OptionType.CALL, strike, expiry, premium);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);
        vm.prank(alice);
        uint256 positionId = optionsEngine.openPosition(params, quote);

        uint256 balanceAfterOpen = vault.availableBalance(alice, address(usdc));
        assertEq(balanceAfterOpen, 100_000e18 - premium); // no open fee configured by default

        vm.warp(expiry);
        _setPrice(210e18); // ITM by 20

        optionsEngine.settleExpired(NVDA, expiry, strike, OptionType.CALL);

        OptionPositionManager.OptionPosition memory pos = optionPositionManager.getPosition(positionId);
        assertEq(uint256(pos.status), uint256(OptionPositionManager.PositionStatus.SETTLED));

        // payout = intrinsic(20) * contractSize(1) * contracts(10) = 200
        uint256 expectedPayout = 200e18;
        assertEq(vault.availableBalance(alice, address(usdc)), balanceAfterOpen + expectedPayout);
    }

    function test_openPutOption_otmAtExpiry_paysNothing() public {
        uint256 strike = 190e18;
        uint256 expiry = block.timestamp + 7 days;

        IOptionsEngine.OpenPositionParams memory params = _params(OptionType.PUT, strike, expiry, 5e18);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);
        vm.prank(alice);
        optionsEngine.openPosition(params, quote);

        uint256 balanceAfterOpen = vault.availableBalance(alice, address(usdc));

        vm.warp(expiry);
        _setPrice(210e18); // put is OTM since price rose above strike

        optionsEngine.settleExpired(NVDA, expiry, strike, OptionType.PUT);

        assertEq(vault.availableBalance(alice, address(usdc)), balanceAfterOpen);
    }

    function test_closePosition_beforeExpiry() public {
        uint256 strike = 190e18;
        uint256 expiry = block.timestamp + 7 days;

        IOptionsEngine.OpenPositionParams memory params = _params(OptionType.CALL, strike, expiry, 5e18);
        IOptionsEngine.Quote memory openQuote = _openQuote(alice, params);
        vm.prank(alice);
        uint256 positionId = optionsEngine.openPosition(params, openQuote);

        uint256 balanceBeforeClose = vault.availableBalance(alice, address(usdc));
        IOptionsEngine.Quote memory closeQuote = _closeQuote(alice, positionId, 8e18);
        vm.prank(alice);
        optionsEngine.closePosition(positionId, 8e18, block.timestamp + 1 hours, closeQuote);

        OptionPositionManager.OptionPosition memory pos = optionPositionManager.getPosition(positionId);
        assertEq(uint256(pos.status), uint256(OptionPositionManager.PositionStatus.CLOSED));
        assertEq(vault.availableBalance(alice, address(usdc)), balanceBeforeClose + 8e18);
    }
}
