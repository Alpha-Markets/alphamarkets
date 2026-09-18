// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOrionisVault} from "../interfaces/IOrionisVault.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {FeeConfig} from "../interfaces/DataTypes.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";
import {PerpPositionManager} from "./PerpPositionManager.sol";
import {FundingManager} from "./FundingManager.sol";
import {MarginEngine} from "../risk/MarginEngine.sol";

/// @notice Deterministic liquidation flow (PROJECT_BRIEF.md Section 14): oracle update →
/// mark update → revaluation → margin check → liquidation execution → PnL/fees settled.
/// The frontend is never the source of truth for eligibility — `isLiquidatable` here is.
/// Permissionless and keeper-incentivized: whoever calls `liquidate` on an eligible
/// position earns a share of its collateral.
contract LiquidationEngine is ReentrancyGuard {
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Share of the liquidated position's collateral paid to the caller.
    uint256 public constant LIQUIDATOR_REWARD_BPS = 500; // 5%

    OracleRouter public immutable oracleRouter;
    IOrionisVault public immutable vault;
    IFeeManager public immutable feeManager;
    IRiskManager public immutable riskManager;
    PerpPositionManager public immutable positionManager;
    FundingManager public immutable fundingManager;
    address public immutable settlementToken;

    error PositionNotLiquidatable();
    error PositionNotOpen();

    event PositionLiquidated(
        uint256 indexed positionId,
        bytes32 indexed marketId,
        address indexed owner,
        address liquidator,
        uint256 markPriceAtLiquidation,
        int256 pnl,
        uint256 fee
    );

    constructor(
        address oracleRouter_,
        address vault_,
        address feeManager_,
        address riskManager_,
        address positionManager_,
        address fundingManager_,
        address settlementToken_
    ) {
        oracleRouter = OracleRouter(oracleRouter_);
        vault = IOrionisVault(vault_);
        feeManager = IFeeManager(feeManager_);
        riskManager = IRiskManager(riskManager_);
        positionManager = PerpPositionManager(positionManager_);
        fundingManager = FundingManager(fundingManager_);
        settlementToken = settlementToken_;
    }

    /// @notice True once a position's margin ratio has breached the market's maintenance
    /// margin requirement, evaluated against the current oracle mark price.
    function isLiquidatable(uint256 positionId) public view returns (bool) {
        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(positionId);
        if (!pos.open) return false;

        (uint256 markPrice,) = oracleRouter.getMarkPrice(pos.marketId);
        int256 pnl = MarginEngine.unrealizedPnl(pos.isLong, pos.entryPrice, markPrice, pos.size);
        uint256 ratio = MarginEngine.marginRatio(pos.collateral, pnl, pos.size);
        uint256 maintenanceRate = riskManager.maintenanceMarginRateBps(pos.marketId);
        return ratio < maintenanceRate;
    }

    function liquidate(uint256 positionId) external nonReentrant {
        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(positionId);
        if (!pos.open) revert PositionNotOpen();

        fundingManager.updateFundingRate(pos.marketId);
        fundingManager.settleFunding(positionId);

        // Re-read after funding settlement in case it moved collateral.
        pos = positionManager.getPosition(positionId);
        if (!isLiquidatable(positionId)) revert PositionNotLiquidatable();

        (uint256 markPrice,) = oracleRouter.getMarkPrice(pos.marketId);
        int256 pnl = MarginEngine.unrealizedPnl(pos.isLong, pos.entryPrice, markPrice, pos.size);

        FeeConfig memory fees = feeManager.getFeeConfig(pos.marketId);
        uint256 liquidationFee = (pos.size * fees.liquidationFee) / BPS_DENOMINATOR;
        uint256 liquidatorReward = (pos.collateral * LIQUIDATOR_REWARD_BPS) / BPS_DENOMINATOR;

        vault.releaseMargin(pos.owner, settlementToken, pos.collateral);
        if (pnl != 0) vault.settlePnl(pos.owner, settlementToken, pnl);

        // Cap fee + reward to the owner's actual remaining available balance (not just
        // this position's original collateral, since a user's ledger is shared across
        // positions), so a deeply underwater position can never make liquidation revert.
        uint256 remainingEquity = vault.availableBalance(pos.owner, settlementToken);
        uint256 totalCharges = liquidationFee + liquidatorReward;
        if (totalCharges > remainingEquity) {
            if (remainingEquity == 0 || totalCharges == 0) {
                liquidationFee = 0;
                liquidatorReward = 0;
            } else {
                liquidationFee = (liquidationFee * remainingEquity) / totalCharges;
                liquidatorReward = remainingEquity - liquidationFee;
            }
        }

        if (liquidationFee > 0) {
            feeManager.collectFee(pos.marketId, pos.owner, settlementToken, liquidationFee, "LIQUIDATION");
        }
        if (liquidatorReward > 0) {
            vault.settlePnl(pos.owner, settlementToken, -int256(liquidatorReward));
            vault.settlePnl(msg.sender, settlementToken, int256(liquidatorReward));
        }

        riskManager.recordOpenInterestDelta(pos.marketId, pos.isLong, -int256(pos.size));
        oracleRouter.updateLastPrice(pos.marketId, markPrice);

        positionManager.closePosition(positionId);
        positionManager.setRealizedPnl(positionId, pnl);

        emit PositionLiquidated(positionId, pos.marketId, pos.owner, msg.sender, markPrice, pnl, liquidationFee);
    }
}
