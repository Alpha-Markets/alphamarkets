// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A Chainlink-shaped aggregator for tests: `AggregatorV3Interface` with a settable answer.
contract MockAggregator {
    uint8 public immutable decimals;
    string public description;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 decimals_, string memory description_, int256 answer_) {
        decimals = decimals_;
        description = description_;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
