// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IAlphaMarketsVault} from "../interfaces/IAlphaMarketsVault.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {FeeConfig} from "../interfaces/DataTypes.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";
import {PerpPositionManager} from "./PerpPositionManager.sol";
import {FundingManager} from "./FundingManager.sol";
import {MarginEngine} from "../risk/MarginEngine.sol";
import {CrossMarginManager} from "../risk/CrossMarginManager.sol";

/// @notice Deterministic liquidation flow (PROJECT_BRIEF.md Section 14): oracle update →
/// mark update → revaluation → margin check → liquidation execution → PnL/fees settled.
/// The frontend is never the source of truth for eligibility — `isLiquidatable` here is.
/// Permissionless and keeper-incentivized: whoever calls `liquidate` on an eligible
/// position earns a share of its collateral.
contract LiquidationEngine is UpgradeableBase, ReentrancyGuardUpgradeable {
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Share of the liquidated position's collateral paid to the caller.
    uint256 public constant LIQUIDATOR_REWARD_BPS = 500; // 5%

    OracleRouter public immutable oracleRouter;
    IAlphaMarketsVault public immutable vault;
    IFeeManager public immutable feeManager;
    IRiskManager public immutable riskManager;
    PerpPositionManager public immutable positionManager;
    FundingManager public immutable fundingManager;
    address public immutable settlementToken;
    /// @notice Account-level margin; zero means every position is isolated.
    CrossMarginManager public immutable crossMargin;
    /// @notice Pays a liquidated position's shortfall; zero means a shortfall reverts the liquidation.
    address public immutable insuranceFund;

    error PositionNotLiquidatable();
    error PositionNotOpen();
    /// @dev A cross account's positions are liquidated worst first.
    error NotWorstPosition(uint256 worstPositionId);

    event PositionLiquidated(
        uint256 indexed positionId,
        bytes32 indexed marketId,
        address indexed owner,
        address liquidator,
        uint256 markPriceAtLiquidation,
        int256 pnl,
        uint256 fee
    );
    /// @notice A liquidated position lost more than its owner held; the insurance fund paid `amount`.
    event ShortfallCovered(uint256 indexed positionId, address indexed owner, uint256 amount);
    /// @notice The fund could not cover all of a shortfall: `amount` is bad debt the pool absorbs.
    event BadDebt(uint256 indexed positionId, address indexed owner, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address oracleRouter_,
        address vault_,
        address feeManager_,
        address riskManager_,
        address positionManager_,
        address fundingManager_,
        address settlementToken_,
        address crossMargin_,
        address insuranceFund_
    ) {
        oracleRouter = OracleRouter(oracleRouter_);
        vault = IAlphaMarketsVault(vault_);
        feeManager = IFeeManager(feeManager_);
        riskManager = IRiskManager(riskManager_);
        positionManager = PerpPositionManager(positionManager_);
        fundingManager = FundingManager(fundingManager_);
        settlementToken = settlementToken_;
        crossMargin = CrossMarginManager(crossMargin_);
        insuranceFund = insuranceFund_;
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __UpgradeableBase_init(admin);
        __ReentrancyGuard_init();
    }

    /// @notice True once a position's margin ratio has breached the market's maintenance
    /// margin requirement, evaluated against the current oracle mark price.
    function isLiquidatable(uint256 positionId) public view returns (bool) {
        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(positionId);
        if (!pos.open) return false;

        // A cross position is judged with its whole account, not on its own margin.
        if (_isCross(positionId)) return crossMargin.isAccountLiquidatable(pos.owner);

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
        if (_isCross(positionId)) {
            uint256 worst = crossMargin.worstPosition(pos.owner);
            if (worst != positionId) revert NotWorstPosition(worst);
        }

        (uint256 markPrice,) = oracleRouter.getMarkPrice(pos.marketId);
        int256 pnl = MarginEngine.unrealizedPnl(pos.isLong, pos.entryPrice, markPrice, pos.size);

        FeeConfig memory fees = feeManager.getFeeConfig(pos.marketId);
        uint256 liquidationFee = (pos.size * fees.liquidationFee) / BPS_DENOMINATOR;
        uint256 liquidatorReward = (pos.collateral * LIQUIDATOR_REWARD_BPS) / BPS_DENOMINATOR;

        vault.releaseMargin(pos.owner, settlementToken, pos.collateral);
        _settlePnl(positionId, pos.owner, pnl);

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

    function _isCross(uint256 positionId) internal view returns (bool) {
        return address(crossMargin) != address(0) && crossMargin.isCross(positionId);
    }

    /// @dev Settles the position's PnL against the owner's ledger. A loss the owner cannot pay is
    /// a shortfall: other collateral of a cross account is seized into the insurance fund, the fund
    /// pays what it can in the settlement token, and only the rest is bad debt. Nothing here can
    /// revert on a loss bigger than the balance, so a deeply underwater position stays liquidatable.
    function _settlePnl(uint256 positionId, address owner, int256 pnl) internal {
        if (pnl >= 0) {
            if (pnl != 0) vault.settlePnl(owner, settlementToken, pnl);
            return;
        }

        uint256 loss = uint256(-pnl);
        uint256 held = vault.availableBalance(owner, settlementToken);
        uint256 paid = loss > held ? held : loss;
        if (paid != 0) vault.settlePnl(owner, settlementToken, -int256(paid));
        if (loss == paid) return;

        uint256 shortfall = loss - paid;
        uint256 covered;
        if (insuranceFund != address(0)) {
            if (_isCross(positionId)) crossMargin.seizeForShortfall(owner, shortfall);
            uint256 fundBalance = vault.availableBalance(insuranceFund, settlementToken);
            covered = shortfall > fundBalance ? fundBalance : shortfall;
            if (covered != 0) {
                vault.settlePnl(insuranceFund, settlementToken, -int256(covered));
                emit ShortfallCovered(positionId, owner, covered);
            }
        }
        if (shortfall > covered) emit BadDebt(positionId, owner, shortfall - covered);
    }
}
