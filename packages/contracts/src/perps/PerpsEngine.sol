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
import {PerpOrderManager} from "./PerpOrderManager.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";
import {FundingManager} from "./FundingManager.sol";
import {MarginEngine} from "../risk/MarginEngine.sol";

/// @notice Orchestrates opening, increasing, reducing, and closing perpetual positions
/// (PROJECT_BRIEF.md Section 11), and filling resting limit orders (Section 39). Entry/exit
/// prices come from OracleRouter's mark price; every price-sensitive action is bounded by a
/// caller-supplied limit price and deadline.
contract PerpsEngine is IPerpsEngine, ReentrancyGuard {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    IMarketRegistry public immutable marketRegistry;
    OracleRouter public immutable oracleRouter;
    IOrionisVault public immutable vault;
    IFeeManager public immutable feeManager;
    IRiskManager public immutable riskManager;
    PerpPositionManager public immutable positionManager;
    PerpOrderManager public immutable orderManager;
    FundingManager public immutable fundingManager;
    address public immutable settlementToken;

    error PerpsNotEnabled(bytes32 marketId);
    error ZeroAmount();
    error InsufficientCollateral();
    error NotPositionOwner();
    error PositionNotOpen();
    error InvalidTriggerPrice();
    error OrderNotOpen(uint256 orderId);
    error OrderExpired(uint256 orderId, uint256 expiry);
    error LimitPriceNotReached(uint256 orderId, uint256 triggerPrice, uint256 markPrice);

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
    event LimitOrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        bytes32 indexed marketId,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 expiry
    );
    event LimitOrderCancelled(uint256 indexed orderId, address indexed owner);
    event LimitOrderExecuted(
        uint256 indexed orderId, address indexed owner, uint256 indexed positionId, uint256 executionPrice
    );

    constructor(
        address marketRegistry_,
        address oracleRouter_,
        address vault_,
        address feeManager_,
        address riskManager_,
        address positionManager_,
        address orderManager_,
        address fundingManager_,
        address settlementToken_
    ) {
        marketRegistry = IMarketRegistry(marketRegistry_);
        oracleRouter = OracleRouter(oracleRouter_);
        vault = IOrionisVault(vault_);
        feeManager = IFeeManager(feeManager_);
        riskManager = IRiskManager(riskManager_);
        positionManager = PerpPositionManager(positionManager_);
        orderManager = PerpOrderManager(orderManager_);
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
        return _openPosition(msg.sender, OpenParams(marketId, isLong, collateral, leverage, limitPrice, deadline));
    }

    /// @dev `trader` owns the position and pays the margin and fee. It is `msg.sender` for a market
    /// order and the order's owner when a keeper fills a limit order.
    function _openPosition(address trader, OpenParams memory p) internal returns (uint256 positionId) {
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
        if (vault.availableBalance(trader, settlementToken) < p.collateral + fee) revert InsufficientCollateral();

        vault.lockMargin(trader, settlementToken, p.collateral);
        if (fee > 0) feeManager.collectFee(p.marketId, trader, settlementToken, fee, "TAKER");

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
                owner: trader
            })
        );

        emit PerpPositionOpened(
            positionId, trader, p.marketId, p.isLong, notional, p.collateral, p.leverage, entryPrice
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

        if (addSize == 0 && addCollateral == 0) revert ZeroAmount();

        _settleFunding(positionId, pos.marketId);

        uint256 newSize = pos.size + addSize;
        uint256 newCollateral = pos.collateral + addCollateral;

        // The same guards as opening: position cap, open-interest cap, and a leverage ceiling on the
        // resulting position, so growing a position cannot slip past what opening it would allow.
        riskManager.checkPositionSize(pos.marketId, newSize);
        riskManager.checkResultingLeverage(pos.marketId, newSize, newCollateral);
        if (addSize > 0) riskManager.checkOpenInterest(pos.marketId, pos.isLong, addSize);

        (uint256 markPrice,) = oracleRouter.getMarkPrice(pos.marketId);
        if (addSize > 0) _checkLimitPrice(pos.isLong, markPrice, limitPrice);

        uint256 fee = _chargeTakerFee(pos.marketId, addCollateral, addSize);
        if (vault.availableBalance(msg.sender, settlementToken) < addCollateral + fee) revert InsufficientCollateral();

        if (addCollateral > 0) vault.lockMargin(msg.sender, settlementToken, addCollateral);
        if (fee > 0) feeManager.collectFee(pos.marketId, msg.sender, settlementToken, fee, "TAKER");

        // Weighted-average entry price across the existing and added notional.
        uint256 newEntryPrice = (pos.entryPrice * pos.size + markPrice * addSize) / newSize;

        positionManager.updatePosition(positionId, newSize, newCollateral, newEntryPrice);
        if (addSize > 0) {
            riskManager.recordOpenInterestDelta(pos.marketId, pos.isLong, int256(addSize));
            oracleRouter.updateLastPrice(pos.marketId, markPrice);
        }

        emit PerpPositionUpdated(positionId, newSize, newCollateral, 0);
    }

    // ---------------------------------------------------------------------
    // Limit orders
    // ---------------------------------------------------------------------

    /// @notice Places a resting order to open a position once the mark price reaches `triggerPrice`:
    /// at or below it for a long, at or above it for a short. Nothing is reserved in the Vault; the
    /// margin and taker fee are taken when the order fills. Anyone may fill it after that (see
    /// {executeLimitOrder}), so no keeper needs to be trusted.
    function placeLimitOrder(
        bytes32 marketId,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 triggerPrice,
        uint256 expiry
    ) external nonReentrant returns (uint256 orderId) {
        if (block.timestamp >= expiry) revert DeadlineExpired(expiry, block.timestamp);
        if (!marketRegistry.isActive(marketId)) revert MarketPaused(marketId);
        if (!marketRegistry.isPerpsEnabled(marketId)) revert PerpsNotEnabled(marketId);
        if (collateral == 0) revert ZeroAmount();
        if (triggerPrice == 0) revert InvalidTriggerPrice();

        // Reject an order that could never fill, at placement rather than at fill time.
        riskManager.checkLeverage(marketId, leverage);
        riskManager.checkPositionSize(marketId, collateral * leverage);

        orderId = orderManager.createOrder(
            PerpOrderManager.LimitOrder({
                marketId: marketId,
                isLong: isLong,
                collateral: collateral,
                leverage: leverage,
                triggerPrice: triggerPrice,
                expiry: expiry,
                owner: msg.sender,
                status: PerpOrderManager.OrderStatus.OPEN,
                positionId: 0
            })
        );

        emit LimitOrderPlaced(orderId, msg.sender, marketId, isLong, collateral, leverage, triggerPrice, expiry);
    }

    /// @notice Cancels an open order. Only its owner can.
    function cancelLimitOrder(uint256 orderId) external nonReentrant {
        PerpOrderManager.LimitOrder memory order = orderManager.getOrder(orderId);
        if (order.owner != msg.sender) revert NotPositionOwner();
        if (order.status != PerpOrderManager.OrderStatus.OPEN) revert OrderNotOpen(orderId);

        orderManager.markCancelled(orderId);
        emit LimitOrderCancelled(orderId, msg.sender);
    }

    /// @notice Opens the position for an open order once the mark price has reached its trigger.
    /// Permissionless: the price condition is checked here, and the position is opened for the
    /// order's owner at the current mark price, which is at least as good as the trigger. Reverts
    /// (and leaves the order open) when the trigger is not reached, the order has expired, or the
    /// owner no longer has the margin.
    function executeLimitOrder(uint256 orderId) external nonReentrant returns (uint256 positionId) {
        PerpOrderManager.LimitOrder memory order = orderManager.getOrder(orderId);
        if (order.owner == address(0) || order.status != PerpOrderManager.OrderStatus.OPEN) {
            revert OrderNotOpen(orderId);
        }
        if (block.timestamp > order.expiry) revert OrderExpired(orderId, order.expiry);

        (uint256 markPrice,) = oracleRouter.getMarkPrice(order.marketId);
        bool reached = order.isLong ? markPrice <= order.triggerPrice : markPrice >= order.triggerPrice;
        if (!reached) revert LimitPriceNotReached(orderId, order.triggerPrice, markPrice);

        // `nonReentrant` stops the open from re-entering to fill the same order twice.
        positionId = _openPosition(
            order.owner,
            OpenParams(order.marketId, order.isLong, order.collateral, order.leverage, order.triggerPrice, order.expiry)
        );
        orderManager.markExecuted(orderId, positionId);

        emit LimitOrderExecuted(orderId, order.owner, positionId, markPrice);
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
