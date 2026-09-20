// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {MarketRegistry} from "../src/core/MarketRegistry.sol";
import {CollateralManager} from "../src/core/CollateralManager.sol";
import {OrionisVault} from "../src/core/OrionisVault.sol";
import {FeeManager} from "../src/core/FeeManager.sol";
import {BuybackModule} from "../src/core/BuybackModule.sol";
import {PriceValidator} from "../src/oracle/PriceValidator.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {RiskManager} from "../src/risk/RiskManager.sol";
import {OptionPositionManager} from "../src/options/OptionPositionManager.sol";
import {OptionMarket} from "../src/options/OptionMarket.sol";
import {OptionsEngine} from "../src/options/OptionsEngine.sol";
import {PerpPositionManager} from "../src/perps/PerpPositionManager.sol";
import {PerpOrderManager} from "../src/perps/PerpOrderManager.sol";
import {InsuranceFund} from "../src/core/InsuranceFund.sol";
import {CrossMarginManager} from "../src/risk/CrossMarginManager.sol";
import {SubaccountFactory} from "../src/accounts/SubaccountFactory.sol";
import {RFQManager} from "../src/perps/RFQManager.sol";
import {FundingManager} from "../src/perps/FundingManager.sol";
import {PerpsEngine} from "../src/perps/PerpsEngine.sol";
import {LiquidationEngine} from "../src/perps/LiquidationEngine.sol";

