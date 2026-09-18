// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Shared errors thrown by more than one contract (kept in one file so revert
/// selectors stay identical across callers instead of drifting into near-duplicate errors).

/// @notice Thrown by OptionsEngine/PerpsEngine when MarketRegistry reports a market inactive.
error MarketPaused(bytes32 marketId);

/// @notice Thrown by OptionsEngine/PerpsEngine when a transaction's deadline has passed.
error DeadlineExpired(uint256 deadline, uint256 currentTimestamp);

/// @notice Thrown by OptionsEngine/PerpsEngine when execution price moves past the caller's bound.
error SlippageExceeded(uint256 expected, uint256 actual);
