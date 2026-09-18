// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IOrionisVault} from "../interfaces/IOrionisVault.sol";
import {OracleRouter} from "../oracle/OracleRouter.sol";
import {PerpPositionManager} from "./PerpPositionManager.sol";

/// @notice Funding rate calculation and per-position accrual (PROJECT_BRIEF.md Section 15).
/// Keeps perp price aligned with the underlying index by charging the side pushing price
/// away from index, and paying the other side — a zero-sum transfer between longs/shorts.
contract FundingManager is AccessControl {
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
    /// @notice Granted to PerpsEngine and LiquidationEngine.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    uint256 public constant DEFAULT_FUNDING_INTERVAL = 1 hours;
    uint256 public constant DEFAULT_MAX_FUNDING_RATE_BPS = 100; // 1% per interval
    uint256 public constant BPS_DENOMINATOR = 10_000;

    OracleRouter public immutable oracleRouter;
    PerpPositionManager public immutable positionManager;
    IOrionisVault public immutable vault;
    address public immutable settlementToken;

    mapping(bytes32 => uint256) public fundingInterval;
    mapping(bytes32 => uint256) public maxFundingRateBps;
    mapping(bytes32 => uint256) public lastFundingTimestamp;
    mapping(bytes32 => int256) public currentFundingRateBps;
    mapping(bytes32 => int256) public cumulativeFundingIndex;

    event FundingIntervalUpdated(bytes32 indexed marketId, uint256 interval);
    event FundingRateUpdated(bytes32 indexed marketId, int256 rateBps, int256 cumulativeIndex);
    event FundingPaid(uint256 indexed positionId, bytes32 indexed marketId, int256 amount, int256 fundingIndex);

    constructor(
        address admin,
        address oracleRouter_,
        address positionManager_,
        address vault_,
        address settlementToken_
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_ADMIN_ROLE, admin);
        oracleRouter = OracleRouter(oracleRouter_);
        positionManager = PerpPositionManager(positionManager_);
        vault = IOrionisVault(vault_);
        settlementToken = settlementToken_;
    }

    function setFundingInterval(bytes32 marketId, uint256 interval) external onlyRole(RISK_ADMIN_ROLE) {
        fundingInterval[marketId] = interval;
        emit FundingIntervalUpdated(marketId, interval);
    }

    function setMaxFundingRateBps(bytes32 marketId, uint256 value) external onlyRole(RISK_ADMIN_ROLE) {
        maxFundingRateBps[marketId] = value;
    }

    function nextFundingTimestamp(bytes32 marketId) external view returns (uint256) {
        uint256 interval = _interval(marketId);
        return lastFundingTimestamp[marketId] + interval;
    }

    /// @notice Recomputes the funding rate from `(mark - index) / index`, clamped, and
    /// folds it into the cumulative index. No-ops if the market's interval has not yet
    /// elapsed, so it is safe to call unconditionally on every position touch.
    function updateFundingRate(bytes32 marketId) public {
        uint256 interval = _interval(marketId);
        if (block.timestamp < lastFundingTimestamp[marketId] + interval) return;

        (uint256 markPrice,) = oracleRouter.getMarkPrice(marketId);
        (uint256 indexPrice,) = oracleRouter.getIndexPrice(marketId);

        int256 rateBps = 0;
        if (indexPrice > 0) {
            rateBps = ((int256(markPrice) - int256(indexPrice)) * int256(BPS_DENOMINATOR)) / int256(indexPrice);
        }

        uint256 maxAbs = maxFundingRateBps[marketId] == 0 ? DEFAULT_MAX_FUNDING_RATE_BPS : maxFundingRateBps[marketId];
        if (rateBps > int256(maxAbs)) rateBps = int256(maxAbs);
        if (rateBps < -int256(maxAbs)) rateBps = -int256(maxAbs);

        currentFundingRateBps[marketId] = rateBps;
        cumulativeFundingIndex[marketId] += rateBps;
        lastFundingTimestamp[marketId] = block.timestamp;

        emit FundingRateUpdated(marketId, rateBps, cumulativeFundingIndex[marketId]);
    }

    /// @notice Settles accrued funding for one position against the market's current
    /// cumulative index. A positive index delta means the perp has traded above index
    /// since the position's last touch, so longs pay shorts (and vice versa) — a transfer
    /// that is zero-sum in aggregate across all positions in the market, routed through the
    /// shared Vault pool rather than paired 1:1 between specific counterparties.
    function settleFunding(uint256 positionId) external onlyRole(ENGINE_ROLE) returns (int256 amountReceived) {
        PerpPositionManager.PerpPosition memory pos = positionManager.getPosition(positionId);
        if (!pos.open) return 0;

        int256 indexDelta = cumulativeFundingIndex[pos.marketId] - pos.lastFundingIndex;
        if (indexDelta == 0) {
            positionManager.accrueFunding(positionId, 0, cumulativeFundingIndex[pos.marketId]);
            return 0;
        }

        int256 fundingDue = (int256(pos.size) * indexDelta) / int256(BPS_DENOMINATOR);
        int256 positionOwes = pos.isLong ? fundingDue : -fundingDue;
        amountReceived = -positionOwes;

        if (amountReceived != 0) {
            vault.settlePnl(pos.owner, settlementToken, amountReceived);
        }

        positionManager.accrueFunding(positionId, amountReceived, cumulativeFundingIndex[pos.marketId]);
        emit FundingPaid(positionId, pos.marketId, amountReceived, cumulativeFundingIndex[pos.marketId]);
    }

    function _interval(bytes32 marketId) internal view returns (uint256) {
        uint256 interval = fundingInterval[marketId];
        return interval == 0 ? DEFAULT_FUNDING_INTERVAL : interval;
    }
}
