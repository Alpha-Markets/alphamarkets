// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FeeConfig} from "./DataTypes.sol";

/// @notice Per-market fee schedule and fee collection routing, consumed by OptionsEngine,
/// PerpsEngine, and LiquidationEngine. Not one of the 5 interfaces named in
/// PROJECT_BRIEF.md Section 6 — added so engines depend on an interface rather than the
/// concrete FeeManager contract.
interface IFeeManager {
    function getFeeConfig(bytes32 marketId) external view returns (FeeConfig memory);

    function collectFee(bytes32 marketId, address payer, address token, uint256 amount, bytes32 feeType) external;
}
