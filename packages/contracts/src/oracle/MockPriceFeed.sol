// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";

/// @notice Minimal testnet/local stand-in for a real price feed adapter (e.g. Chainlink).
/// Deployed and pushed to by a trusted keeper on testnet; swap for a real adapter that
/// implements `IPriceFeed` before mainnet once a provider is confirmed.
contract MockPriceFeed is IPriceFeed {
    address public immutable owner;
    uint8 private immutable _decimals;

    uint256 private _price;
    uint256 private _timestamp;

    error NotOwner();

    constructor(address owner_, uint8 decimals_, uint256 initialPrice) {
        owner = owner_;
        _decimals = decimals_;
        _price = initialPrice;
        _timestamp = block.timestamp;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setPrice(uint256 price) external onlyOwner {
        _price = price;
        _timestamp = block.timestamp;
    }

    function latestPrice() external view returns (uint256 price, uint256 timestamp) {
        return (_price, _timestamp);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}
