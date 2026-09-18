// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Pure isolated-margin math (PROJECT_BRIEF.md Section 13), kept as a library so it
/// is independently unit- and fuzz-testable and callable by RiskManager and
/// LiquidationEngine without any shared state. All prices and notionals are 18-decimal
/// fixed point; rates are expressed in basis points (1 bps = 0.01%).
library MarginEngine {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Collateral required to open a position of `notional` at `initialMarginRateBps`.
    function initialMargin(uint256 notional, uint256 initialMarginRateBps) internal pure returns (uint256) {
        return (notional * initialMarginRateBps) / BPS_DENOMINATOR;
    }

    /// @notice Collateral below which a position of `notional` becomes liquidatable.
    function maintenanceMargin(uint256 notional, uint256 maintenanceMarginRateBps) internal pure returns (uint256) {
        return (notional * maintenanceMarginRateBps) / BPS_DENOMINATOR;
    }

    /// @notice Signed unrealized PnL for a position of `size` notional opened at
    /// `entryPrice`, marked at `markPrice`.
    function unrealizedPnl(bool isLong, uint256 entryPrice, uint256 markPrice, uint256 size)
        internal
        pure
        returns (int256)
    {
        if (entryPrice == 0) return 0;
        int256 priceDelta = isLong ? int256(markPrice) - int256(entryPrice) : int256(entryPrice) - int256(markPrice);
        return (int256(size) * priceDelta) / int256(entryPrice);
    }

    /// @notice Margin ratio in bps: (collateral + unrealizedPnl) / notional, floored at 0.
    function marginRatio(uint256 collateral, int256 pnl, uint256 notional) internal pure returns (uint256) {
        if (notional == 0) return 0;
        int256 equity = int256(collateral) + pnl;
        if (equity <= 0) return 0;
        return (uint256(equity) * BPS_DENOMINATOR) / notional;
    }

    /// @notice Mark price at which equity (collateral + unrealizedPnl) equals maintenance
    /// margin for a position of `size` notional. Floored at 0 for the degenerate case where
    /// `size` is disproportionately small relative to the margin shortfall.
    function liquidationPrice(
        bool isLong,
        uint256 entryPrice,
        uint256 collateral,
        uint256 size,
        uint256 maintenanceMarginRateBps
    ) internal pure returns (uint256) {
        if (size == 0) return 0;

        uint256 maintMargin = maintenanceMargin(size, maintenanceMarginRateBps);
        int256 shortfall = int256(maintMargin) - int256(collateral);
        int256 offset = (int256(entryPrice) * shortfall) / int256(size);

        int256 price = isLong ? int256(entryPrice) + offset : int256(entryPrice) - offset;
        if (price <= 0) return 0;
        return uint256(price);
    }
}
