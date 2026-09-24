// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFeeManager} from "../interfaces/IFeeManager.sol";
import {IAlphaMarketsVault} from "../interfaces/IAlphaMarketsVault.sol";
import {FeeConfig} from "../interfaces/DataTypes.sol";
import {BuybackModule} from "./BuybackModule.sol";

/// @notice Per-market fee schedule and fee collection routing (PROJECT_BRIEF.md Section
/// 20). Pulls fees from AlphaMarketsVault, then routes a configurable share on to the
/// BuybackModule (Section 21) — the rest stays here as protocol revenue.
contract FeeManager is IFeeManager, UpgradeableBase {
    using SafeERC20 for IERC20;

    bytes32 public constant FEE_ADMIN_ROLE = keccak256("FEE_ADMIN_ROLE");
    /// @notice Granted to OptionsEngine, PerpsEngine, LiquidationEngine.
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    uint256 public constant BPS_DENOMINATOR = 10_000;

    IAlphaMarketsVault public immutable vault;

    mapping(bytes32 => FeeConfig) private _feeConfigs;
    uint256 public buybackShareBps;
    address public buybackModule;

    error ZeroAddress();
    error InvalidBps(uint256 bps);

    event FeeConfigUpdated(bytes32 indexed marketId);
    event BuybackShareUpdated(uint256 bps);
    event BuybackModuleUpdated(address indexed module);
    event ProtocolFeeCollected(
        bytes32 indexed marketId, address indexed payer, address token, uint256 amount, bytes32 feeType
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address vault_) {
        if (vault_ == address(0)) revert ZeroAddress();
        vault = IAlphaMarketsVault(vault_);
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        __UpgradeableBase_init(admin);
        _grantRole(FEE_ADMIN_ROLE, admin);
    }

    function setFeeConfig(bytes32 marketId, FeeConfig calldata config) external onlyRole(FEE_ADMIN_ROLE) {
        _feeConfigs[marketId] = config;
        emit FeeConfigUpdated(marketId);
    }

    function setBuybackShare(uint256 bps) external onlyRole(FEE_ADMIN_ROLE) {
        if (bps > BPS_DENOMINATOR) revert InvalidBps(bps);
        buybackShareBps = bps;
        emit BuybackShareUpdated(bps);
    }

    function setBuybackModule(address module) external onlyRole(FEE_ADMIN_ROLE) {
        buybackModule = module;
        emit BuybackModuleUpdated(module);
    }

    function getFeeConfig(bytes32 marketId) external view returns (FeeConfig memory) {
        return _feeConfigs[marketId];
    }

    /// @notice Pulls `amount` of `token` from `payer`'s vault balance, routes
    /// `buybackShareBps` of it on to the BuybackModule, and keeps the rest as protocol
    /// revenue held by this contract.
    function collectFee(bytes32 marketId, address payer, address token, uint256 amount, bytes32 feeType)
        external
        onlyRole(ENGINE_ROLE)
    {
        if (amount == 0) return;

        vault.transferFee(payer, token, amount, feeType);
        emit ProtocolFeeCollected(marketId, payer, token, amount, feeType);

        if (buybackModule == address(0) || buybackShareBps == 0) return;

        uint256 share = (amount * buybackShareBps) / BPS_DENOMINATOR;
        if (share == 0) return;

        IERC20(token).safeTransfer(buybackModule, share);
        BuybackModule(buybackModule).notifyFees(token, share);
    }
}
