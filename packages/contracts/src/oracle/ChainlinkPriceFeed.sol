// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";
import {IChainlinkAggregator} from "../interfaces/IChainlinkAggregator.sol";

/// @notice Read-only adapter that lets `OracleRouter` use a Chainlink data feed proxy as a price source.
/// It holds no state and no owner: nobody can push or change a price, unlike `MockPriceFeed`.
///
/// It reverts, rather than returning a value the router would trust, when the feed answers with a
/// non-positive price, an unset or future timestamp, or an incomplete round. `OracleRouter` treats a
/// revert as "this source is unusable" (it falls back, or fails the read), so a bad answer never
/// becomes a price.
///
/// Staleness is not decided here. It is decided by `PriceValidator` from the returned timestamp, per
/// market (`setMaxPriceAge`). Chainlink's Robinhood Chain stock feeds have a 24 hour heartbeat and
/// update only while the market trades, so the age limit per market is a launch decision, not a default.
contract ChainlinkPriceFeed is IPriceFeed {
    IChainlinkAggregator public immutable aggregator;
    uint8 private immutable _decimals;

    error ZeroAddress();
    /// @dev The feed reported a price or timestamp that cannot be used.
    error InvalidAnswer(int256 answer, uint256 updatedAt);
    error IncompleteRound(uint80 roundId, uint80 answeredInRound);

    constructor(address aggregator_) {
        if (aggregator_ == address(0)) revert ZeroAddress();
        aggregator = IChainlinkAggregator(aggregator_);
        _decimals = IChainlinkAggregator(aggregator_).decimals();
    }

    function latestPrice() external view returns (uint256 price, uint256 timestamp) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = aggregator.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert InvalidAnswer(answer, updatedAt);
        if (answeredInRound < roundId) revert IncompleteRound(roundId, answeredInRound);
        return (uint256(answer), updatedAt);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}
