// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Per-market configuration, single source of truth held by MarketRegistry.
struct MarketConfig {
    bytes32 marketId;
    address underlyingToken;
    bytes32 oracleId;
    bool optionsEnabled;
    bool perpsEnabled;
    uint256 maxLeverage;
    uint256 openInterestCap;
    bool active;
}

/// @notice Per-market fee schedule held by FeeManager.
struct FeeConfig {
    uint256 makerFee;
    uint256 takerFee;
    uint256 optionOpenFee;
    uint256 optionCloseFee;
    uint256 settlementFee;
    uint256 liquidationFee;
}

/// @notice Kind of a trigger order attached to an open perpetual position.
enum TriggerKind {
    STOP_LOSS,
    TAKE_PROFIT
}

/// @notice European option side.
enum OptionType {
    CALL,
    PUT
}
