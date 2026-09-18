// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OptionType} from "./DataTypes.sol";

/// @notice External surface for opening, closing, and settling European cash-settled options.
/// Premiums are computed offchain (PROJECT_BRIEF.md Section 10) and passed in as `premium`;
/// `maxPremium`/`minPremium` are the caller's slippage bound against a stale quote.
interface IOptionsEngine {
    /// @dev Grouped into a struct (rather than 8 positional params) to avoid EVM stack
    /// depth limits in the implementation.
    struct OpenPositionParams {
        bytes32 marketId;
        OptionType optionType;
        uint256 strike;
        uint256 expiry;
        uint256 contracts;
        uint256 premium;
        uint256 maxPremium;
        uint256 deadline;
    }

    function openPosition(OpenPositionParams calldata params) external returns (uint256 positionId);

    function closePosition(uint256 positionId, uint256 premium, uint256 minPremium, uint256 deadline) external;

    /// @notice Settles every open position in one option series (one strike/type/expiry).
    /// Permissionless keeper call, callable once the series has expired.
    function settleExpired(bytes32 marketId, uint256 expiry, uint256 strike, OptionType optionType) external;
}
