// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OptionType} from "../interfaces/DataTypes.sol";

/// @notice Pure intrinsic-value/payout math for cash-settled European options
/// (PROJECT_BRIEF.md Section 9). No delivery of the underlying is required.
/// `settlementPrice`/`strike`/`contractSize` are 18-decimal fixed point; `contracts` is a
/// plain integer count.
library OptionSettlement {
    uint256 internal constant WAD = 1e18;

    /// @notice `max(settlementPrice - strike, 0)`.
    function callIntrinsicValue(uint256 settlementPrice, uint256 strike) internal pure returns (uint256) {
        return settlementPrice > strike ? settlementPrice - strike : 0;
    }

    /// @notice `max(strike - settlementPrice, 0)`.
    function putIntrinsicValue(uint256 settlementPrice, uint256 strike) internal pure returns (uint256) {
        return strike > settlementPrice ? strike - settlementPrice : 0;
    }

    /// @notice `intrinsicValue * contractSize * contracts`, rescaled from the double
    /// 18-decimal product of `intrinsicValue` and `contractSize` back to 18-decimal.
    function payout(uint256 intrinsicValue, uint256 contractSize, uint256 contracts) internal pure returns (uint256) {
        return (intrinsicValue * contractSize / WAD) * contracts;
    }

    function settlementValue(
        OptionType optionType,
        uint256 settlementPrice,
        uint256 strike,
        uint256 contractSize,
        uint256 contracts
    ) internal pure returns (uint256) {
        uint256 intrinsic = optionType == OptionType.CALL
            ? callIntrinsicValue(settlementPrice, strike)
            : putIntrinsicValue(settlementPrice, strike);
        return payout(intrinsic, contractSize, contracts);
    }
}
