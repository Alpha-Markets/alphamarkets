// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MarketConfig} from "./DataTypes.sol";

/// @notice Single source of truth for which markets exist and their product config.
/// Frontend, SDK, and every protocol contract query this instead of holding a local list.
interface IMarketRegistry {
    function getMarket(bytes32 marketId) external view returns (MarketConfig memory);

    function isActive(bytes32 marketId) external view returns (bool);

    function isOptionsEnabled(bytes32 marketId) external view returns (bool);

    function isPerpsEnabled(bytes32 marketId) external view returns (bool);
}