/// @notice Deploys the full Phase 1 contract stack in dependency order, wires every
/// AccessControl role, and writes deployed addresses to
/// `deployments/<network>.json`. Reads the deployer key from `PRIVATE_KEY` and the
/// settlement collateral token from `COLLATERAL_TOKEN` env vars.
///
/// Usage (testnet, once chain ID/RPC/deployer key are available):
///   forge script script/DeployAll.s.sol --rpc-url robinhood_testnet --broadcast --verify
///
/// Usage (local dry run against Anvil, no env vars needed beyond Anvil's default key):
///   anvil &
///   forge script script/DeployAll.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract DeployAll is Script {
    struct Deployment {
        address marketRegistry;
        address collateralManager;
        address vault;
        address feeManager;
        address buybackModule;
        address priceValidator;
        address oracleRouter;
        address riskManager;
        address optionPositionManager;
        address optionMarket;
        address optionsEngine;
        address perpPositionManager;
        address perpOrderManager;
        address fundingManager;
        address perpsEngine;
        address liquidationEngine;
        address insuranceFund;
        address crossMargin;
        address subaccountFactory;
        address rfqManager;
        address settlementToken;
    }

    function run() external returns (Deployment memory d) {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address admin = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);
        address settlementToken = vm.envOr("COLLATERAL_TOKEN", address(0));

        if (deployerKey == 0) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        require(settlementToken != address(0), "COLLATERAL_TOKEN env var not set");

        d.settlementToken = settlementToken;
        d.marketRegistry = address(new MarketRegistry(admin));
        d.collateralManager = address(new CollateralManager(admin));
        d.vault = address(new OrionisVault(admin, d.collateralManager));
        d.feeManager = address(new FeeManager(admin, d.vault));
        d.buybackModule = address(new BuybackModule(admin));
        d.priceValidator = address(new PriceValidator(admin));
        d.oracleRouter = address(new OracleRouter(admin, d.priceValidator));
        d.riskManager = address(new RiskManager(admin));
        d.optionPositionManager = address(new OptionPositionManager(admin));
        d.optionMarket = address(new OptionMarket(admin));
        d.perpPositionManager = address(new PerpPositionManager(admin));
        d.perpOrderManager = address(new PerpOrderManager(admin));
        d.fundingManager =
            address(new FundingManager(admin, d.oracleRouter, d.perpPositionManager, d.vault, settlementToken));

        d.optionsEngine = address(
            new OptionsEngine(
                admin,
                d.marketRegistry,
                d.oracleRouter,
                d.vault,
                d.feeManager,
                d.riskManager,
                d.optionPositionManager,
                d.optionMarket,
                settlementToken
            )
        );

        d.insuranceFund = address(new InsuranceFund(admin, d.vault, settlementToken));
        d.crossMargin = address(
            new CrossMarginManager(
                admin,
                d.oracleRouter,
                d.riskManager,
                d.vault,
                d.perpPositionManager,
                d.optionPositionManager,
                d.optionMarket,
                settlementToken,
                d.insuranceFund
            )
        );
        d.subaccountFactory = address(new SubaccountFactory(admin, d.vault));

        d.perpsEngine = address(
            new PerpsEngine(
                d.marketRegistry,
                d.oracleRouter,
                d.vault,
                d.feeManager,
                d.riskManager,
                d.perpPositionManager,
                d.perpOrderManager,
                d.fundingManager,
                settlementToken,
                d.crossMargin
            )
        );

        d.liquidationEngine = address(
            new LiquidationEngine(
                d.oracleRouter,
                d.vault,
                d.feeManager,
                d.riskManager,
                d.perpPositionManager,
                d.fundingManager,
                settlementToken,
                d.crossMargin,
                d.insuranceFund
            )
        );

        // RFQ and block trades: the engine only opens at a quoted price for this manager. The maker
        // role goes to the market maker's signing address (default: the deployer, for local runs).
        d.rfqManager = address(new RFQManager(admin, d.perpsEngine, d.oracleRouter));
        PerpsEngine(d.perpsEngine).setRfqManager(d.rfqManager);
        RFQManager rfq = RFQManager(d.rfqManager);
        rfq.grantRole(rfq.MAKER_ROLE(), vm.envOr("MAKER_ADDRESS", admin));

        _wireRoles(d);

        // The quoter signs option premiums (see IOptionsEngine.Quote), so it is a critical key:
        // set QUOTER_ADDRESS to the pricing service's signing address, and move the role behind a
        // multisig before mainnet. Defaults to the deployer for local runs.
        address quoter = vm.envOr("QUOTER_ADDRESS", admin);
        OptionsEngine optionsEngine = OptionsEngine(d.optionsEngine);
        optionsEngine.grantRole(optionsEngine.QUOTER_ROLE(), quoter);
        console.log("Option quoter:         ", quoter);

        vm.stopBroadcast();

        _writeDeploymentFile(d);
        _logSummary(d);
    }

    function _wireRoles(Deployment memory d) internal {
        _wireVaultAndCollateral(d);
        _wireFeesAndRisk(d);
        _wirePositionManagers(d);
        _wireFundingAndOracle(d);
    }

    function _wireVaultAndCollateral(Deployment memory d) internal {
        CollateralManager cm = CollateralManager(d.collateralManager);
        OrionisVault vault = OrionisVault(d.vault);

        cm.grantRole(cm.VAULT_ROLE(), d.vault);
        cm.addSupportedToken(d.settlementToken);

        bytes32 vaultEngineRole = vault.ENGINE_ROLE();
        vault.grantRole(vaultEngineRole, d.optionsEngine);
        vault.grantRole(vaultEngineRole, d.perpsEngine);
        vault.grantRole(vaultEngineRole, d.liquidationEngine);
        vault.grantRole(vaultEngineRole, d.fundingManager);
        vault.grantRole(vault.FEE_MANAGER_ROLE(), d.feeManager);

        // Account-level margin: the cross-margin manager seizes collateral through the Vault, and
        // the Vault asks it before every withdrawal.
        vault.grantRole(vaultEngineRole, d.crossMargin);
        vault.setWithdrawGuard(d.crossMargin);
        CrossMarginManager cross = CrossMarginManager(d.crossMargin);
        cross.grantRole(cross.ENGINE_ROLE(), d.perpsEngine);
        cross.grantRole(cross.LIQUIDATOR_ROLE(), d.liquidationEngine);

        // A subaccount may call the trading engines, never the Vault or a token.
        SubaccountFactory factory = SubaccountFactory(d.subaccountFactory);
        factory.setTargetAllowed(d.perpsEngine, true);
        factory.setTargetAllowed(d.optionsEngine, true);
    }

    function _wireFeesAndRisk(Deployment memory d) internal {
        FeeManager feeManager = FeeManager(d.feeManager);
        BuybackModule buyback = BuybackModule(d.buybackModule);
        RiskManager riskManager = RiskManager(d.riskManager);

        bytes32 feeEngineRole = feeManager.ENGINE_ROLE();
        feeManager.grantRole(feeEngineRole, d.optionsEngine);
        feeManager.grantRole(feeEngineRole, d.perpsEngine);
        feeManager.grantRole(feeEngineRole, d.liquidationEngine);
        buyback.grantRole(buyback.FEE_MANAGER_ROLE(), d.feeManager);

        bytes32 riskEngineRole = riskManager.ENGINE_ROLE();
        riskManager.grantRole(riskEngineRole, d.optionsEngine);
        riskManager.grantRole(riskEngineRole, d.perpsEngine);
        riskManager.grantRole(riskEngineRole, d.liquidationEngine);
    }

    function _wirePositionManagers(Deployment memory d) internal {
        OptionPositionManager opm = OptionPositionManager(d.optionPositionManager);
        OptionMarket om = OptionMarket(d.optionMarket);
        PerpPositionManager ppm = PerpPositionManager(d.perpPositionManager);
        PerpOrderManager pom = PerpOrderManager(d.perpOrderManager);

        opm.grantRole(opm.ENGINE_ROLE(), d.optionsEngine);
        om.grantRole(om.ENGINE_ROLE(), d.optionsEngine);

        bytes32 perpEngineRole = ppm.ENGINE_ROLE();
        ppm.grantRole(perpEngineRole, d.perpsEngine);
        ppm.grantRole(perpEngineRole, d.fundingManager);
        ppm.grantRole(perpEngineRole, d.liquidationEngine);
        pom.grantRole(pom.ENGINE_ROLE(), d.perpsEngine);
    }

    function _wireFundingAndOracle(Deployment memory d) internal {
        FundingManager fundingManager = FundingManager(d.fundingManager);
        OracleRouter oracleRouter = OracleRouter(d.oracleRouter);

        bytes32 fundingEngineRole = fundingManager.ENGINE_ROLE();
        fundingManager.grantRole(fundingEngineRole, d.perpsEngine);
        fundingManager.grantRole(fundingEngineRole, d.liquidationEngine);

        bytes32 oracleEngineRole = oracleRouter.ENGINE_ROLE();
        oracleRouter.grantRole(oracleEngineRole, d.perpsEngine);
        oracleRouter.grantRole(oracleEngineRole, d.liquidationEngine);
    }

    function _writeDeploymentFile(Deployment memory d) internal {
        string memory json = "deployment";
        vm.serializeAddress(json, "marketRegistry", d.marketRegistry);
        vm.serializeAddress(json, "collateralManager", d.collateralManager);
        vm.serializeAddress(json, "vault", d.vault);
        vm.serializeAddress(json, "feeManager", d.feeManager);
        vm.serializeAddress(json, "buybackModule", d.buybackModule);
        vm.serializeAddress(json, "priceValidator", d.priceValidator);
        vm.serializeAddress(json, "oracleRouter", d.oracleRouter);
        vm.serializeAddress(json, "riskManager", d.riskManager);
        vm.serializeAddress(json, "optionPositionManager", d.optionPositionManager);
        vm.serializeAddress(json, "optionMarket", d.optionMarket);
        vm.serializeAddress(json, "optionsEngine", d.optionsEngine);
        vm.serializeAddress(json, "perpPositionManager", d.perpPositionManager);
        vm.serializeAddress(json, "perpOrderManager", d.perpOrderManager);
        vm.serializeAddress(json, "fundingManager", d.fundingManager);
        vm.serializeAddress(json, "perpsEngine", d.perpsEngine);
        vm.serializeAddress(json, "liquidationEngine", d.liquidationEngine);
        vm.serializeAddress(json, "insuranceFund", d.insuranceFund);
        vm.serializeAddress(json, "crossMargin", d.crossMargin);
        vm.serializeAddress(json, "subaccountFactory", d.subaccountFactory);
        vm.serializeAddress(json, "rfqManager", d.rfqManager);
        string memory finalJson = vm.serializeAddress(json, "settlementToken", d.settlementToken);

        string memory network = vm.envOr("NETWORK_NAME", string("localhost"));
        string memory path = string.concat("deployments/", network, ".json");
        vm.writeJson(finalJson, path);
    }

    function _logSummary(Deployment memory d) internal pure {
        console.log("MarketRegistry:        ", d.marketRegistry);
        console.log("CollateralManager:     ", d.collateralManager);
        console.log("OrionisVault:          ", d.vault);
        console.log("FeeManager:            ", d.feeManager);
        console.log("BuybackModule:         ", d.buybackModule);
        console.log("PriceValidator:        ", d.priceValidator);
        console.log("OracleRouter:          ", d.oracleRouter);
        console.log("RiskManager:           ", d.riskManager);
        console.log("OptionPositionManager: ", d.optionPositionManager);
        console.log("OptionMarket:          ", d.optionMarket);
        console.log("OptionsEngine:         ", d.optionsEngine);
        console.log("PerpPositionManager:   ", d.perpPositionManager);
        console.log("PerpOrderManager:      ", d.perpOrderManager);
        console.log("FundingManager:        ", d.fundingManager);
        console.log("PerpsEngine:           ", d.perpsEngine);
        console.log("LiquidationEngine:     ", d.liquidationEngine);
        console.log("InsuranceFund:         ", d.insuranceFund);
        console.log("CrossMarginManager:    ", d.crossMargin);
        console.log("SubaccountFactory:     ", d.subaccountFactory);
        console.log("RFQManager:            ", d.rfqManager);
    }
}
