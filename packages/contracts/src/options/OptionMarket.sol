// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {OptionType} from "../interfaces/DataTypes.sol";

/// @notice Option identifier encoding (`UNDERLYING-EXPIRY-STRIKE-TYPE`, PROJECT_BRIEF.md
/// Section 8) and per-series bookkeeping (open interest, contract size).
contract OptionMarket is AccessControl {
    bytes32 public constant OPTIONS_ADMIN_ROLE = keccak256("OPTIONS_ADMIN_ROLE");
    /// @notice Granted to OptionsEngine.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    /// @notice Units of underlying represented per contract, 18-decimal fixed point.
    /// Defaults to 1e18 (one unit of underlying per contract) when unset.
    uint256 public constant DEFAULT_CONTRACT_SIZE = 1e18;

    struct OptionSeries {
        bytes32 underlyingMarketId;
        uint256 expiry;
        uint256 strike;
        OptionType optionType;
        uint256 openInterest;
        bool exists;
    }

    mapping(bytes32 => OptionSeries) public series;
    mapping(bytes32 => uint256) public contractSize;

    event SeriesCreated(
        bytes32 indexed seriesId,
        bytes32 indexed underlyingMarketId,
        uint256 expiry,
        uint256 strike,
        OptionType optionType
    );
    event ContractSizeUpdated(bytes32 indexed underlyingMarketId, uint256 contractSize);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPTIONS_ADMIN_ROLE, admin);
    }

    function setContractSize(bytes32 underlyingMarketId, uint256 size) external onlyRole(OPTIONS_ADMIN_ROLE) {
        contractSize[underlyingMarketId] = size;
        emit ContractSizeUpdated(underlyingMarketId, size);
    }

    function getContractSize(bytes32 underlyingMarketId) external view returns (uint256) {
        uint256 size = contractSize[underlyingMarketId];
        return size == 0 ? DEFAULT_CONTRACT_SIZE : size;
    }

    function seriesId(bytes32 underlyingMarketId, uint256 expiry, uint256 strike, OptionType optionType)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(underlyingMarketId, expiry, strike, optionType));
    }

    function getOrCreateSeries(bytes32 underlyingMarketId, uint256 expiry, uint256 strike, OptionType optionType)
        external
        onlyRole(ENGINE_ROLE)
        returns (bytes32 id)
    {
        id = seriesId(underlyingMarketId, expiry, strike, optionType);
        if (!series[id].exists) {
            series[id] = OptionSeries({
                underlyingMarketId: underlyingMarketId,
                expiry: expiry,
                strike: strike,
                optionType: optionType,
                openInterest: 0,
                exists: true
            });
            emit SeriesCreated(id, underlyingMarketId, expiry, strike, optionType);
        }
    }

    function updateOpenInterest(bytes32 id, int256 delta) external onlyRole(ENGINE_ROLE) {
        OptionSeries storage s = series[id];
        if (delta >= 0) {
            s.openInterest += uint256(delta);
        } else {
            s.openInterest -= uint256(-delta);
        }
    }

    function getSeries(bytes32 id) external view returns (OptionSeries memory) {
        return series[id];
    }
}
