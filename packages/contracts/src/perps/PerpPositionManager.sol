// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Perp position storage only (PROJECT_BRIEF.md Section 12) — no pricing, no risk
/// math. Mark/index price, unrealized PnL, margin ratio, and liquidation price are derived
/// on read by PerpsEngine/LiquidationEngine from live oracle data, not stored here, so they
/// never go stale between updates.
contract PerpPositionManager is AccessControl {
    /// @notice Granted to PerpsEngine, FundingManager, LiquidationEngine.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    struct PerpPosition {
        bytes32 marketId;
        bool isLong;
        uint256 entryPrice;
        uint256 size;
        uint256 collateral;
        uint256 leverage;
        int256 realizedPnl;
        int256 fundingAccrued;
        int256 lastFundingIndex;
        bool open;
        address owner;
    }

    error PositionNotFound(uint256 positionId);
    error PositionNotOpen(uint256 positionId);

    mapping(uint256 => PerpPosition) private _positions;
    mapping(address => uint256[]) private _userPositions;
    uint256 public nextPositionId;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function createPosition(PerpPosition calldata pos) external onlyRole(ENGINE_ROLE) returns (uint256 positionId) {
        positionId = ++nextPositionId;
        _positions[positionId] = pos;
        _userPositions[pos.owner].push(positionId);
    }

    function updatePosition(uint256 positionId, uint256 newSize, uint256 newCollateral, uint256 newEntryPrice)
        external
        onlyRole(ENGINE_ROLE)
    {
        PerpPosition storage p = _positions[positionId];
        if (p.owner == address(0)) revert PositionNotFound(positionId);
        if (!p.open) revert PositionNotOpen(positionId);
        p.size = newSize;
        p.collateral = newCollateral;
        p.entryPrice = newEntryPrice;
    }

    function closePosition(uint256 positionId) external onlyRole(ENGINE_ROLE) {
        PerpPosition storage p = _positions[positionId];
        if (p.owner == address(0)) revert PositionNotFound(positionId);
        if (!p.open) revert PositionNotOpen(positionId);
        p.open = false;
    }

    function accrueFunding(uint256 positionId, int256 fundingDelta, int256 newFundingIndex)
        external
        onlyRole(ENGINE_ROLE)
    {
        PerpPosition storage p = _positions[positionId];
        if (p.owner == address(0)) revert PositionNotFound(positionId);
        p.fundingAccrued += fundingDelta;
        p.lastFundingIndex = newFundingIndex;
    }

    function setRealizedPnl(uint256 positionId, int256 realizedPnl) external onlyRole(ENGINE_ROLE) {
        PerpPosition storage p = _positions[positionId];
        if (p.owner == address(0)) revert PositionNotFound(positionId);
        p.realizedPnl += realizedPnl;
    }

    function getPosition(uint256 positionId) external view returns (PerpPosition memory) {
        return _positions[positionId];
    }

    function getUserPositions(address user) external view returns (uint256[] memory) {
        return _userPositions[user];
    }
}
