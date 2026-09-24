// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {MarketConfig} from "../interfaces/DataTypes.sol";

/// @notice Single source of truth for which markets exist, their underlying token, oracle
/// mapping, and which product types are enabled. Every other contract queries this instead
/// of holding its own market list (PROJECT_BRIEF.md Section 18).
contract MarketRegistry is IMarketRegistry, UpgradeableBase {
    /// @notice Role permitted to add/update/pause markets. Intended to migrate to a
    /// TimelockController-held role without any contract change (Section 37).
    bytes32 public constant MARKET_ADMIN_ROLE = keccak256("MARKET_ADMIN_ROLE");
    /// @notice May stop new trading in a market, or in every market at once, and cannot turn any back on or
    /// change any configuration. See {OracleRouter.PAUSER_ROLE}.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    error MarketAlreadyExists(bytes32 marketId);
    error MarketDoesNotExist(bytes32 marketId);
    error ZeroAddress();

    event MarketAdded(bytes32 indexed marketId, address underlyingToken, bytes32 oracleId);
    event MarketUpdated(bytes32 indexed marketId, address underlyingToken, bytes32 oracleId, bool active);

    mapping(bytes32 => MarketConfig) private _markets;
    mapping(bytes32 => bool) private _exists;
    bytes32[] private _marketIds;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        __UpgradeableBase_init(admin);
        _grantRole(MARKET_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
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

    /// @notice Pauses or unpauses a single market without touching its other config. Pausing (`active` false)
    /// is open to a pauser as well as a market admin, so it can be done fast. Turning a market back on is
    /// admin only.
    function setActive(bytes32 marketId, bool active) external {
        if (active || !hasRole(PAUSER_ROLE, msg.sender)) _checkRole(MARKET_ADMIN_ROLE);
        if (!_exists[marketId]) revert MarketDoesNotExist(marketId);

        _markets[marketId].active = active;

        MarketConfig storage m = _markets[marketId];
        emit MarketUpdated(marketId, m.underlyingToken, m.oracleId, active);
    }

    /// @notice Stops new trading in every market at once: the protocol-wide pause. It sets each market's active
    /// flag to false. Closing a position, liquidation and option settlement still work, as they do for a single
    /// paused market. Turning markets back on is admin only, one at a time with `setActive`.
    function pauseAll() external onlyRole(PAUSER_ROLE) {
        for (uint256 i = 0; i < _marketIds.length; i++) {
            MarketConfig storage m = _markets[_marketIds[i]];
            if (!m.active) continue;
            m.active = false;
            emit MarketUpdated(_marketIds[i], m.underlyingToken, m.oracleId, false);
        }
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
