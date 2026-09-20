// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {RFQManager} from "../../src/perps/RFQManager.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";

contract RFQTest is BaseTest {
    function _quote(address user, bool isLong, uint256 collateral, uint256 leverage, uint256 price, uint256 nonce)
        internal
        view
        returns (RFQManager.RFQQuote memory)
    {
        return RFQManager.RFQQuote({
            user: user,
            marketId: NVDA,
            isLong: isLong,
            collateral: collateral,
            leverage: leverage,
            price: price,
            validUntil: block.timestamp + 30,
            nonce: nonce
        });
    }

    function _sig(RFQManager.RFQQuote memory q) internal view returns (bytes memory) {
        return _signBy(quoterKey, q);
    }

    function _signBy(uint256 key, RFQManager.RFQQuote memory q) internal view returns (bytes memory) {
        return _sign(key, rfqManager.quoteDigest(q));
    }

    function _execute(RFQManager.RFQQuote memory q, bytes memory sig) internal returns (uint256) {
        vm.prank(q.user);
        return rfqManager.execute(q, sig);
    }

    // ---- an ordinary RFQ ----------------------------------------------------

    function test_execute_opensAtTheQuotedPriceNotTheMark() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 5, 190.5e18, 1); // mark is 190
        uint256 positionId = _execute(q, _sig(q));

        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertEq(pos.entryPrice, 190.5e18);
        assertEq(pos.owner, alice);
        assertEq(pos.size, 5_000e18);
        assertTrue(pos.isLong);
        assertEq(riskManager.openInterestLong(NVDA), 5_000e18);
        assertEq(vault.lockedMargin(alice, address(usdc)), 1_000e18);
    }

    function test_execute_emitsTheMakerAndPrice() public {
        RFQManager.RFQQuote memory q = _quote(alice, false, 1_000e18, 2, 189.5e18, 1);
        bytes memory sig = _sig(q);
        vm.expectEmit(true, true, true, true, address(rfqManager));
        emit RFQManager.RFQExecuted(alice, quoter, 1, 189.5e18, false);
        _execute(q, sig);
    }

    // ---- what makes a quote invalid ----------------------------------------

    function test_execute_isSingleUse() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 5, 190e18, 1);
        bytes memory sig = _sig(q);
        _execute(q, sig);
        vm.prank(alice);
        vm.expectRevert(RFQManager.QuoteAlreadyUsed.selector);
        rfqManager.execute(q, sig);
    }

    function test_execute_expires() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 5, 190e18, 1);
        bytes memory sig = _sig(q);
        vm.warp(block.timestamp + 31);
        _setPrice(190e18);
        vm.prank(alice);
        vm.expectRevert(RFQManager.QuoteExpired.selector);
        rfqManager.execute(q, sig);
    }

    function test_execute_onlyTheQuotedUser() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 5, 190e18, 1);
        bytes memory sig = _sig(q);
        vm.prank(bob);
        vm.expectRevert(RFQManager.NotQuoteUser.selector);
        rfqManager.execute(q, sig);
    }

    function test_execute_needsAMakerSignature() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 5, 190e18, 1);
        bytes memory strangerSig = _signBy(uint256(keccak256("not a maker")), q);
        vm.prank(alice);
        vm.expectRevert(RFQManager.InvalidQuote.selector);
        rfqManager.execute(q, strangerSig);

        vm.prank(alice);
        vm.expectRevert(RFQManager.InvalidQuote.selector);
        rfqManager.execute(q, hex"1234"); // not a signature at all
    }

    function test_execute_aTamperedQuoteIsRejected() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 5, 190e18, 1);
        bytes memory sig = _sig(q);
        q.price = 185e18; // a better price than the maker signed
        vm.prank(alice);
        vm.expectRevert(RFQManager.InvalidQuote.selector);
        rfqManager.execute(q, sig);
    }

    function test_execute_aRevokedMakerCannotBeUsed() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 5, 190e18, 1);
        bytes memory sig = _sig(q);
        bytes32 role = rfqManager.MAKER_ROLE();
        vm.prank(admin);
        rfqManager.revokeRole(role, quoter);
        vm.prank(alice);
        vm.expectRevert(RFQManager.InvalidQuote.selector);
        rfqManager.execute(q, sig);
    }

    function test_execute_priceMustStayNearTheMark() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 5, 194e18, 1); // 2.1% over 190
        bytes memory sig = _sig(q);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RFQManager.PriceOutOfBand.selector, 194e18, 190e18));
        rfqManager.execute(q, sig);

        // The band is a setting.
        vm.prank(admin);
        rfqManager.setParameters(300, 0, 0);
        _execute(q, sig);
    }

    function test_execute_marginStillHasToBeThere() public {
        RFQManager.RFQQuote memory q = _quote(alice, true, 500_000e18, 10, 190e18, 1);
        bytes memory sig = _sig(q);
        vm.prank(alice);
        vm.expectRevert(); // 500,000 of margin against a 100,000 balance
        rfqManager.execute(q, sig);
    }

    function test_engine_onlyTheManagerOpensAtAPrice() public {
        vm.prank(alice);
        vm.expectRevert(PerpsEngine.NotRfqManager.selector);
        perpsEngine.openPositionAtPrice(alice, NVDA, true, 1_000e18, 5, 1e18, true);
    }

    function test_engine_managerIsWiredOnce() public {
        vm.prank(admin);
        vm.expectRevert(PerpsEngine.RfqManagerAlreadySet.selector);
        perpsEngine.setRfqManager(address(1));
        vm.prank(bob);
        vm.expectRevert(PerpsEngine.NotRfqManager.selector);
        perpsEngine.setRfqManager(address(1));
    }

    // ---- block trades -------------------------------------------------------

    function test_block_mayExceedThePositionCapWithinTheBlockLimit() public {
        // The default per-position cap is 500,000: a 1,000,000 trade is over it.
        usdc.mint(alice, 500_000e18);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(usdc), 500_000e18);
        vm.stopPrank();

        RFQManager.RFQQuote memory q = _quote(alice, true, 200_000e18, 5, 190e18, 1); // 1,000,000 notional
        bytes memory sig = _sig(q);
        vm.prank(alice);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        rfqManager.execute(q, sig);

        vm.prank(admin);
        rfqManager.setParameters(100, 600_000e18, 2_000_000e18);
        q = _quote(alice, true, 200_000e18, 5, 190e18, 2);
        vm.expectEmit(true, true, true, true, address(rfqManager));
        emit RFQManager.RFQExecuted(alice, quoter, 1, 190e18, true);
        uint256 positionId = _execute(q, _sig(q));
        assertEq(perpPositionManager.getPosition(positionId).size, 1_000_000e18);
    }

    function test_block_hasAnUpperBound() public {
        vm.prank(admin);
        rfqManager.setParameters(100, 100_000e18, 300_000e18);
        usdc.mint(alice, 500_000e18);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(usdc), 500_000e18);
        vm.stopPrank();

        RFQManager.RFQQuote memory q = _quote(alice, true, 100_000e18, 5, 190e18, 1); // 500,000 > 300,000
        bytes memory sig = _sig(q);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RFQManager.BlockTooLarge.selector, 500_000e18, 300_000e18));
        rfqManager.execute(q, sig);
    }

    function test_block_smallTradesStillFollowTheOrdinaryCap() public {
        vm.prank(admin);
        rfqManager.setParameters(100, 1_000_000e18, 2_000_000e18);
        // Under the block minimum, the ordinary 500,000 cap applies.
        RFQManager.RFQQuote memory q = _quote(alice, true, 90_000e18, 10, 190e18, 1); // 900,000
        bytes memory sig = _sig(q);
        vm.prank(alice);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        rfqManager.execute(q, sig);
    }

    function test_block_stillHonoursTheOpenInterestCap() public {
        vm.startPrank(admin);
        rfqManager.setParameters(100, 100_000e18, 2_000_000e18);
        RiskManager.RiskConfig memory config = riskManager.getRiskConfig(NVDA);
        config.openInterestCap = 500_000e18;
        riskManager.setRiskConfig(NVDA, config);
        vm.stopPrank();
        usdc.mint(alice, 500_000e18);
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(usdc), 500_000e18);
        vm.stopPrank();

        RFQManager.RFQQuote memory q = _quote(alice, true, 200_000e18, 5, 190e18, 1);
        bytes memory sig = _sig(q);
        vm.prank(alice);
        vm.expectRevert(RiskManager.OpenInterestLimitExceeded.selector);
        rfqManager.execute(q, sig);
    }

    // ---- admin --------------------------------------------------------------

    function test_parameters_areAdminOnlyAndValidated() public {
        vm.prank(bob);
        vm.expectRevert();
        rfqManager.setParameters(100, 0, 0);

        vm.startPrank(admin);
        vm.expectRevert(RFQManager.InvalidDeviation.selector);
        rfqManager.setParameters(0, 0, 0);
        vm.expectRevert(RFQManager.InvalidDeviation.selector);
        rfqManager.setParameters(10_000, 0, 0);
        vm.expectRevert(RFQManager.InvalidBlockBounds.selector);
        rfqManager.setParameters(100, 500e18, 100e18);
        vm.stopPrank();
    }

    // ---- fuzz ---------------------------------------------------------------

    /// A quote fills only when its price is inside the band around the mark, and then at exactly that price.
    function testFuzz_execute_priceBand(uint256 price) public {
        price = bound(price, 100e18, 300e18);
        RFQManager.RFQQuote memory q = _quote(alice, true, 1_000e18, 2, price, 1);
        bytes memory sig = _sig(q);
        uint256 gap = price > 190e18 ? price - 190e18 : 190e18 - price;
        vm.prank(alice);
        if (gap * 10_000 > 190e18 * 100) {
            vm.expectRevert(abi.encodeWithSelector(RFQManager.PriceOutOfBand.selector, price, 190e18));
            rfqManager.execute(q, sig);
        } else {
            uint256 id = rfqManager.execute(q, sig);
            assertEq(perpPositionManager.getPosition(id).entryPrice, price);
        }
    }
}
