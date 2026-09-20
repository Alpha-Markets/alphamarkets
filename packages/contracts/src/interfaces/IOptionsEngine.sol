// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OptionType} from "./DataTypes.sol";

/// @notice External surface for opening, closing, and settling European cash-settled options.
/// Premiums are computed offchain (PROJECT_BRIEF.md Section 10), so every premium the engine
/// charges or pays must arrive with a `Quote`: an EIP-712 signature from a holder of
/// `QUOTER_ROLE` over that exact premium, user, series and expiry. The caller cannot choose the
/// price — without this a buyer could open for a premium of 0, or a seller close for any amount.
interface IOptionsEngine {
    /// @notice Signed authorisation for one premium. `nonce` makes each quote single-use and
    /// `validUntil` keeps it short-lived (a stale quote is a mispriced quote).
    struct Quote {
        uint256 validUntil;
        uint256 nonce;
        bytes signature;
    }

    /// @dev Grouped into a struct (rather than 8 positional params) to avoid EVM stack
    /// depth limits in the implementation.
    struct OpenPositionParams {
        bytes32 marketId;
        OptionType optionType;
        uint256 strike;
        uint256 expiry;
        uint256 contracts;
        uint256 premium;
        uint256 deadline;
    }

    /// @param quote Signed quote for exactly `params.premium` (see {Quote}).
    function openPosition(OpenPositionParams calldata params, Quote calldata quote)
        external
        returns (uint256 positionId);

    /// @param premium Total premium received for closing; must match the signed `quote`.
    function closePosition(uint256 positionId, uint256 premium, uint256 deadline, Quote calldata quote) external;

    /// @notice Settles every open position in one option series (one strike/type/expiry).
    /// Permissionless keeper call, callable once the series has expired.
    function settleExpired(bytes32 marketId, uint256 expiry, uint256 strike, OptionType optionType) external;
}
