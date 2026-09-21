// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";
import {IOracle} from "../interfaces/IOracle.sol";
import {IPriceFeed} from "../interfaces/IPriceFeed.sol";
import {PriceValidator} from "./PriceValidator.sol";

/// @notice Routes per-market price requests to a primary feed with fallback, normalizes
/// decimals to 18, and distinguishes the 4 price types (PROJECT_BRIEF.md Section 17):
/// Index/Mark are read live from the configured feed(s); Last is the most recent executed
/// derivatives price (written by engines on trade execution); Settlement is recorded once,
/// permanently, at/after expiry.
///
/// MVP has no independent onchain source of a "mark" price distinct from the index feed
/// (no onchain perp order book), so `getIndexPrice` and `getMarkPrice` resolve identically.
contract OracleRouter is IOracle, UpgradeableBase {
    bytes32 public constant ORACLE_ADMIN_ROLE = keccak256("ORACLE_ADMIN_ROLE");
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");
    uint8 public constant CANONICAL_DECIMALS = 18;

    PriceValidator public immutable priceValidator;

    mapping(bytes32 => address) public primarySource;
    mapping(bytes32 => address) public fallbackSource;
    mapping(bytes32 => uint8) public primaryDecimals;
    mapping(bytes32 => uint8) public fallbackDecimals;
    /// @notice Last Price: most recent executed derivatives price, written by engines.
    mapping(bytes32 => uint256) public lastPrice;
    mapping(bytes32 => bool) public paused;

    mapping(bytes32 => mapping(uint256 => uint256)) public settlementPrice;
    mapping(bytes32 => mapping(uint256 => bool)) public settlementRecorded;

    error NoPriceSource(bytes32 marketId);
    error MarketOraclePaused(bytes32 marketId);
    error SettlementNotYetDue(bytes32 marketId, uint256 expiry);
    error SettlementNotRecorded(bytes32 marketId, uint256 expiry);
    error ZeroAddress();

    event OracleSourceUpdated(bytes32 indexed marketId, address primarySource, address fallbackSource);
    event OracleMarketPaused(bytes32 indexed marketId, bool paused);
    event SettlementPriceRecorded(bytes32 indexed marketId, uint256 indexed expiry, uint256 price);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address priceValidator_) {
        if (priceValidator_ == address(0)) revert ZeroAddress();
        priceValidator = PriceValidator(priceValidator_);
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        __UpgradeableBase_init(admin);
        _grantRole(ORACLE_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Admin config
    // ---------------------------------------------------------------------

    function setPrimarySource(bytes32 marketId, address source, uint8 decimals_) external onlyRole(ORACLE_ADMIN_ROLE) {
        if (source == address(0)) revert ZeroAddress();
        primarySource[marketId] = source;
        primaryDecimals[marketId] = decimals_;
        emit OracleSourceUpdated(marketId, source, fallbackSource[marketId]);
    }

    function setFallbackSource(bytes32 marketId, address source, uint8 decimals_) external onlyRole(ORACLE_ADMIN_ROLE) {
        fallbackSource[marketId] = source;
        fallbackDecimals[marketId] = decimals_;
        emit OracleSourceUpdated(marketId, primarySource[marketId], source);
    }

    function pauseMarket(bytes32 marketId) external onlyRole(ORACLE_ADMIN_ROLE) {
        paused[marketId] = true;
        emit OracleMarketPaused(marketId, true);
    }

    function unpauseMarket(bytes32 marketId) external onlyRole(ORACLE_ADMIN_ROLE) {
        paused[marketId] = false;
        emit OracleMarketPaused(marketId, false);
    }

    // ---------------------------------------------------------------------
    // Engine-only writes
    // ---------------------------------------------------------------------

    /// @notice Records the price of the most recently executed derivatives trade.
    function updateLastPrice(bytes32 marketId, uint256 price) external onlyRole(ENGINE_ROLE) {
        lastPrice[marketId] = price;
    }

    /// @notice Records the settlement price for a market's expiry on first call at/after
    /// expiry, then returns the now-immutable recorded price on every later call.
    /// Permissionless so any keeper (or OptionsEngine itself) can trigger it.
    function ensureSettlementPrice(bytes32 marketId, uint256 expiry) external returns (uint256 price) {
        if (settlementRecorded[marketId][expiry]) {
            return settlementPrice[marketId][expiry];
        }
        if (block.timestamp < expiry) revert SettlementNotYetDue(marketId, expiry);

        (price,) = _resolve(marketId);
        settlementPrice[marketId][expiry] = price;
        settlementRecorded[marketId][expiry] = true;
        emit SettlementPriceRecorded(marketId, expiry, price);
    }

    // ---------------------------------------------------------------------
    // IOracle
    // ---------------------------------------------------------------------

    function getPrice(bytes32 asset) external view returns (uint256 price, uint256 timestamp) {
        return _resolve(asset);
    }

    function getIndexPrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp) {
        return _resolve(marketId);
    }

    function getMarkPrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp) {
        return _resolve(marketId);
    }

    function getLastPrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp) {
        return (lastPrice[marketId], block.timestamp);
    }

    function getSettlementPrice(bytes32 marketId, uint256 expiry)
        external
        view
        returns (uint256 price, uint256 timestamp)
    {
        if (!settlementRecorded[marketId][expiry]) revert SettlementNotRecorded(marketId, expiry);
        return (settlementPrice[marketId][expiry], expiry);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _resolve(bytes32 marketId) internal view returns (uint256 price, uint256 timestamp) {
        if (paused[marketId]) revert MarketOraclePaused(marketId);

        address primary = primarySource[marketId];
        if (primary == address(0)) revert NoPriceSource(marketId);
        address fallbackAddr = fallbackSource[marketId];

        if (fallbackAddr == address(0)) {
            // No fallback configured: let the specific validator error (StaleOraclePrice/
            // InvalidOraclePrice) propagate directly instead of masking it as NoPriceSource.
            (uint256 rawPrice, uint256 ts) = IPriceFeed(primary).latestPrice();
            priceValidator.validateFreshness(ts, marketId);
            return (_normalize(rawPrice, primaryDecimals[marketId]), ts);
        }

        (uint256 pPrice, uint256 pTs, bool pOk) = _tryRead(primary, primaryDecimals[marketId], marketId);
        (uint256 fPrice, uint256 fTs, bool fOk) = _tryRead(fallbackAddr, fallbackDecimals[marketId], marketId);

        if (pOk && fOk) {
            priceValidator.validateDeviation(pPrice, fPrice, marketId);
            return (pPrice, pTs);
        }
        if (pOk) return (pPrice, pTs);
        if (fOk) return (fPrice, fTs);
        revert NoPriceSource(marketId);
    }

    function _tryRead(address source, uint8 decimals_, bytes32 marketId)
        internal
        view
        returns (uint256 price, uint256 timestamp, bool ok)
    {
        try IPriceFeed(source).latestPrice() returns (uint256 rawPrice, uint256 ts) {
            try priceValidator.validateFreshness(ts, marketId) {
                return (_normalize(rawPrice, decimals_), ts, true);
            } catch {
                return (0, 0, false);
            }
        } catch {
            return (0, 0, false);
        }
    }

    function _normalize(uint256 rawPrice, uint8 sourceDecimals) internal pure returns (uint256) {
        if (sourceDecimals == CANONICAL_DECIMALS) return rawPrice;
        if (sourceDecimals < CANONICAL_DECIMALS) {
            return rawPrice * (10 ** (CANONICAL_DECIMALS - sourceDecimals));
        }
        return rawPrice / (10 ** (sourceDecimals - CANONICAL_DECIMALS));
    }
}
