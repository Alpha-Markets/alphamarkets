// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {OptionType} from "../interfaces/DataTypes.sol";

/// @notice Option position storage and accounting only — no pricing, no settlement math
/// (kept separate so each contract has one responsibility). Written only by OptionsEngine.
contract OptionPositionManager is AccessControl {
    /// @notice Granted to OptionsEngine.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    enum PositionStatus {
        OPEN,
        CLOSED,
        SETTLED
    }

    struct OptionPosition {
        bytes32 marketId;
        OptionType optionType;
        uint256 strike;
        uint256 expiry;
        uint256 contracts;
        uint256 entryPremium;
        uint256 collateral;
        int256 realizedPnl;
        PositionStatus status;
        address owner;
    }

    error PositionNotFound(uint256 positionId);
    error PositionNotOpen(uint256 positionId);

    mapping(uint256 => OptionPosition) private _positions;
    mapping(address => uint256[]) private _userPositions;
    /// @notice seriesId => open+closed+settled position ids in that series, so
    /// OptionsEngine.settleExpired can enumerate every position in a series to settle.
    mapping(bytes32 => uint256[]) private _seriesPositions;
    uint256 public nextPositionId;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function createPosition(OptionPosition calldata pos, bytes32 seriesId)
        external
        onlyRole(ENGINE_ROLE)
        returns (uint256 positionId)
    {
        positionId = ++nextPositionId;
        _positions[positionId] = pos;
        _userPositions[pos.owner].push(positionId);
        _seriesPositions[seriesId].push(positionId);
    }

    function closePosition(uint256 positionId, int256 realizedPnl) external onlyRole(ENGINE_ROLE) {
        OptionPosition storage p = _positions[positionId];
        if (p.owner == address(0)) revert PositionNotFound(positionId);
        if (p.status != PositionStatus.OPEN) revert PositionNotOpen(positionId);
        p.status = PositionStatus.CLOSED;
        p.realizedPnl = realizedPnl;
    }

    function settlePosition(uint256 positionId, int256 realizedPnl) external onlyRole(ENGINE_ROLE) {
        OptionPosition storage p = _positions[positionId];
        if (p.owner == address(0)) revert PositionNotFound(positionId);
        if (p.status != PositionStatus.OPEN) revert PositionNotOpen(positionId);
        p.status = PositionStatus.SETTLED;
        p.realizedPnl = realizedPnl;
    }

    function getPosition(uint256 positionId) external view returns (OptionPosition memory) {
        return _positions[positionId];
    }

    function getUserPositions(address user) external view returns (uint256[] memory) {
        return _userPositions[user];
    }

    function getSeriesPositions(bytes32 seriesId) external view returns (uint256[] memory) {
        return _seriesPositions[seriesId];
    }
}
