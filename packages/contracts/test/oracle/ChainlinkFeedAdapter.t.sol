// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {ChainlinkFeedAdapter} from "../../src/oracle/ChainlinkFeedAdapter.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";
import {MockAggregator} from "../mocks/MockAggregator.sol";

/// @notice The adapter turns a Chainlink feed (8 decimals, `latestRoundData`) into what the router reads, and the
/// router still applies its own freshness and normalization.
contract ChainlinkFeedAdapterTest is BaseTest {
    bytes32 internal constant AAPL = bytes32("AAPL");
    MockAggregator internal aggregator;
    ChainlinkFeedAdapter internal adapter;

    function setUp() public override {
        super.setUp();
        aggregator = new MockAggregator(8, "Robinhood AAPL / USD", 338_10000000); // 338.10 at 8 decimals
        adapter = new ChainlinkFeedAdapter(address(aggregator));
    }

    function test_returnsTheFeedAnswerAndTimestamp() public view {
        (uint256 price, uint256 timestamp) = adapter.latestPrice();
        assertEq(price, 338_10000000);
        assertEq(timestamp, block.timestamp);
        assertEq(adapter.decimals(), 8);
        assertEq(adapter.description(), "Robinhood AAPL / USD");
    }

    function test_routerNormalizesTheFeedTo18Decimals() public {
        vm.startPrank(admin);
        oracleRouter.setPrimarySource(AAPL, address(adapter), 8);
        vm.stopPrank();
        (uint256 price,) = oracleRouter.getIndexPrice(AAPL);
        assertEq(price, 338.1e18, "8-decimal feed read as an 18-decimal price");
    }

    function test_aStaleFeedIsRejectedByTheRouterNotTheAdapter() public {
        vm.startPrank(admin);
        oracleRouter.setPrimarySource(AAPL, address(adapter), 8);
        priceValidator.setMaxPriceAge(AAPL, 3 hours);
        vm.stopPrank();

        vm.warp(block.timestamp + 2 hours);
        (uint256 price,) = oracleRouter.getIndexPrice(AAPL); // inside this market's own limit
        assertGt(price, 0);

        vm.warp(block.timestamp + 2 hours); // now 4 hours old
        vm.expectRevert(PriceValidator.StaleOraclePrice.selector);
        oracleRouter.getIndexPrice(AAPL);
    }

    function test_rejectsAZeroOrNegativeAnswer() public {
        aggregator.set(0, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.InvalidAnswer.selector, int256(0)));
        adapter.latestPrice();
        aggregator.set(-5, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.InvalidAnswer.selector, int256(-5)));
        adapter.latestPrice();
    }

    function test_rejectsAnImpossibleTimestamp() public {
        aggregator.set(1e8, 0);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkFeedAdapter.InvalidTimestamp.selector, uint256(0)));
        adapter.latestPrice();
        aggregator.set(1e8, block.timestamp + 1 days);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkFeedAdapter.InvalidTimestamp.selector, block.timestamp + 1 days)
        );
        adapter.latestPrice();
    }

    function test_rejectsAZeroFeedAddress() public {
        vm.expectRevert(ChainlinkFeedAdapter.ZeroAddress.selector);
        new ChainlinkFeedAdapter(address(0));
    }

    function testFuzz_anyPositiveAnswerPassesThroughUnchanged(uint96 answer) public {
        vm.assume(answer > 0);
        aggregator.set(int256(uint256(answer)), block.timestamp);
        (uint256 price,) = adapter.latestPrice();
        assertEq(price, uint256(answer));
    }
}
