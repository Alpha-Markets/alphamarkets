// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";

/// @notice Stateless-ish price validation (staleness + deviation), kept separate from
/// OracleRouter so the rules are independently unit- and fuzz-testable (PROJECT_BRIEF.md
/// Section 16). Reverts use the exact error signatures required by Section 36.
contract PriceValidator is UpgradeableBase {
    bytes32 public constant ORACLE_ADMIN_ROLE = keccak256("ORACLE_ADMIN_ROLE");

    uint256 public constant DEFAULT_MAX_PRICE_AGE = 1 hours;
    uint256 public constant DEFAULT_MAX_DEVIATION_BPS = 1000; // 10%
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Per-market override; 0 means "use the default".
    mapping(bytes32 => uint256) public maxPriceAge;
    /// @notice Per-market override; 0 means "use the default".
    mapping(bytes32 => uint256) public maxDeviationBps;

    event MaxPriceAgeUpdated(bytes32 indexed marketId, uint256 value);
    event MaxDeviationUpdated(bytes32 indexed marketId, uint256 valueBps);

    error StaleOraclePrice();
    error InvalidOraclePrice();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __UpgradeableBase_init(admin);
        _grantRole(ORACLE_ADMIN_ROLE, admin);
    }

    function setMaxPriceAge(bytes32 marketId, uint256 value) external onlyRole(ORACLE_ADMIN_ROLE) {
        maxPriceAge[marketId] = value;
        emit MaxPriceAgeUpdated(marketId, value);
    }

    function setMaxDeviationBps(bytes32 marketId, uint256 value) external onlyRole(ORACLE_ADMIN_ROLE) {
        maxDeviationBps[marketId] = value;
        emit MaxDeviationUpdated(marketId, value);
    }

    /// @notice Reverts with `StaleOraclePrice` if `timestamp` is older than the market's
    /// max price age.
    function validateFreshness(uint256 timestamp, bytes32 marketId) external view {
        uint256 maxAge = maxPriceAge[marketId];
        if (maxAge == 0) maxAge = DEFAULT_MAX_PRICE_AGE;
        if (block.timestamp > timestamp + maxAge) revert StaleOraclePrice();
    }

    /// @notice Reverts with `InvalidOraclePrice` if the two prices deviate by more than
    /// the market's max deviation. Used to cross-validate primary against fallback.
    function validateDeviation(uint256 priceA, uint256 priceB, bytes32 marketId) external view {
        if (priceA == 0 || priceB == 0) return;

        uint256 maxDev = maxDeviationBps[marketId];
        if (maxDev == 0) maxDev = DEFAULT_MAX_DEVIATION_BPS;

        uint256 diff = priceA > priceB ? priceA - priceB : priceB - priceA;
        uint256 base = priceA > priceB ? priceA : priceB;
        uint256 deviationBps = (diff * BPS_DENOMINATOR) / base;
        if (deviationBps > maxDev) revert InvalidOraclePrice();
    }
}
