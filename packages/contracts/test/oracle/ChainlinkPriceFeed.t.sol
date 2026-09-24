// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ChainlinkPriceFeed} from "../../src/oracle/ChainlinkPriceFeed.sol";
import {OracleRouter} from "../../src/oracle/OracleRouter.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";
import {MockChainlinkAggregator} from "../mocks/MockChainlinkAggregator.sol";

contract ChainlinkPriceFeedTest is Test {
    bytes32 internal constant NVDA = bytes32("NVDA");
    int256 internal constant PRICE = 224_40881781; // $224.40881781 at 8 decimals

    MockChainlinkAggregator internal aggregator;
    ChainlinkPriceFeed internal adapter;
    OracleRouter internal router;
    PriceValidator internal validator;

    function setUp() public {
        vm.warp(1_800_000_000);
        aggregator = new MockChainlinkAggregator(8, PRICE);
        adapter = new ChainlinkPriceFeed(address(aggregator));

        validator = PriceValidator(
            _proxy(address(new PriceValidator()), abi.encodeCall(PriceValidator.initialize, (address(this))))
        );
        router = OracleRouter(
            _proxy(
                address(new OracleRouter(address(validator))), abi.encodeCall(OracleRouter.initialize, (address(this)))
            )
        );
        router.setPrimarySource(NVDA, address(adapter), adapter.decimals());
    }

    function _proxy(address impl, bytes memory data) internal returns (address) {
        return address(new ERC1967Proxy(impl, data));
    }

    function test_returnsTheFeedPriceTimestampAndDecimals() public view {
        (uint256 price, uint256 timestamp) = adapter.latestPrice();
        assertEq(price, uint256(PRICE));
        assertEq(timestamp, block.timestamp);
        assertEq(adapter.decimals(), 8);
    }

    function test_routerNormalisesTheFeedPriceTo18Decimals() public view {
        (uint256 price,) = router.getIndexPrice(NVDA);
        assertEq(price, uint256(PRICE) * 1e10);
    }

    function test_zeroAggregatorIsRejected() public {
        vm.expectRevert(ChainlinkPriceFeed.ZeroAddress.selector);
        new ChainlinkPriceFeed(address(0));
    }

    function test_nonPositiveAnswerReverts() public {
        aggregator.set(2, 0, block.timestamp, 2);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceFeed.InvalidAnswer.selector, int256(0), block.timestamp));
        adapter.latestPrice();

        aggregator.set(3, -5, block.timestamp, 3);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceFeed.InvalidAnswer.selector, int256(-5), block.timestamp));
        adapter.latestPrice();
    }

    function test_unsetOrFutureTimestampReverts() public {
        aggregator.set(2, PRICE, 0, 2);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceFeed.InvalidAnswer.selector, PRICE, uint256(0)));
        adapter.latestPrice();

        aggregator.set(3, PRICE, block.timestamp + 1, 3);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceFeed.InvalidAnswer.selector, PRICE, block.timestamp + 1));
        adapter.latestPrice();
    }

    function test_incompleteRoundReverts() public {
        aggregator.set(5, PRICE, block.timestamp, 4);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkPriceFeed.IncompleteRound.selector, uint80(5), uint80(4)));
        adapter.latestPrice();
    }

    function test_stalePriceIsRefusedByTheRouterUsingTheMarketAgeLimit() public {
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(PriceValidator.StaleOraclePrice.selector);
        router.getIndexPrice(NVDA);

        // A per-market limit (for example a feed with a 24 hour heartbeat) makes the same price readable.
        validator.setMaxPriceAge(NVDA, 25 hours);
        (uint256 price,) = router.getIndexPrice(NVDA);
        assertEq(price, uint256(PRICE) * 1e10);
    }

    function test_aBadAnswerNeverBecomesARouterPrice() public {
        aggregator.set(2, 0, block.timestamp, 2);
        vm.expectRevert();
        router.getIndexPrice(NVDA);
    }

    function testFuzz_scalesAnyPositivePriceExactly(uint128 rawPrice) public {
        vm.assume(rawPrice > 0);
        aggregator.set(2, int256(uint256(rawPrice)), block.timestamp, 2);
        (uint256 price,) = router.getIndexPrice(NVDA);
        assertEq(price, uint256(rawPrice) * 1e10);
    }
}
