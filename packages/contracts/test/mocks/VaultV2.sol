// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AlphaMarketsVault} from "../../src/core/AlphaMarketsVault.sol";

/// @dev A later version of the vault, with one new function and one new state variable appended.
contract VaultV2 is AlphaMarketsVault {
    uint256 public v2Counter;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address collateralManager_) AlphaMarketsVault(collateralManager_) {}

    function version() external pure returns (uint256) {
        return 2;
    }

    function bump() external {
        v2Counter++;
    }
}
