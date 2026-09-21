// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IOptionsEngine} from "../interfaces/IOptionsEngine.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IAlphaMarketsVault} from "../interfaces/IAlphaMarketsVault.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {OptionType, FeeConfig} from "../interfaces/DataTypes.sol";
import {MarketPaused, DeadlineExpired} from "../interfaces/Errors.sol";
import {OptionPositionManager} from "./OptionPositionManager.sol";
import {OptionMarket} from "./OptionMarket.sol";
import {OptionSettlement} from "./OptionSettlement.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";

/// @notice Orchestrates the options user flow (PROJECT_BRIEF.md Section 8): validates
/// market/risk config, charges premium, creates the position, and later closes or settles
/// it. Users only ever buy options; the Vault's shared collateral pool is the implicit
/// writer/counterparty — premiums paid in accrue as pool surplus that backs future
/// in-the-money payouts, the same pooled-solvency model used for perp PnL settlement.
/// Bounding protocol tail risk is RiskManager's job (position size / open interest caps),
/// not this contract's.
///
/// Pricing trust model: premiums are computed offchain, so the engine never accepts a
/// caller-chosen premium. Each open and close needs an EIP-712 quote signed by a `QUOTER_ROLE`
/// holder for that exact user, series, size and premium. Quotes expire and are single-use. The
/// quoter key is therefore a critical secret (move it behind a multisig or HSM before mainnet —
/// PROJECT_BRIEF.md Section 37); settlement itself never depends on it, only oracle prices do.
contract OptionsEngine is IOptionsEngine, ReentrancyGuardUpgradeable, UpgradeableBase, EIP712 {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Role allowed to sign premium quotes.
    bytes32 public constant QUOTER_ROLE = keccak256("QUOTER_ROLE");

    bytes32 internal constant OPEN_QUOTE_TYPEHASH = keccak256(
        "OpenQuote(address user,bytes32 marketId,uint8 optionType,uint256 strike,uint256 expiry,uint256 contracts,uint256 premium,uint256 validUntil,uint256 nonce)"
    );
    bytes32 internal constant CLOSE_QUOTE_TYPEHASH =
        keccak256("CloseQuote(address user,uint256 positionId,uint256 premium,uint256 validUntil,uint256 nonce)");

    /// @notice EIP-712 digests of quotes that have already been used.
    mapping(bytes32 digest => bool used) public quoteUsed;

    IMarketRegistry public immutable marketRegistry;
    OracleRouter public immutable oracleRouter;
    IAlphaMarketsVault public immutable vault;
    IFeeManager public immutable feeManager;
    IRiskManager public immutable riskManager;
    OptionPositionManager public immutable positionManager;
    OptionMarket public immutable optionMarket;
    address public immutable settlementToken;
    /// @notice Decimals of the settlement token. Option maths runs in 18-decimal fixed point (price,
    /// strike, contract size); every amount that reaches the Vault or RiskManager is converted to
    /// this token's base units first, so a 6-decimal token settles and is capped in 6 decimals.
    uint8 public immutable settlementDecimals;

    error OptionsNotEnabled(bytes32 marketId);
    error InvalidExpiry();
    error ZeroAmount();
    error InsufficientCollateral();
    error NotPositionOwner();
    error PositionNotOpen();
    error PositionAlreadyExpired();
    error InvalidQuote();
    error QuoteExpired(uint256 validUntil, uint256 currentTimestamp);
    error QuoteAlreadyUsed(bytes32 digest);

    event OptionPositionOpened(
        uint256 indexed positionId,
        address indexed owner,
        bytes32 indexed marketId,
        OptionType optionType,
        uint256 strike,
        uint256 expiry,
        uint256 contracts,
        uint256 premium
    );
    event OptionPositionClosed(uint256 indexed positionId, address indexed owner, int256 realizedPnl);
    event OptionExercised(uint256 indexed positionId, uint256 intrinsicValue, uint256 payout);
    event OptionSettled(bytes32 indexed seriesId, uint256 settlementPrice, uint256 timestamp);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address marketRegistry_,
        address oracleRouter_,
        address vault_,
        address feeManager_,
        address riskManager_,
        address positionManager_,
        address optionMarket_,
        address settlementToken_
    ) EIP712("AlphaMarketsOptionsEngine", "1") {
        marketRegistry = IMarketRegistry(marketRegistry_);
        oracleRouter = OracleRouter(oracleRouter_);
        vault = IAlphaMarketsVault(vault_);
        feeManager = IFeeManager(feeManager_);
        riskManager = IRiskManager(riskManager_);
        positionManager = OptionPositionManager(positionManager_);
        optionMarket = OptionMarket(optionMarket_);
        settlementToken = settlementToken_;
        settlementDecimals = IERC20Metadata(settlementToken_).decimals();
        _disableInitializers();
    }

    function initialize(address admin_) external initializer {
        __UpgradeableBase_init(admin_);
        __ReentrancyGuard_init();
    }

    // ---------------------------------------------------------------------
    // Open
    // ---------------------------------------------------------------------

    function openPosition(OpenPositionParams calldata params, Quote calldata quote)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired(params.deadline, block.timestamp);
        if (!marketRegistry.isActive(params.marketId)) revert MarketPaused(params.marketId);
        if (!marketRegistry.isOptionsEnabled(params.marketId)) revert OptionsNotEnabled(params.marketId);
        if (params.expiry <= block.timestamp) revert InvalidExpiry();
        if (params.contracts == 0) revert ZeroAmount();
        _consumeQuote(_openDigest(params, quote), quote);

        uint256 contractSize = optionMarket.getContractSize(params.marketId);
        uint256 notional = _notional(contractSize, params.strike, params.contracts);
        bool oiSide = params.optionType == OptionType.CALL;

        _checkAndCharge(params.marketId, oiSide, notional, params.premium);

        bytes32 seriesId =
            optionMarket.getOrCreateSeries(params.marketId, params.expiry, params.strike, params.optionType);
        optionMarket.updateOpenInterest(seriesId, int256(params.contracts));

        positionId = positionManager.createPosition(
            OptionPositionManager.OptionPosition({
                marketId: params.marketId,
                optionType: params.optionType,
                strike: params.strike,
                expiry: params.expiry,
                contracts: params.contracts,
                entryPremium: params.premium,
                collateral: params.premium,
                realizedPnl: 0,
                status: OptionPositionManager.PositionStatus.OPEN,
                owner: msg.sender
            }),
            seriesId
        );

        emit OptionPositionOpened(
            positionId,
            msg.sender,
            params.marketId,
            params.optionType,
            params.strike,
            params.expiry,
            params.contracts,
            params.premium
        );
    }

    function _checkAndCharge(bytes32 marketId, bool oiSide, uint256 notional, uint256 premium) internal {
        riskManager.checkPositionSize(marketId, notional);
        riskManager.checkOpenInterest(marketId, oiSide, notional);

        FeeConfig memory fees = feeManager.getFeeConfig(marketId);
        uint256 fee = (premium * fees.optionOpenFee) / BPS_DENOMINATOR;

        if (vault.availableBalance(msg.sender, settlementToken) < premium + fee) revert InsufficientCollateral();

        vault.settlePnl(msg.sender, settlementToken, -int256(premium));
        if (fee > 0) {
            feeManager.collectFee(marketId, msg.sender, settlementToken, fee, "OPTION_OPEN");
        }

        riskManager.recordOpenInterestDelta(marketId, oiSide, int256(notional));
    }

    // ---------------------------------------------------------------------
    // Signed premium quotes
    // ---------------------------------------------------------------------

    /// @notice EIP-712 digest a quoter must sign to authorise `params.premium` for the caller.
    function openQuoteDigest(address user, OpenPositionParams calldata params, uint256 validUntil, uint256 nonce)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(_openStructHash(user, params, validUntil, nonce));
    }

    /// @notice EIP-712 digest a quoter must sign to authorise closing `positionId` for `premium`.
    function closeQuoteDigest(address user, uint256 positionId, uint256 premium, uint256 validUntil, uint256 nonce)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(_closeStructHash(user, positionId, premium, validUntil, nonce));
    }

    function _openStructHash(address user, OpenPositionParams calldata p, uint256 validUntil, uint256 nonce)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                OPEN_QUOTE_TYPEHASH,
                user,
                p.marketId,
                uint8(p.optionType),
                p.strike,
                p.expiry,
                p.contracts,
                p.premium,
                validUntil,
                nonce
            )
        );
    }

    function _closeStructHash(address user, uint256 positionId, uint256 premium, uint256 validUntil, uint256 nonce)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(CLOSE_QUOTE_TYPEHASH, user, positionId, premium, validUntil, nonce));
    }

    function _openDigest(OpenPositionParams calldata p, Quote calldata quote) internal view returns (bytes32) {
        return _hashTypedDataV4(_openStructHash(msg.sender, p, quote.validUntil, quote.nonce));
    }

    function _closeDigest(uint256 positionId, uint256 premium, Quote calldata quote) internal view returns (bytes32) {
        return _hashTypedDataV4(_closeStructHash(msg.sender, positionId, premium, quote.validUntil, quote.nonce));
    }

    /// @dev Reverts unless `quote` is unexpired, unused, and signed over `digest` by a quoter.
    /// The digest binds the caller, so a quote cannot be replayed by anyone else.
    function _consumeQuote(bytes32 digest, Quote calldata quote) internal {
        if (block.timestamp > quote.validUntil) revert QuoteExpired(quote.validUntil, block.timestamp);
        if (quoteUsed[digest]) revert QuoteAlreadyUsed(digest);

        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, quote.signature);
        if (err != ECDSA.RecoverError.NoError || !hasRole(QUOTER_ROLE, signer)) revert InvalidQuote();

        quoteUsed[digest] = true;
    }

    // ---------------------------------------------------------------------
    // Close (before expiry)
    // ---------------------------------------------------------------------

    function closePosition(uint256 positionId, uint256 premium, uint256 deadline, Quote calldata quote)
        external
        nonReentrant
    {
        if (block.timestamp > deadline) revert DeadlineExpired(deadline, block.timestamp);
        _consumeQuote(_closeDigest(positionId, premium, quote), quote);

        OptionPositionManager.OptionPosition memory pos = positionManager.getPosition(positionId);
        if (pos.owner != msg.sender) revert NotPositionOwner();
        if (pos.status != OptionPositionManager.PositionStatus.OPEN) revert PositionNotOpen();
        if (block.timestamp >= pos.expiry) revert PositionAlreadyExpired(); // must settle via settleExpired instead

        FeeConfig memory fees = feeManager.getFeeConfig(pos.marketId);
        uint256 fee = (premium * fees.optionCloseFee) / BPS_DENOMINATOR;
        uint256 net = premium > fee ? premium - fee : 0;

        if (premium > 0) {
            vault.settlePnl(msg.sender, settlementToken, int256(premium));
        }
        if (fee > 0) {
            feeManager.collectFee(pos.marketId, msg.sender, settlementToken, fee, "OPTION_CLOSE");
        }

        uint256 contractSize = optionMarket.getContractSize(pos.marketId);
        uint256 notional = _notional(contractSize, pos.strike, pos.contracts);
        bool oiSide = pos.optionType == OptionType.CALL;
        riskManager.recordOpenInterestDelta(pos.marketId, oiSide, -int256(notional));

        bytes32 seriesId = optionMarket.seriesId(pos.marketId, pos.expiry, pos.strike, pos.optionType);
        optionMarket.updateOpenInterest(seriesId, -int256(pos.contracts));

        int256 realizedPnl = int256(net) - int256(pos.entryPremium);
        positionManager.closePosition(positionId, realizedPnl);

        emit OptionPositionClosed(positionId, msg.sender, realizedPnl);
    }

    // ---------------------------------------------------------------------
    // Settle (at/after expiry)
    // ---------------------------------------------------------------------

    function settleExpired(bytes32 marketId, uint256 expiry, uint256 strike, OptionType optionType)
        external
        nonReentrant
    {
        uint256 settlementPrice = oracleRouter.ensureSettlementPrice(marketId, expiry);

        bytes32 seriesId = optionMarket.seriesId(marketId, expiry, strike, optionType);
        uint256 contractSize = optionMarket.getContractSize(marketId);
        uint256[] memory ids = positionManager.getSeriesPositions(seriesId);

        for (uint256 i = 0; i < ids.length; i++) {
            _settleOne(ids[i], marketId, optionType, strike, settlementPrice, contractSize);
        }

        emit OptionSettled(seriesId, settlementPrice, block.timestamp);
    }

    function _settleOne(
        uint256 positionId,
        bytes32 marketId,
        OptionType optionType,
        uint256 strike,
        uint256 settlementPrice,
        uint256 contractSize
    ) internal {
        OptionPositionManager.OptionPosition memory pos = positionManager.getPosition(positionId);
        if (pos.status != OptionPositionManager.PositionStatus.OPEN) return;

        // The payout is worked out in 18 decimals and credited in the token's own base units.
        uint256 payout = _toTokenUnits(
            OptionSettlement.settlementValue(optionType, settlementPrice, strike, contractSize, pos.contracts)
        );
        uint256 net = _payFeeAndCredit(marketId, pos.owner, payout);

        bool oiSide = optionType == OptionType.CALL;
        uint256 notional = _notional(contractSize, strike, pos.contracts);
        riskManager.recordOpenInterestDelta(marketId, oiSide, -int256(notional));

        positionManager.settlePosition(positionId, int256(net) - int256(pos.entryPremium));

        if (payout > 0) {
            emit OptionExercised(positionId, payout, net);
        }
    }

    /// @dev Notional of `contracts` at `strike`, in settlement-token base units: what RiskManager's
    /// position-size and open-interest limits are written in, the same unit perp notional uses.
    function _notional(uint256 contractSize, uint256 strike, uint256 contracts) internal view returns (uint256) {
        return _toTokenUnits((contractSize * strike / WAD) * contracts);
    }

    /// @dev Converts an 18-decimal amount to the settlement token's base units.
    function _toTokenUnits(uint256 amount18) internal view returns (uint256) {
        uint8 tokenDecimals = settlementDecimals;
        if (tokenDecimals == 18) return amount18;
        if (tokenDecimals < 18) return amount18 / 10 ** (18 - tokenDecimals);
        return amount18 * 10 ** (tokenDecimals - 18);
    }

    function _payFeeAndCredit(bytes32 marketId, address owner, uint256 payout) internal returns (uint256 net) {
        FeeConfig memory fees = feeManager.getFeeConfig(marketId);
        uint256 fee = (payout * fees.settlementFee) / BPS_DENOMINATOR;
        net = payout > fee ? payout - fee : 0;

        if (payout > 0) {
            vault.settlePnl(owner, settlementToken, int256(payout));
        }
        if (fee > 0) {
            feeManager.collectFee(marketId, owner, settlementToken, fee, "SETTLEMENT");
        }
    }
}
