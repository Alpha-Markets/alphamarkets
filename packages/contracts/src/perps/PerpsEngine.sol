// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPerpsEngine} from "../interfaces/IPerpsEngine.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOrionisVault} from "../interfaces/IOrionisVault.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {FeeConfig, TriggerKind} from "../interfaces/DataTypes.sol";
import {MarketPaused, DeadlineExpired, SlippageExceeded} from "../interfaces/Errors.sol";
import {PerpPositionManager} from "./PerpPositionManager.sol";
import {PerpOrderManager} from "./PerpOrderManager.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";
import {FundingManager} from "./FundingManager.sol";
import {MarginEngine} from "../risk/MarginEngine.sol";
import {CrossMarginManager} from "../risk/CrossMarginManager.sol";

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
    /// @notice Account-level margin. Zero on a deployment without it, which turns `openPositionCross` off.
    CrossMarginManager public immutable crossMargin;
    /// @notice Whoever deployed this engine wires the RFQ manager once (the two need each other's address).
    address public immutable deployer;
    /// @notice The only caller of {openPositionAtPrice}. Zero until set.
    address public rfqManager;

    error CrossMarginDisabled();
    error NotRfqManager();
    error RfqManagerAlreadySet();
    error PerpsNotEnabled(bytes32 marketId);
    error ZeroAmount();
    error InsufficientCollateral();
    error NotPositionOwner();
    error PositionNotOpen();
    error InvalidTriggerPrice();
    error OrderNotOpen(uint256 orderId);
    error OrderExpired(uint256 orderId, uint256 expiry);
    error LimitPriceNotReached(uint256 orderId, uint256 triggerPrice, uint256 markPrice);
    error TriggerPriceNotReached(uint256 orderId, uint256 triggerPrice, uint256 markPrice);

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

    event TriggerOrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        uint256 indexed positionId,
        TriggerKind kind,
        uint256 triggerPrice,
        uint256 expiry
    );
    event TriggerOrderCancelled(uint256 indexed orderId, address indexed owner);
    event TriggerOrderExecuted(
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
        address settlementToken_,
        address crossMargin_
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
        crossMargin = CrossMarginManager(crossMargin_);
        deployer = msg.sender;
    }

    /// @notice One-time wiring of the RFQ manager, by the deployer.
    function setRfqManager(address manager) external {
        if (msg.sender != deployer) revert NotRfqManager();
        if (rfqManager != address(0)) revert RfqManagerAlreadySet();
        rfqManager = manager;
    }

    /// @notice Opens a position for `trader` at a price the RFQ manager has verified (a maker's signed
    /// quote), instead of the mark price. `isBlock` waives the per-position cap for a block trade the
    /// manager has bounded itself. Only the RFQ manager can call it: the price is not checked here.
    function openPositionAtPrice(
        address trader,
        bytes32 marketId,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 entryPrice,
        bool isBlock
    ) external nonReentrant returns (uint256 positionId) {
        if (msg.sender != rfqManager) revert NotRfqManager();
        return
            _openAt(
                trader, OpenParams(marketId, isLong, collateral, leverage, 0, type(uint256).max), entryPrice, isBlock
            );
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

    /// @notice Opens a CROSS-margin position: it is backed by the whole account (free balance, the
    /// other cross positions, other collateral) instead of only its own margin, and is liquidated
    /// when the account's equity falls under its requirement (see CrossMarginManager). The margin is
    /// still locked from the free balance at the position's leverage, as for {openPosition}.
    function openPositionCross(
        bytes32 marketId,
        bool isLong,
        uint256 collateral,
        uint256 leverage,
        uint256 limitPrice,
        uint256 deadline
    ) external nonReentrant returns (uint256 positionId) {
        if (address(crossMargin) == address(0)) revert CrossMarginDisabled();
        positionId = _openPosition(msg.sender, OpenParams(marketId, isLong, collateral, leverage, limitPrice, deadline));
        crossMargin.markCross(positionId, msg.sender);
    }

    /// @dev `trader` owns the position and pays the margin and fee. It is `msg.sender` for a market
    /// order and the order's owner when a keeper fills a limit order.
    function _openPosition(address trader, OpenParams memory p) internal returns (uint256 positionId) {
        if (block.timestamp > p.deadline) revert DeadlineExpired(p.deadline, block.timestamp);
        (uint256 entryPrice,) = oracleRouter.getMarkPrice(p.marketId);
        _checkLimitPrice(p.isLong, entryPrice, p.limitPrice);
        return _openAt(trader, p, entryPrice, false);
    }

    /// @dev The rest of an open, at an already-chosen `entryPrice`: the mark price for a market or
    /// limit order, the quoted price for an RFQ. `skipSizeCheck` waives the ordinary per-position
    /// cap for a block trade that RFQManager has bounded itself; the open-interest cap still applies.
    function _openAt(address trader, OpenParams memory p, uint256 entryPrice, bool skipSizeCheck)
        internal
        returns (uint256 positionId)
    {
        if (!marketRegistry.isActive(p.marketId)) revert MarketPaused(p.marketId);
        if (!marketRegistry.isPerpsEnabled(p.marketId)) revert PerpsNotEnabled(p.marketId);
        if (p.collateral == 0) revert ZeroAmount();

        riskManager.checkLeverage(p.marketId, p.leverage);
        uint256 notional = p.collateral * p.leverage;
        if (!skipSizeCheck) riskManager.checkPositionSize(p.marketId, notional);
        riskManager.checkOpenInterest(p.marketId, p.isLong, notional);

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
    // Trigger orders (stop-loss / take-profit)
    // ---------------------------------------------------------------------

    /// @notice Attaches a stop-loss or take-profit to an open position. Once the mark price reaches
    /// `triggerPrice` anyone may call {executeTriggerOrder}, which closes the whole remaining
    /// position at the mark price. For a long, a stop-loss must sit below the current mark and a
    /// take-profit above it; a short is the mirror image. A trigger that is already reached is
    /// rejected, because it would close the position at once.
    function placeTriggerOrder(uint256 positionId, TriggerKind kind, uint256 triggerPrice, uint256 expiry)
        external
        nonReentrant
        returns (uint256 orderId)
    {
        if (block.timestamp >= expiry) revert DeadlineExpired(expiry, block.timestamp);
        if (triggerPrice == 0) revert InvalidTriggerPrice();

        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(positionId);
        if (pos.owner != msg.sender) revert NotPositionOwner();
        if (!pos.open) revert PositionNotOpen();

        (uint256 markPrice,) = oracleRouter.getMarkPrice(pos.marketId);
        bool fireWhenBelow = _firesBelow(pos.isLong, kind);
        if (fireWhenBelow ? triggerPrice >= markPrice : triggerPrice <= markPrice) revert InvalidTriggerPrice();

        orderId = orderManager.createTriggerOrder(
            PerpOrderManager.TriggerOrder({
                positionId: positionId,
                kind: kind,
                triggerPrice: triggerPrice,
                expiry: expiry,
                owner: msg.sender,
                status: PerpOrderManager.OrderStatus.OPEN
            })
        );

        emit TriggerOrderPlaced(orderId, msg.sender, positionId, kind, triggerPrice, expiry);
    }

    /// @notice Cancels an open trigger order. Only its owner can.
    function cancelTriggerOrder(uint256 orderId) external nonReentrant {
        PerpOrderManager.TriggerOrder memory order = orderManager.getTriggerOrder(orderId);
        if (order.owner != msg.sender) revert NotPositionOwner();
        if (order.status != PerpOrderManager.OrderStatus.OPEN) revert OrderNotOpen(orderId);

        orderManager.markTriggerCancelled(orderId);
        emit TriggerOrderCancelled(orderId, msg.sender);
    }

    /// @notice Closes the position of an open trigger order once the mark price has reached its
    /// trigger. Permissionless: the price condition is checked here and the position closes at the
    /// current mark price, which can be worse than the trigger if the price gapped (there is no
    /// slippage bound: a stop-loss must get out). The margin, PnL and taker fee settle for the
    /// position's owner exactly as in {closePosition}. Reverts and leaves the order open when the
    /// trigger is not reached or the order has expired; reverts with {PositionNotOpen} when the
    /// position was already closed or liquidated.
    function executeTriggerOrder(uint256 orderId) external nonReentrant {
        PerpOrderManager.TriggerOrder memory order = orderManager.getTriggerOrder(orderId);
        if (order.owner == address(0) || order.status != PerpOrderManager.OrderStatus.OPEN) {
            revert OrderNotOpen(orderId);
        }
        if (block.timestamp > order.expiry) revert OrderExpired(orderId, order.expiry);

        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(order.positionId);
        if (!pos.open) revert PositionNotOpen();

        (uint256 markPrice,) = oracleRouter.getMarkPrice(pos.marketId);
        bool reached =
            _firesBelow(pos.isLong, order.kind) ? markPrice <= order.triggerPrice : markPrice >= order.triggerPrice;
        if (!reached) revert TriggerPriceNotReached(orderId, order.triggerPrice, markPrice);

        orderManager.markTriggerExecuted(orderId);
        _settleFunding(order.positionId, pos.marketId);
        _applyReduce(order.positionId, pos, pos.size, markPrice, true);

        emit TriggerOrderExecuted(orderId, order.owner, order.positionId, markPrice);
    }

    /// @dev A long's stop-loss and a short's take-profit fire when the mark falls to the trigger;
    /// a long's take-profit and a short's stop-loss fire when it rises to it.
    function _firesBelow(bool isLong, TriggerKind kind) internal pure returns (bool) {
        return (kind == TriggerKind.STOP_LOSS) == isLong;
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

        _applyReduce(positionId, pos, sizeDelta, exitPrice, isFullClose);
    }

    /// @dev Settles a reduction or close at `exitPrice`: PnL, margin release, taker fee, open
    /// interest and the position record. The caller has already checked ownership, the limit price
    /// (or trigger) and settled funding.
    function _applyReduce(
        uint256 positionId,
        PerpPositionManager.PerpPosition memory pos,
        uint256 sizeDelta,
        uint256 exitPrice,
        bool isFullClose
    ) internal {
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
