// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPerpsEngine} from "../interfaces/IPerpsEngine.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOrionisVault} from "../interfaces/IOrionisVault.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {FeeConfig} from "../interfaces/DataTypes.sol";
import {MarketPaused, DeadlineExpired, SlippageExceeded} from "../interfaces/Errors.sol";
import {PerpPositionManager} from "./PerpPositionManager.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";
import {FundingManager} from "./FundingManager.sol";
import {MarginEngine} from "../risk/MarginEngine.sol";

/// @notice Orchestrates opening, increasing, reducing, and closing perpetual positions
/// (PROJECT_BRIEF.md Section 11). Entry/exit prices come from OracleRouter's mark price;
/// every price-sensitive action is bounded by a caller-supplied limit price and deadline.
contract PerpsEngine is IPerpsEngine, ReentrancyGuard {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    IMarketRegistry public immutable marketRegistry;
    OracleRouter public immutable oracleRouter;
    IOrionisVault public immutable vault;
    IFeeManager public immutable feeManager;
    IRiskManager public immutable riskManager;
    PerpPositionManager public immutable positionManager;
    FundingManager public immutable fundingManager;
    address public immutable settlementToken;

    error PerpsNotEnabled(bytes32 marketId);
    error ZeroAmount();
    error InsufficientCollateral();
    error NotPositionOwner();
    error PositionNotOpen();

    event PerpPositionOpened(
        uint256 indexed positionId,
        address indexed owner,
        bytes32 indexed marketId,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 leverage,
        uint256 entryPrice
    );
    event PerpPositionUpdated(
        uint256 indexed positionId, uint256 newSize, uint256 newCollateral, int256 realizedPnlDelta
    );
    event PerpPositionClosed(uint256 indexed positionId, int256 realizedPnl);

    constructor(
        address marketRegistry_,
        address oracleRouter_,
        address vault_,
        address feeManager_,
        address riskManager_,
        address positionManager_,
        address fundingManager_,
        address settlementToken_
    ) {
        marketRegistry = IMarketRegistry(marketRegistry_);
        oracleRouter = OracleRouter(oracleRouter_);
        vault = IOrionisVault(vault_);
        feeManager = IFeeManager(feeManager_);
        riskManager = IRiskManager(riskManager_);
        positionManager = PerpPositionManager(positionManager_);
        fundingManager = FundingManager(fundingManager_);
        settlementToken = settlementToken_;
    }

    // ---------------------------------------------------------------------
    // Open
    // ---------------------------------------------------------------------

    struct OpenParams {
        bytes32 marketId;
        bool isLong;
        uint256 collateral;
        uint256 leverage;
        uint256 limitPrice;
        uint256 deadline;
    }

    function openPosition(
        bytes32 marketId,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 limitPrice,
        uint256 deadline
    ) external nonReentrant returns (uint256 positionId) {
        return _openPosition(OpenParams(marketId, isLong, collateral, leverage, limitPrice, deadline));
    }

    function _openPosition(OpenParams memory p) internal returns (uint256 positionId) {
        if (block.timestamp > p.deadline) revert DeadlineExpired(p.deadline, block.timestamp);
        if (!marketRegistry.isActive(p.marketId)) revert MarketPaused(p.marketId);
        if (!marketRegistry.isPerpsEnabled(p.marketId)) revert PerpsNotEnabled(p.marketId);
        if (p.collateral == 0) revert ZeroAmount();

        riskManager.checkLeverage(p.marketId, p.leverage);
        uint256 notional = p.collateral * p.leverage;
        riskManager.checkPositionSize(p.marketId, notional);
        riskManager.checkOpenInterest(p.marketId, p.isLong, notional);

        (uint256 entryPrice,) = oracleRouter.getMarkPrice(p.marketId);
        _checkLimitPrice(p.isLong, entryPrice, p.limitPrice);

        uint256 fee = _chargeTakerFee(p.marketId, p.collateral, notional);
        if (vault.availableBalance(msg.sender, settlementToken) < p.collateral + fee) revert InsufficientCollateral();

        vault.lockMargin(msg.sender, settlementToken, p.collateral);
        if (fee > 0) feeManager.collectFee(p.marketId, msg.sender, settlementToken, fee, "TAKER");

        riskManager.recordOpenInterestDelta(p.marketId, p.isLong, int256(notional));
        oracleRouter.updateLastPrice(p.marketId, entryPrice);

        positionId = positionManager.createPosition(
            PerpPositionManager.PerpPosition({
                marketId: p.marketId,
                isLong: p.isLong,
                entryPrice: entryPrice,
                size: notional,
                collateral: p.collateral,
                leverage: p.leverage,
                realizedPnl: 0,
                fundingAccrued: 0,
                lastFundingIndex: fundingManager.cumulativeFundingIndex(p.marketId),
                open: true,
                owner: msg.sender
            })
        );

        emit PerpPositionOpened(
            positionId, msg.sender, p.marketId, p.isLong, notional, p.collateral, p.leverage, entryPrice
        );
    }

    function _chargeTakerFee(
        bytes32 marketId,
        uint256,
        /* collateral */
        uint256 notional
    )
        internal
        view
        returns (uint256 fee)
    {
        FeeConfig memory fees = feeManager.getFeeConfig(marketId);
        fee = (notional * fees.takerFee) / BPS_DENOMINATOR;
    }

    function _checkLimitPrice(bool isLong, uint256 actualPrice, uint256 limitPrice) internal pure {
        if (isLong && actualPrice > limitPrice) revert SlippageExceeded(limitPrice, actualPrice);
        if (!isLong && actualPrice < limitPrice) revert SlippageExceeded(limitPrice, actualPrice);
    }

    // ---------------------------------------------------------------------
    // Increase
    // ---------------------------------------------------------------------

    function increasePosition(
        uint256 positionId,
        uint256 addCollateral,
        uint256 addSize,
        uint256 limitPrice,
        uint256 deadline
    ) external nonReentrant {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);

        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(positionId);
        if (pos.owner != msg.sender) revert NotPositionOwner();
        if (!pos.open) revert PositionNotOpen();
        if (!marketRegistry.isActive(pos.marketId)) revert MarketPaused(pos.marketId);

        _settleFunding(positionId, pos.marketId);

        riskManager.checkPositionSize(pos.marketId, pos.size + addSize);
        riskManager.checkOpenInterest(pos.marketId, pos.isLong, addSize);

        (uint256 markPrice,) = oracleRouter.getMarkPrice(pos.marketId);
        _checkLimitPrice(pos.isLong, markPrice, limitPrice);

        if (addCollateral > 0) {
            if (vault.availableBalance(msg.sender, settlementToken) < addCollateral) revert InsufficientCollateral();
            vault.lockMargin(msg.sender, settlementToken, addCollateral);
        }

        // Weighted-average entry price across the existing and added notional.
        uint256 newSize = pos.size + addSize;
        uint256 newEntryPrice =
            newSize == 0 ? pos.entryPrice : (pos.entryPrice * pos.size + markPrice * addSize) / newSize;
        uint256 newCollateral = pos.collateral + addCollateral;

        positionManager.updatePosition(positionId, newSize, newCollateral, newEntryPrice);
        riskManager.recordOpenInterestDelta(pos.marketId, pos.isLong, int256(addSize));

        emit PerpPositionUpdated(positionId, newSize, newCollateral, 0);
    }

    // ---------------------------------------------------------------------
    // Reduce / Close
    // ---------------------------------------------------------------------

    function reducePosition(uint256 positionId, uint256 sizeDelta, uint256 limitPrice, uint256 deadline)
        external
        nonReentrant
    {
        _reduce(positionId, sizeDelta, limitPrice, deadline, false);
    }

    function closePosition(uint256 positionId, uint256 limitPrice, uint256 deadline) external nonReentrant {
        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(positionId);
        _reduce(positionId, pos.size, limitPrice, deadline, true);
    }

    function _reduce(uint256 positionId, uint256 sizeDelta, uint256 limitPrice, uint256 deadline, bool isFullClose)
        internal
    {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);

        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(positionId);
        if (pos.owner != msg.sender) revert NotPositionOwner();
        if (!pos.open) revert PositionNotOpen();
        if (sizeDelta == 0 || sizeDelta > pos.size) revert ZeroAmount();

        _settleFunding(positionId, pos.marketId);

        (uint256 exitPrice,) = oracleRouter.getMarkPrice(pos.marketId);
        _checkExitLimitPrice(pos.isLong, exitPrice, limitPrice);

        int256 pnl = MarginEngine.unrealizedPnl(pos.isLong, pos.entryPrice, exitPrice, sizeDelta);
        uint256 collateralReleased = (pos.collateral * sizeDelta) / pos.size;

        FeeConfig memory fees = feeManager.getFeeConfig(pos.marketId);
        uint256 fee = (sizeDelta * fees.takerFee) / BPS_DENOMINATOR;

        vault.releaseMargin(pos.owner, settlementToken, collateralReleased);
        if (pnl != 0) vault.settlePnl(pos.owner, settlementToken, pnl);
        if (fee > 0) feeManager.collectFee(pos.marketId, pos.owner, settlementToken, fee, "TAKER");

        riskManager.recordOpenInterestDelta(pos.marketId, pos.isLong, -int256(sizeDelta));
        oracleRouter.updateLastPrice(pos.marketId, exitPrice);

        if (isFullClose || sizeDelta == pos.size) {
            positionManager.closePosition(positionId);
            positionManager.setRealizedPnl(positionId, pnl);
            emit PerpPositionClosed(positionId, pnl);
        } else {
            uint256 newSize = pos.size - sizeDelta;
            uint256 newCollateral = pos.collateral - collateralReleased;
            positionManager.updatePosition(positionId, newSize, newCollateral, pos.entryPrice);
            positionManager.setRealizedPnl(positionId, pnl);
            emit PerpPositionUpdated(positionId, newSize, newCollateral, pnl);
        }
    }

    function _checkExitLimitPrice(bool isLong, uint256 actualPrice, uint256 limitPrice) internal pure {
        if (isLong && actualPrice < limitPrice) revert SlippageExceeded(limitPrice, actualPrice);
        if (!isLong && actualPrice > limitPrice) revert SlippageExceeded(limitPrice, actualPrice);
    }

    function _settleFunding(uint256 positionId, bytes32 marketId) internal {
        fundingManager.updateFundingRate(marketId);
        fundingManager.settleFunding(positionId);
    }
}
