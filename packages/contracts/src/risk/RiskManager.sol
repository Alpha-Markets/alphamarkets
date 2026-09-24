// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";

/// @notice Per-market risk config and enforcement checks (PROJECT_BRIEF.md Section 19),
/// called by OptionsEngine, PerpsEngine, and LiquidationEngine before every state-changing
/// action. MVP: isolated margin only.
///
/// `openInterestCap` here is the value actually enforced at runtime; MarketRegistry's
/// `MarketConfig.openInterestCap` is the advertised value for frontend/indexer reads. The
/// market admin is responsible for keeping the two in sync when configuring a market.
contract RiskManager is IRiskManager, UpgradeableBase {
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
    /// @notice Granted to OptionsEngine, PerpsEngine, LiquidationEngine.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    struct RiskConfig {
        uint256 maxLeverage;
        uint256[] allowedLeverageTiers;
        uint256 initialMarginRateBps;
        uint256 maintenanceMarginRateBps;
        uint256 maxPositionNotional;
        uint256 openInterestCap;
    }

    error InsufficientMargin();
    error PositionLimitExceeded();
    error OpenInterestLimitExceeded();
    error InvalidLeverageTiers();

    event RiskConfigUpdated(bytes32 indexed marketId);

    mapping(bytes32 => RiskConfig) private _riskConfigs;
    mapping(bytes32 => uint256) public openInterestLong;
    mapping(bytes32 => uint256) public openInterestShort;
    /// @notice The most that long and short open interest may differ by, per market. The vault is the
    /// counterparty to the difference (the unmatched side has no loser to pay it), so this bounds what
    /// a one-sided price move can cost the pool. Zero means no limit. Appended after the open-interest
    /// mappings, so it does not move any existing storage slot.
    mapping(bytes32 => uint256) public maxNetOpenInterest;

    error NetOpenInterestLimitExceeded();
    event MaxNetOpenInterestUpdated(bytes32 indexed marketId, uint256 value);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __UpgradeableBase_init(admin);
        _grantRole(RISK_ADMIN_ROLE, admin);
    }

    function setRiskConfig(bytes32 marketId, RiskConfig calldata config) external onlyRole(RISK_ADMIN_ROLE) {
        if (config.allowedLeverageTiers.length == 0) revert InvalidLeverageTiers();
        _riskConfigs[marketId] = config;
        emit RiskConfigUpdated(marketId);
    }

    function setMaxNetOpenInterest(bytes32 marketId, uint256 value) external onlyRole(RISK_ADMIN_ROLE) {
        maxNetOpenInterest[marketId] = value;
        emit MaxNetOpenInterestUpdated(marketId, value);
    }

    function getRiskConfig(bytes32 marketId) external view returns (RiskConfig memory) {
        return _riskConfigs[marketId];
    }

    /// @notice Reverts unless `leverage` is one of the market's configured discrete tiers
    /// (e.g. 1x/2x/3x/5x/10x) — never just a ceiling, so tiers stay config-driven per
    /// PROJECT_BRIEF.md Section 11 ("never hardcode leverage limits in the frontend").
    function checkLeverage(bytes32 marketId, uint256 leverage) external view {
        uint256[] storage tiers = _riskConfigs[marketId].allowedLeverageTiers;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (tiers[i] == leverage) return;
        }
        revert PositionLimitExceeded();
    }

    /// @notice Reverts unless `size` is at most `collateral * maxLeverage`. Adding size to an open
    /// position produces a leverage that is rarely one of the discrete tiers, so the ceiling (the
    /// highest tier) is what applies. A position with no collateral cannot hold any size.
    function checkResultingLeverage(bytes32 marketId, uint256 size, uint256 collateral) external view {
        if (size > collateral * _riskConfigs[marketId].maxLeverage) revert PositionLimitExceeded();
    }

    function checkPositionSize(bytes32 marketId, uint256 notional) external view {
        if (notional > _riskConfigs[marketId].maxPositionNotional) revert PositionLimitExceeded();
    }

    /// @dev Two limits. The combined open interest may not pass the market's cap. The difference between
    /// long and short open interest may not pass `maxNetOpenInterest` (when set) unless the trade
    /// reduces that difference: a trade on the smaller side is never refused for adding imbalance.
    function checkOpenInterest(bytes32 marketId, bool isLong, uint256 notionalDelta) external view {
        uint256 longOi = openInterestLong[marketId];
        uint256 shortOi = openInterestShort[marketId];
        if (longOi + shortOi + notionalDelta > _riskConfigs[marketId].openInterestCap) {
            revert OpenInterestLimitExceeded();
        }

        uint256 netCap = maxNetOpenInterest[marketId];
        if (netCap == 0) return;
        uint256 netBefore = longOi > shortOi ? longOi - shortOi : shortOi - longOi;
        if (isLong) longOi += notionalDelta;
        else shortOi += notionalDelta;
        uint256 netAfter = longOi > shortOi ? longOi - shortOi : shortOi - longOi;
        if (netAfter > netCap && netAfter > netBefore) revert NetOpenInterestLimitExceeded();
    }

    function checkMargin(uint256 collateral, uint256 requiredMargin) external pure {
        if (collateral < requiredMargin) revert InsufficientMargin();
    }

    function recordOpenInterestDelta(bytes32 marketId, bool isLong, int256 notionalDelta)
        external
        onlyRole(ENGINE_ROLE)
    {
        if (isLong) {
            openInterestLong[marketId] = _applyDelta(openInterestLong[marketId], notionalDelta);
        } else {
            openInterestShort[marketId] = _applyDelta(openInterestShort[marketId], notionalDelta);
        }
    }

    function maxLeverage(bytes32 marketId) external view returns (uint256) {
        return _riskConfigs[marketId].maxLeverage;
    }

    function maintenanceMarginRateBps(bytes32 marketId) external view returns (uint256) {
        return _riskConfigs[marketId].maintenanceMarginRateBps;
    }

    function initialMarginRateBps(bytes32 marketId) external view returns (uint256) {
        return _riskConfigs[marketId].initialMarginRateBps;
    }

    function _applyDelta(uint256 current, int256 delta) internal pure returns (uint256) {
        if (delta >= 0) return current + uint256(delta);
        return current - uint256(-delta);
    }
}
