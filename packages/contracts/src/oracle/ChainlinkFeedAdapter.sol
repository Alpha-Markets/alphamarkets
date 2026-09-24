// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";

/// @notice The slice of Chainlink's `AggregatorV3Interface` this adapter reads.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Lets `OracleRouter` read a Chainlink price feed, which it cannot do directly: the router calls
/// `latestPrice()` and `decimals()` (see {IPriceFeed}), and Chainlink exposes `latestRoundData()`.
///
/// It adds no policy. It returns the feed's answer and the time it was last updated, and refuses an answer
/// that is not a positive price or carries an impossible timestamp. Freshness and the agreement between two
/// sources are decided by the router and `PriceValidator` per market, so a stale feed reverts there with
/// `StaleOraclePrice`, exactly as it does for any other source.
///
/// It is immutable and not behind a proxy: replacing a feed means deploying a new adapter and calling
/// `OracleRouter.setPrimarySource`, which is an admin action. The feed address cannot be changed after
/// deployment, so no key can redirect an adapter to a different price.
contract ChainlinkFeedAdapter is IPriceFeed {
    IAggregatorV3 public immutable feed;
    uint8 public immutable feedDecimals;

    error ZeroAddress();
    error InvalidAnswer(int256 answer);
    error InvalidTimestamp(uint256 updatedAt);

    constructor(address feed_) {
        if (feed_ == address(0)) revert ZeroAddress();
        feed = IAggregatorV3(feed_);
        feedDecimals = IAggregatorV3(feed_).decimals();
    }

    function latestPrice() external view returns (uint256 price, uint256 timestamp) {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidAnswer(answer);
        if (updatedAt == 0 || updatedAt > block.timestamp) revert InvalidTimestamp(updatedAt);
        return (uint256(answer), updatedAt);
    }

    function decimals() external view returns (uint8) {
        return feedDecimals;
    }

    /// @notice The feed's own name, for a human or a script to check that this adapter reads the intended pair.
    function description() external view returns (string memory) {
        return feed.description();
    }
}
