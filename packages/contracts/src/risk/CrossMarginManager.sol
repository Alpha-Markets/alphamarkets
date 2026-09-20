// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IWithdrawGuard} from "../interfaces/IWithdrawGuard.sol";
import {OptionType} from "../interfaces/DataTypes.sol";
import {AlphaMarketsVault} from "../core/AlphaMarketsVault.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";
import {OptionMarket} from "../options/OptionMarket.sol";
import {OptionPositionManager} from "../options/OptionPositionManager.sol";
import {PerpPositionManager} from "../perps/PerpPositionManager.sol";
import {RiskManager} from "./RiskManager.sol";
import {MarginEngine} from "./MarginEngine.sol";

/// @notice Account-level margin (PROJECT_BRIEF.md Sections 39 and 40: cross margin, multiple
/// collateral assets, portfolio margin). Where an isolated position is only backed by its own
/// margin, a CROSS position is backed by the whole account: its free balance, the margin and PnL of
/// its other cross positions, and any other collateral the owner holds.
///
/// An account's health is `equity` against a `requirement`:
///
///   equity      = free settlement-token balance
///               + margin + unrealised PnL of every open cross position
///               + haircut value of other collateral tokens
///   requirement = sum of the maintenance margin of every open cross position
///
/// and the account is liquidatable once equity falls under the requirement (LiquidationEngine
/// reads `isAccountLiquidatable`). Three rules keep that honest:
///
/// - Withdrawals are checked (`check`, called by the Vault): a cross account cannot withdraw the
///   free balance that backs its positions, and must keep a buffer above the requirement.
/// - Other collateral counts at a haircut (`factorBps` of its oracle value), and is SEIZED into the
///   InsuranceFund, at the same haircut, to cover a shortfall (`seizeForShortfall`).
/// - PORTFOLIO MARGIN is opt-in: the requirement becomes the worst loss across price shocks on the
///   cross perps plus the intrinsic value of long options the owner registered, with a floor of a
///   share of the standard requirement, so a hedged book is charged less than the sum of its parts.
///
/// Not modelled: the funding a cross position has accrued and not yet settled, and volatility or
/// time value of options (intrinsic value is a lower bound for a long option). Both are
/// documented limits, and a reason a real deployment needs the audit in DEVELOPMENT_STEPS.md first.
contract CrossMarginManager is AccessControl, IWithdrawGuard {
    /// @notice Granted to PerpsEngine: it marks positions as cross when they are opened.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");
    /// @notice Granted to LiquidationEngine: it seizes collateral to cover a shortfall.
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");

    uint256 public constant BPS = 10_000;
    /// @notice Most open cross positions per account, so every health check has a bounded cost.
    uint256 public constant MAX_CROSS_POSITIONS = 10;
    /// @notice Most option positions a portfolio-margin account can register.
    uint256 public constant MAX_PORTFOLIO_OPTIONS = 20;
    /// @notice A withdrawal must leave equity at least this far above the requirement.
    uint256 public constant WITHDRAW_BUFFER_BPS = 1_000;
    uint256 public constant MAX_SHOCKS = 8;

    struct CollateralConfig {
        bool enabled;
        /// @dev Share of the token's oracle value that counts, in basis points (9_000 = 90%).
        uint16 factorBps;
        /// @dev Oracle market that prices one whole token in settlement-token terms, 18 decimals.
        bytes32 priceMarketId;
        uint8 decimals;
    }

    OracleRouter public immutable oracleRouter;
    RiskManager public immutable riskManager;
    AlphaMarketsVault public immutable vault;
    PerpPositionManager public immutable perpPositionManager;
    OptionPositionManager public immutable optionPositionManager;
    OptionMarket public immutable optionMarket;
    address public immutable settlementToken;
    uint8 public immutable settlementDecimals;
    /// @notice Where seized collateral goes. Zero disables seizure.
    address public immutable insuranceFund;

    mapping(uint256 => bool) public isCross;
    mapping(address => uint256[]) private _crossPositions;

    mapping(address => CollateralConfig) public collateralConfig;
    address[] public collateralTokens;

    mapping(address => bool) public portfolioMargin;
    mapping(address => uint256[]) private _portfolioOptions;
    /// @notice Price moves the portfolio-margin requirement is tested against, in basis points.
    int256[] public shocksBps;
    /// @notice Least a portfolio-margin requirement can be, as a share of the standard one.
    uint256 public portfolioFloorBps = 3_000;

    error ZeroAddress();
    error TooManyCrossPositions();
    error TooManyPortfolioOptions();
    error NotOptionOwner();
    error OptionNotOpen();
    error AlreadyRegistered();
    error WithdrawWouldUndermargin(int256 equityAfter, uint256 requiredWithBuffer);
    error InvalidFactor();
    error TooManyShocks();
    error InvalidShock();

    event PositionMarkedCross(uint256 indexed positionId, address indexed owner);
    event CollateralConfigured(address indexed token, uint16 factorBps, bytes32 priceMarketId, bool enabled);
    event PortfolioMarginSet(address indexed owner, bool enabled);
    event PortfolioOptionAdded(address indexed owner, uint256 indexed optionPositionId);
    event ShocksUpdated(int256[] shocksBps, uint256 floorBps);
    event CollateralSeized(address indexed owner, address indexed token, uint256 amount, uint256 valueCovered);

    constructor(
        address admin,
        address oracleRouter_,
        address riskManager_,
        address vault_,
        address perpPositionManager_,
        address optionPositionManager_,
        address optionMarket_,
        address settlementToken_,
        address insuranceFund_
    ) {
        if (
            admin == address(0) || oracleRouter_ == address(0) || riskManager_ == address(0) || vault_ == address(0)
                || perpPositionManager_ == address(0) || optionPositionManager_ == address(0)
                || optionMarket_ == address(0) || settlementToken_ == address(0)
        ) revert ZeroAddress();
        oracleRouter = OracleRouter(oracleRouter_);
        riskManager = RiskManager(riskManager_);
        vault = AlphaMarketsVault(vault_);
        perpPositionManager = PerpPositionManager(perpPositionManager_);
        optionPositionManager = OptionPositionManager(optionPositionManager_);
        optionMarket = OptionMarket(optionMarket_);
        settlementToken = settlementToken_;
        settlementDecimals = IERC20Metadata(settlementToken_).decimals();
        insuranceFund = insuranceFund_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_ADMIN_ROLE, admin);

        // Tested price moves for portfolio margin: down and up by 10% and 20%.
        shocksBps.push(-2_000);
        shocksBps.push(-1_000);
        shocksBps.push(1_000);
        shocksBps.push(2_000);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Lets `token` count as collateral, valued by the oracle market `priceMarketId` at
    /// `factorBps` of its price. The token must also be a supported token of the CollateralManager
    /// for anyone to deposit it.
    function setCollateralConfig(address token, uint16 factorBps, bytes32 priceMarketId, bool enabled)
        external
        onlyRole(RISK_ADMIN_ROLE)
    {
        if (token == address(0)) revert ZeroAddress();
        if (token == settlementToken) revert InvalidFactor();
        if (factorBps > BPS) revert InvalidFactor();
        if (!collateralConfig[token].enabled && enabled && !_listed(token)) collateralTokens.push(token);
        collateralConfig[token] = CollateralConfig({
            enabled: enabled,
            factorBps: factorBps,
            priceMarketId: priceMarketId,
            decimals: IERC20Metadata(token).decimals()
        });
        emit CollateralConfigured(token, factorBps, priceMarketId, enabled);
    }

    function setPortfolioParameters(int256[] calldata shocks, uint256 floorBps) external onlyRole(RISK_ADMIN_ROLE) {
        if (shocks.length == 0 || shocks.length > MAX_SHOCKS) revert TooManyShocks();
        if (floorBps > BPS) revert InvalidFactor();
        for (uint256 i = 0; i < shocks.length; i++) {
            if (shocks[i] <= -int256(BPS) || shocks[i] > int256(10 * BPS)) revert InvalidShock();
        }
        delete shocksBps;
        for (uint256 i = 0; i < shocks.length; i++) {
            shocksBps.push(shocks[i]);
        }
        portfolioFloorBps = floorBps;
        emit ShocksUpdated(shocks, floorBps);
    }

    // ---------------------------------------------------------------------
    // Position tracking
    // ---------------------------------------------------------------------

    /// @notice Marks `positionId` as a cross position of `owner`. Called by PerpsEngine when it
    /// opens one.
    function markCross(uint256 positionId, address owner) external onlyRole(ENGINE_ROLE) {
        if (_openCrossCount(owner) >= MAX_CROSS_POSITIONS) revert TooManyCrossPositions();
        isCross[positionId] = true;
        _crossPositions[owner].push(positionId);
        emit PositionMarkedCross(positionId, owner);
    }

    function crossPositionsOf(address owner) external view returns (uint256[] memory) {
        return _crossPositions[owner];
    }

    // ---------------------------------------------------------------------
    // Portfolio margin (opt-in, per account)
    // ---------------------------------------------------------------------

    function setPortfolioMargin(bool enabled) external {
        portfolioMargin[msg.sender] = enabled;
        emit PortfolioMarginSet(msg.sender, enabled);
    }

    /// @notice Counts one of the caller's open long option positions against the portfolio-margin
    /// requirement, at its intrinsic value under each price shock.
    function addPortfolioOption(uint256 optionPositionId) external {
        OptionPositionManager.OptionPosition memory option = optionPositionManager.getPosition(optionPositionId);
        if (option.owner != msg.sender) revert NotOptionOwner();
        if (option.status != OptionPositionManager.PositionStatus.OPEN) revert OptionNotOpen();

        uint256[] storage list = _portfolioOptions[msg.sender];
        if (_openPortfolioOptions(msg.sender) >= MAX_PORTFOLIO_OPTIONS) revert TooManyPortfolioOptions();
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == optionPositionId) revert AlreadyRegistered();
        }
        list.push(optionPositionId);
        emit PortfolioOptionAdded(msg.sender, optionPositionId);
    }

    function portfolioOptionsOf(address owner) external view returns (uint256[] memory) {
        return _portfolioOptions[owner];
    }

    // ---------------------------------------------------------------------
    // Health
    // ---------------------------------------------------------------------

    /// @notice The account's equity (which can be negative) and the requirement it must stay above.
    function accountHealth(address owner) public view returns (int256 equity, uint256 requirement) {
        equity = int256(vault.availableBalance(owner, settlementToken));

        uint256 standard;
        uint256[] storage ids = _crossPositions[owner];
        for (uint256 i = 0; i < ids.length; i++) {
            PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(ids[i]);
            if (!pos.open) continue;
            (uint256 mark,) = oracleRouter.getMarkPrice(pos.marketId);
            equity += int256(pos.collateral) + MarginEngine.unrealizedPnl(pos.isLong, pos.entryPrice, mark, pos.size);
            standard += MarginEngine.maintenanceMargin(pos.size, riskManager.maintenanceMarginRateBps(pos.marketId));
        }

        for (uint256 i = 0; i < collateralTokens.length; i++) {
            address token = collateralTokens[i];
            uint256 held = vault.availableBalance(owner, token);
            if (held != 0) equity += int256(_haircutValue(token, held));
        }

        requirement = standard;
        if (portfolioMargin[owner] && standard != 0) {
            uint256 scenario = _scenarioLoss(owner);
            uint256 floor = (standard * portfolioFloorBps) / BPS;
            requirement = scenario > floor ? scenario : floor;
        }
    }

    function hasOpenCrossPosition(address owner) public view returns (bool) {
        return _openCrossCount(owner) != 0;
    }

    /// @notice True when the owner has open cross positions and their equity is under the requirement.
    function isAccountLiquidatable(address owner) external view returns (bool) {
        if (!hasOpenCrossPosition(owner)) return false;
        (int256 equity, uint256 requirement) = accountHealth(owner);
        return equity < int256(requirement);
    }

    /// @notice The open cross position with the lowest margin ratio: the one to liquidate first, so
    /// a liquidator cannot pick a healthy position to close while a failing one stays open.
    function worstPosition(address owner) external view returns (uint256 worstId) {
        uint256[] storage ids = _crossPositions[owner];
        int256 lowest = type(int256).max;
        for (uint256 i = 0; i < ids.length; i++) {
            PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(ids[i]);
            if (!pos.open) continue;
            (uint256 mark,) = oracleRouter.getMarkPrice(pos.marketId);
            int256 equity =
                int256(pos.collateral) + MarginEngine.unrealizedPnl(pos.isLong, pos.entryPrice, mark, pos.size);
            int256 ratio = (equity * int256(BPS)) / int256(pos.size);
            if (ratio < lowest) {
                lowest = ratio;
                worstId = ids[i];
            }
        }
    }

    /// @notice Vault hook: refuses a withdrawal that would leave a cross account under-margined.
    function check(address user, address token, uint256 amount) external view {
        if (!hasOpenCrossPosition(user)) return;
        (int256 equity, uint256 requirement) = accountHealth(user);
        uint256 taken = token == settlementToken ? amount : _haircutValue(token, amount);
        int256 after_ = equity - int256(taken);
        uint256 required = (requirement * (BPS + WITHDRAW_BUFFER_BPS)) / BPS;
        if (after_ < int256(required)) revert WithdrawWouldUndermargin(after_, required);
    }

    // ---------------------------------------------------------------------
    // Seizure (multiple collateral)
    // ---------------------------------------------------------------------

    /// @notice Moves other collateral from `owner` to the InsuranceFund, at its haircut value, up to
    /// `shortfall` of settlement-token value. Returns the value covered; the caller (LiquidationEngine)
    /// then has the fund pay that much of the shortfall in the settlement token.
    function seizeForShortfall(address owner, uint256 shortfall)
        external
        onlyRole(LIQUIDATOR_ROLE)
        returns (uint256 covered)
    {
        if (insuranceFund == address(0) || shortfall == 0) return 0;
        for (uint256 i = 0; i < collateralTokens.length && covered < shortfall; i++) {
            address token = collateralTokens[i];
            uint256 held = vault.availableBalance(owner, token);
            if (held == 0) continue;
            uint256 value = _haircutValue(token, held);
            if (value == 0) continue;

            uint256 need = shortfall - covered;
            uint256 amount = need >= value ? held : (held * need) / value;
            if (amount == 0) continue;
            uint256 valueTaken = need >= value ? value : need;

            vault.settlePnl(owner, token, -int256(amount));
            vault.settlePnl(insuranceFund, token, int256(amount));
            covered += valueTaken;
            emit CollateralSeized(owner, token, amount, valueTaken);
        }
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _listed(address token) internal view returns (bool) {
        for (uint256 i = 0; i < collateralTokens.length; i++) {
            if (collateralTokens[i] == token) return true;
        }
        return false;
    }

    function _openCrossCount(address owner) internal view returns (uint256 count) {
        uint256[] storage ids = _crossPositions[owner];
        for (uint256 i = 0; i < ids.length; i++) {
            if (perpPositionManager.getPosition(ids[i]).open) count++;
        }
    }

    function _openPortfolioOptions(address owner) internal view returns (uint256 count) {
        uint256[] storage ids = _portfolioOptions[owner];
        for (uint256 i = 0; i < ids.length; i++) {
            if (optionPositionManager.getPosition(ids[i]).status == OptionPositionManager.PositionStatus.OPEN) count++;
        }
    }

    /// @dev Settlement-token value of `amount` of `token` after the haircut.
    function _haircutValue(address token, uint256 amount) internal view returns (uint256) {
        CollateralConfig memory config = collateralConfig[token];
        if (!config.enabled) return 0;
        (uint256 price,) = oracleRouter.getMarkPrice(config.priceMarketId);
        uint256 value = (amount * price * (10 ** settlementDecimals)) / ((10 ** config.decimals) * 1e18);
        return (value * config.factorBps) / BPS;
    }

    /// @dev The worst loss across the shocks, on the cross perps plus the intrinsic value of the
    /// registered long options, in settlement-token units. 0 when no shock loses money.
    function _scenarioLoss(address owner) internal view returns (uint256) {
        int256 worst;
        for (uint256 s = 0; s < shocksBps.length; s++) {
            int256 total = _scenarioPnl(owner, shocksBps[s]);
            if (total < worst) worst = total;
        }
        return worst < 0 ? uint256(-worst) : 0;
    }

    function _scenarioPnl(address owner, int256 shockBps) internal view returns (int256 total) {
        uint256[] storage perpIds = _crossPositions[owner];
        for (uint256 i = 0; i < perpIds.length; i++) {
            PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(perpIds[i]);
            if (!pos.open) continue;
            (uint256 mark,) = oracleRouter.getMarkPrice(pos.marketId);
            total += MarginEngine.unrealizedPnl(pos.isLong, pos.entryPrice, _shock(mark, shockBps), pos.size);
        }

        uint256[] storage optionIds = _portfolioOptions[owner];
        for (uint256 i = 0; i < optionIds.length; i++) {
            OptionPositionManager.OptionPosition memory option = optionPositionManager.getPosition(optionIds[i]);
            if (option.status != OptionPositionManager.PositionStatus.OPEN || option.expiry <= block.timestamp) {
                continue;
            }
            (uint256 mark,) = oracleRouter.getMarkPrice(option.marketId);
            uint256 price = _shock(mark, shockBps);
            uint256 intrinsic;
            if (option.optionType == OptionType.CALL) intrinsic = price > option.strike ? price - option.strike : 0;
            else intrinsic = option.strike > price ? option.strike - price : 0;
            // Per underlying unit, in 18 decimals, times units per contract and contracts, narrowed
            // to the settlement token's decimals.
            uint256 value18 = (intrinsic * optionMarket.getContractSize(option.marketId)) / 1e18 * option.contracts;
            total += int256(_narrow(value18));
        }
    }

    function _shock(uint256 price, int256 shockBps) internal pure returns (uint256) {
        int256 scaled = (int256(price) * (int256(BPS) + shockBps)) / int256(BPS);
        return scaled <= 0 ? 0 : uint256(scaled);
    }

    function _narrow(uint256 value18) internal view returns (uint256) {
        return settlementDecimals >= 18
            ? value18 * (10 ** (settlementDecimals - 18))
            : value18 / (10 ** (18 - settlementDecimals));
    }
}
