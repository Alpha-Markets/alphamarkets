// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {MarketConfig} from "../interfaces/DataTypes.sol";

/// @notice Single source of truth for which markets exist, their underlying token, oracle
/// mapping, and which product types are enabled. Every other contract queries this instead
/// of holding its own market list (PROJECT_BRIEF.md Section 18).
contract MarketRegistry is IMarketRegistry, AccessControl {
    /// @notice Role permitted to add/update/pause markets. Intended to migrate to a
    /// TimelockController-held role without any contract change (Section 37).
    bytes32 public constant MARKET_ADMIN_ROLE = keccak256("MARKET_ADMIN_ROLE");

    error MarketAlreadyExists(bytes32 marketId);
    error MarketDoesNotExist(bytes32 marketId);
    error ZeroAddress();

    event MarketAdded(bytes32 indexed marketId, address underlyingToken, bytes32 oracleId);
    event MarketUpdated(bytes32 indexed marketId, address underlyingToken, bytes32 oracleId, bool active);

    mapping(bytes32 => MarketConfig) private _markets;
    mapping(bytes32 => bool) private _exists;
    bytes32[] private _marketIds;

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MARKET_ADMIN_ROLE, admin);
    }

    /// @notice Registers a new market. Reverts if `config.marketId` is already registered.
    function addMarket(MarketConfig calldata config) external onlyRole(MARKET_ADMIN_ROLE) {
        if (_exists[config.marketId]) revert MarketAlreadyExists(config.marketId);
        if (config.underlyingToken == address(0)) revert ZeroAddress();

        _exists[config.marketId] = true;
        _markets[config.marketId] = config;
        _marketIds.push(config.marketId);

        emit MarketAdded(config.marketId, config.underlyingToken, config.oracleId);
    }

    /// @notice Overwrites an existing market's full config (leverage caps, OI caps,
    /// product toggles, active flag). New markets/parameter changes always go through
    /// this function, never a new contract deploy.
    function updateMarket(bytes32 marketId, MarketConfig calldata config) external onlyRole(MARKET_ADMIN_ROLE) {
        if (!_exists[marketId]) revert MarketDoesNotExist(marketId);
        if (config.underlyingToken == address(0)) revert ZeroAddress();

        _markets[marketId] = config;

        emit MarketUpdated(marketId, config.underlyingToken, config.oracleId, config.active);
    }

    /// @notice Pauses or unpauses a single market without touching its other config.
    function setActive(bytes32 marketId, bool active) external onlyRole(MARKET_ADMIN_ROLE) {
        if (!_exists[marketId]) revert MarketDoesNotExist(marketId);

        _markets[marketId].active = active;

        MarketConfig storage m = _markets[marketId];
        emit MarketUpdated(marketId, m.underlyingToken, m.oracleId, active);
    }

    function getMarket(bytes32 marketId) external view returns (MarketConfig memory) {
        if (!_exists[marketId]) revert MarketDoesNotExist(marketId);
        return _markets[marketId];
    }

    function isActive(bytes32 marketId) external view returns (bool) {
        return _markets[marketId].active;
    }

    function isOptionsEnabled(bytes32 marketId) external view returns (bool) {
        return _markets[marketId].optionsEnabled;
    }

    function isPerpsEnabled(bytes32 marketId) external view returns (bool) {
        return _markets[marketId].perpsEnabled;
    }

    function allMarketIds() external view returns (bytes32[] memory) {
        return _marketIds;
    }
}
