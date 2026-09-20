// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {OptionType} from "../../src/interfaces/DataTypes.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";

/// @dev The whole stack on a 6-decimal settlement token (the testnet token, like USDC). Option maths
/// runs in 18 decimals, so every amount that reaches the Vault or RiskManager must be converted to
/// the token's base units. Before that conversion a payout of $200 was credited as 200e18 base units
/// (a trillion times too much), and options notional sat 12 decimals above perp notional in the same
/// open-interest counter.
contract OptionsSixDecimalsTest is BaseTest {
    uint256 internal constant STRIKE = 190e18;
    uint256 internal constant DOLLAR = 1e6;

    function _settlementDecimals() internal pure override returns (uint8) {
        return 6;
    }

    function _params(OptionType optionType, uint256 expiry, uint256 contracts, uint256 premium)
        internal
        view
        returns (IOptionsEngine.OpenPositionParams memory)
    {
        return IOptionsEngine.OpenPositionParams({
            marketId: NVDA,
            optionType: optionType,
            strike: STRIKE,
            expiry: expiry,
            contracts: contracts,
            premium: premium,
            deadline: block.timestamp + 1 hours
        });
    }

    function _open(OptionType optionType, uint256 expiry, uint256 contracts, uint256 premium)
        internal
        returns (uint256 positionId)
    {
        IOptionsEngine.OpenPositionParams memory params = _params(optionType, expiry, contracts, premium);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);
        vm.prank(alice);
        positionId = optionsEngine.openPosition(params, quote);
    }

    function test_settlementDecimals_isReadFromTheToken() public view {
        assertEq(optionsEngine.settlementDecimals(), 6);
    }

    function test_settle_paysTheIntrinsicValueInTokenUnits() public {
        uint256 expiry = block.timestamp + 7 days;
        _open(OptionType.CALL, expiry, 10, 5 * DOLLAR);
        uint256 balanceAfterOpen = vault.availableBalance(alice, address(usdc));

        vm.warp(expiry);
        _setPrice(210e18); // in the money by $20, ten contracts of one unit: $200
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);

        assertEq(vault.availableBalance(alice, address(usdc)) - balanceAfterOpen, 200 * DOLLAR);
    }

    function testFuzz_settle_payoutIsIntrinsicScaledToTokenUnits(uint256 settlementPrice) public {
        settlementPrice = bound(settlementPrice, 190e18 + 1, 1_000_000e18);
        uint256 expiry = block.timestamp + 7 days;
        _open(OptionType.CALL, expiry, 10, 5 * DOLLAR);
        uint256 balanceAfterOpen = vault.availableBalance(alice, address(usdc));

        vm.warp(expiry);
        _setPrice(settlementPrice);
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);

        // (price - strike) x 1 unit x 10 contracts, in 18 decimals, narrowed to 6.
        uint256 expected = ((settlementPrice - STRIKE) * 10) / 1e12;
        assertEq(vault.availableBalance(alice, address(usdc)) - balanceAfterOpen, expected);
    }

    function test_openInterest_countsOptionNotionalInTokenUnits() public {
        uint256 expiry = block.timestamp + 7 days;
        uint256 callId = _open(OptionType.CALL, expiry, 10, 5 * DOLLAR);
        // 10 contracts x 1 unit x $190
        assertEq(riskManager.openInterestLong(NVDA), 1_900 * DOLLAR);

        IOptionsEngine.Quote memory quote = _closeQuote(alice, callId, 6 * DOLLAR);
        vm.prank(alice);
        optionsEngine.closePosition(callId, 6 * DOLLAR, block.timestamp + 1 hours, quote);
        assertEq(riskManager.openInterestLong(NVDA), 0);
    }

    function test_openInterest_settlementReleasesIt() public {
        uint256 expiry = block.timestamp + 7 days;
        _open(OptionType.PUT, expiry, 4, 3 * DOLLAR);
        assertEq(riskManager.openInterestShort(NVDA), 760 * DOLLAR);

        vm.warp(expiry);
        _setPrice(200e18);
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.PUT);
        assertEq(riskManager.openInterestShort(NVDA), 0);
    }

    function test_optionAndPerpNotionalShareOneUnit() public {
        _open(OptionType.CALL, block.timestamp + 7 days, 10, 5 * DOLLAR);
        vm.prank(alice);
        perpsEngine.openPosition(NVDA, true, 1_000 * DOLLAR, 5, type(uint256).max, block.timestamp + 1 hours);

        // $1,900 of option notional plus $5,000 of perp notional, both in 6-decimal base units.
        assertEq(riskManager.openInterestLong(NVDA), 6_900 * DOLLAR);
    }

    function test_positionCap_isCheckedAgainstTokenUnitNotional() public {
        vm.startPrank(admin);
        RiskManager.RiskConfig memory config = riskManager.getRiskConfig(NVDA);
        config.maxPositionNotional = 1_000 * DOLLAR;
        riskManager.setRiskConfig(NVDA, config);
        vm.stopPrank();

        uint256 expiry = block.timestamp + 7 days;
        IOptionsEngine.OpenPositionParams memory params = _params(OptionType.CALL, expiry, 10, 5 * DOLLAR); // $1,900
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);
        vm.prank(alice);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        optionsEngine.openPosition(params, quote);

        // $950 fits.
        params = _params(OptionType.CALL, expiry, 5, 3 * DOLLAR);
        quote = _openQuote(alice, params);
        vm.prank(alice);
        optionsEngine.openPosition(params, quote);
    }
}
