// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {OptionsEngine} from "../../src/options/OptionsEngine.sol";
import {OptionType} from "../../src/interfaces/DataTypes.sol";

/// The premium is the one price input the chain cannot recompute, so these tests pin down that a
/// caller can never choose it: a missing, forged, tampered, expired, replayed or borrowed quote
/// must all fail before any money moves.
contract OptionQuotesTest is BaseTest {
    uint256 internal constant STRIKE = 190e18;

    function _params(uint256 premium) internal view returns (IOptionsEngine.OpenPositionParams memory) {
        return IOptionsEngine.OpenPositionParams({
            marketId: NVDA,
            optionType: OptionType.CALL,
            strike: STRIKE,
            expiry: block.timestamp + 7 days,
            contracts: 10,
            premium: premium,
            deadline: block.timestamp + 1 hours
        });
    }

    function test_validQuote_opensAtTheSignedPremium() public {
        IOptionsEngine.OpenPositionParams memory params = _params(5e18);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);

        uint256 before = vault.availableBalance(alice, address(usdc));
        vm.prank(alice);
        optionsEngine.openPosition(params, quote);
        assertEq(before - vault.availableBalance(alice, address(usdc)), 5e18);
    }

    function test_freePremium_withoutAQuote_reverts() public {
        IOptionsEngine.OpenPositionParams memory params = _params(0);
        IOptionsEngine.Quote memory noQuote =
            IOptionsEngine.Quote({validUntil: block.timestamp + 60, nonce: 1, signature: hex""});

        vm.prank(alice);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.openPosition(params, noQuote);
    }

    function test_quoteSignedByANonQuoter_reverts() public {
        IOptionsEngine.OpenPositionParams memory params = _params(0);
        IOptionsEngine.Quote memory forged =
            _openQuoteSignedBy(uint256(keccak256("attacker")), alice, params, block.timestamp + 60);

        vm.prank(alice);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.openPosition(params, forged);
    }

    function test_tamperedPremium_reverts() public {
        IOptionsEngine.Quote memory quote = _openQuote(alice, _params(5e18));

        // Sign for 5, submit for 0.
        vm.prank(alice);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.openPosition(_params(0), quote);
    }

    function test_tamperedSize_reverts() public {
        IOptionsEngine.OpenPositionParams memory params = _params(5e18);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);
        params.contracts = 1000;

        vm.prank(alice);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.openPosition(params, quote);
    }

    function test_quoteForAnotherUser_cannotBeUsed() public {
        IOptionsEngine.OpenPositionParams memory params = _params(5e18);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);

        vm.prank(bob);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.openPosition(params, quote);
    }

    function test_expiredQuote_reverts() public {
        IOptionsEngine.OpenPositionParams memory params = _params(5e18);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);

        vm.warp(quote.validUntil + 1);
        params.deadline = block.timestamp + 1 hours;
        params.expiry = block.timestamp + 7 days; // keep the series valid; the quote no longer matches, but expiry is checked first

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OptionsEngine.QuoteExpired.selector, quote.validUntil, block.timestamp));
        optionsEngine.openPosition(params, quote);
    }

    function test_quoteCannotBeReplayed() public {
        IOptionsEngine.OpenPositionParams memory params = _params(5e18);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);

        vm.startPrank(alice);
        optionsEngine.openPosition(params, quote);

        bytes32 digest = optionsEngine.openQuoteDigest(alice, params, quote.validUntil, quote.nonce);
        vm.expectRevert(abi.encodeWithSelector(OptionsEngine.QuoteAlreadyUsed.selector, digest));
        optionsEngine.openPosition(params, quote);
        vm.stopPrank();
    }

    function test_closeWithAnInflatedPremium_reverts() public {
        IOptionsEngine.OpenPositionParams memory params = _params(5e18);
        IOptionsEngine.Quote memory openQuote = _openQuote(alice, params);
        vm.prank(alice);
        uint256 positionId = optionsEngine.openPosition(params, openQuote);

        // The quoter priced the close at 1; the caller claims 50,000.
        IOptionsEngine.Quote memory closeQuote = _closeQuote(alice, positionId, 1e18);
        vm.prank(alice);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.closePosition(positionId, 50_000e18, block.timestamp + 1 hours, closeQuote);
    }

    function test_openQuote_cannotBeUsedToClose() public {
        IOptionsEngine.OpenPositionParams memory params = _params(5e18);
        IOptionsEngine.Quote memory openQuote = _openQuote(alice, params);
        vm.prank(alice);
        uint256 positionId = optionsEngine.openPosition(params, openQuote);

        IOptionsEngine.Quote memory fresh = _openQuote(alice, params);
        vm.prank(alice);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.closePosition(positionId, 5e18, block.timestamp + 1 hours, fresh);
    }

    function test_revokedQuoter_quotesStopWorking() public {
        IOptionsEngine.OpenPositionParams memory params = _params(5e18);
        IOptionsEngine.Quote memory quote = _openQuote(alice, params);

        bytes32 role = optionsEngine.QUOTER_ROLE();
        vm.prank(admin);
        optionsEngine.revokeRole(role, quoter);

        vm.prank(alice);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.openPosition(params, quote);
    }

    function test_onlyAdminCanGrantQuoterRole() public {
        bytes32 role = optionsEngine.QUOTER_ROLE();
        vm.prank(alice);
        vm.expectRevert();
        optionsEngine.grantRole(role, alice);
    }

    function testFuzz_anyPremiumNotSignedFails(uint256 signedPremium, uint256 submittedPremium) public {
        signedPremium = bound(signedPremium, 1, 1_000e18);
        submittedPremium = bound(submittedPremium, 0, 1_000e18);
        vm.assume(submittedPremium != signedPremium);

        IOptionsEngine.Quote memory quote = _openQuote(alice, _params(signedPremium));
        vm.prank(alice);
        vm.expectRevert(OptionsEngine.InvalidQuote.selector);
        optionsEngine.openPosition(_params(submittedPremium), quote);
    }
}
