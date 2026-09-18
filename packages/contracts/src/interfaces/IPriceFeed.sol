// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal adapter surface OracleRouter routes to (primary/fallback per market).
/// A real implementation wraps a concrete price source (e.g. Chainlink-style aggregator);
/// `MockPriceFeed` implements this for local/testnet use until a real feed is confirmed.
interface IPriceFeed {
    /// @return price The raw price, scaled to `decimals()`.
    /// @return timestamp The unix timestamp the price was last updated.
    function latestPrice() external view returns (uint256 price, uint256 timestamp);

    function decimals() external view returns (uint8);
}
