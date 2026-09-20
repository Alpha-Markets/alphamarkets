// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";
import {PerpsEngine} from "./PerpsEngine.sol";

/// @notice Request-for-quote and block trades for perpetuals (PROJECT_BRIEF.md Section 40). A user
/// asks a market maker for a price offchain (`services/api`'s RFQ broker); the maker answers with an
/// EIP-712 quote signed by a MAKER_ROLE holder, for that exact user, market, side, size and price.
/// The user then calls {execute}, and the position opens at the QUOTED price instead of the mark.
///
/// What keeps a signed price safe to honour:
/// - It names one user, expires, and can be used once.
/// - Its price must sit within `maxDeviationBps` of the oracle mark price, so a compromised or
///   careless maker key cannot sell the pool a position at a wildly wrong price.
/// - The counterparty is still the protocol's pool, exactly as for market orders; the maker only
///   decides the price, so its key is as critical as the options quoter's: a dedicated key, held by
///   the maker's own service, moved behind a multisig or HSM before mainnet (Section 37).
///
/// A BLOCK TRADE is an RFQ whose notional is at least `blockMinNotional`: it may exceed the ordinary
/// per-position cap, up to `blockMaxNotional`. The open-interest cap and leverage tiers still apply.
contract RFQManager is AccessControl, EIP712, ReentrancyGuard {
    bytes32 public constant MAKER_ROLE = keccak256("MAKER_ROLE");
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");

    bytes32 internal constant RFQ_TYPEHASH = keccak256(
        "RFQQuote(address user,bytes32 marketId,bool isLong,uint256 collateral,uint256 leverage,uint256 price,uint256 validUntil,uint256 nonce)"
    );
    uint256 internal constant BPS = 10_000;

    PerpsEngine public immutable perpsEngine;
    OracleRouter public immutable oracleRouter;

    /// @notice Widest gap between a quoted price and the mark price, in basis points of the mark.
    uint256 public maxDeviationBps = 100;
    /// @notice A trade of at least this notional is a block trade. Zero turns block trades off.
    uint256 public blockMinNotional;
    /// @notice Largest block trade, notional. Must be set with `blockMinNotional`.
    uint256 public blockMaxNotional;

    mapping(bytes32 => bool) public used;

    struct RFQQuote {
        address user;
        bytes32 marketId;
        bool isLong;
        uint256 collateral;
        uint256 leverage;
        /// @dev 18 decimals.
        uint256 price;
        uint256 validUntil;
        uint256 nonce;
    }

    error ZeroAddress();
    error NotQuoteUser();
    error QuoteExpired();
    error QuoteAlreadyUsed();
    error InvalidQuote();
    error PriceOutOfBand(uint256 price, uint256 mark);
    error BlockTooLarge(uint256 notional, uint256 max);
    error InvalidBlockBounds();
    error InvalidDeviation();

    event RFQExecuted(
        address indexed user, address indexed maker, uint256 indexed positionId, uint256 price, bool isBlock
    );
    event ParametersUpdated(uint256 maxDeviationBps, uint256 blockMinNotional, uint256 blockMaxNotional);

    constructor(address admin, address perpsEngine_, address oracleRouter_) EIP712("AlphaMarketsRFQ", "1") {
        if (admin == address(0) || perpsEngine_ == address(0) || oracleRouter_ == address(0)) revert ZeroAddress();
        perpsEngine = PerpsEngine(perpsEngine_);
        oracleRouter = OracleRouter(oracleRouter_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_ADMIN_ROLE, admin);
    }

    function setParameters(uint256 deviationBps, uint256 blockMin, uint256 blockMax)
        external
        onlyRole(RISK_ADMIN_ROLE)
    {
        if (deviationBps == 0 || deviationBps >= BPS) revert InvalidDeviation();
        if (blockMin != 0 && blockMax < blockMin) revert InvalidBlockBounds();
        maxDeviationBps = deviationBps;
        blockMinNotional = blockMin;
        blockMaxNotional = blockMax;
        emit ParametersUpdated(deviationBps, blockMin, blockMax);
    }

    /// @notice The digest a maker signs for `quote`.
    function quoteDigest(RFQQuote calldata quote) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RFQ_TYPEHASH,
                    quote.user,
                    quote.marketId,
                    quote.isLong,
                    quote.collateral,
                    quote.leverage,
                    quote.price,
                    quote.validUntil,
                    quote.nonce
                )
            )
        );
    }

    /// @notice Opens the quoted position for the caller at the quoted price. The caller is the
    /// quote's user, so nobody can spend someone else's quote or margin.
    function execute(RFQQuote calldata quote, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 positionId)
    {
        if (msg.sender != quote.user) revert NotQuoteUser();
        address maker = _consume(quote, signature);
        bool isBlock = _checkTerms(quote);
        positionId = _open(quote, isBlock);
        emit RFQExecuted(quote.user, maker, positionId, quote.price, isBlock);
    }

    /// @dev Checks the quote is live and signed by a maker, and spends it.
    function _consume(RFQQuote calldata quote, bytes calldata signature) internal returns (address maker) {
        if (block.timestamp > quote.validUntil) revert QuoteExpired();
        bytes32 digest = quoteDigest(quote);
        if (used[digest]) revert QuoteAlreadyUsed();
        ECDSA.RecoverError err;
        (maker, err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || !hasRole(MAKER_ROLE, maker)) revert InvalidQuote();
        used[digest] = true;
    }

    /// @dev The price must be near the mark; returns whether the trade is a block trade.
    function _checkTerms(RFQQuote calldata quote) internal view returns (bool isBlock) {
        (uint256 mark,) = oracleRouter.getMarkPrice(quote.marketId);
        uint256 gap = quote.price > mark ? quote.price - mark : mark - quote.price;
        if (gap * BPS > mark * maxDeviationBps) revert PriceOutOfBand(quote.price, mark);

        uint256 notional = quote.collateral * quote.leverage;
        isBlock = blockMinNotional != 0 && notional >= blockMinNotional;
        if (isBlock && notional > blockMaxNotional) revert BlockTooLarge(notional, blockMaxNotional);
    }

    function _open(RFQQuote calldata quote, bool isBlock) internal returns (uint256) {
        return perpsEngine.openPositionAtPrice(
            quote.user, quote.marketId, quote.isLong, quote.collateral, quote.leverage, quote.price, isBlock
        );
    }
}
