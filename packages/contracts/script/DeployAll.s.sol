// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console} from "forge-std/console.sol";

import {StackScript} from "./utils/StackScript.sol";

import {MarketRegistry} from "../src/core/MarketRegistry.sol";
import {CollateralManager} from "../src/core/CollateralManager.sol";
import {AlphaMarketsVault} from "../src/core/AlphaMarketsVault.sol";
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

/// @notice Deploys the full Phase 1 contract stack behind ERC-1967 proxies, in dependency order, wires
/// every AccessControl role, and writes the proxy addresses to `deployments/<network>.json` and the
/// implementation addresses to `deployments/<network>.implementations.json`. Reads the deployer key
/// from `PRIVATE_KEY` and the settlement collateral token from `COLLATERAL_TOKEN` env vars.
///
/// The proxy addresses are the ones every client uses, and they never change. This script is for the
/// first deployment (or a deliberate fresh start). To ship a contract change without changing an
/// address or losing state, run `UpgradeAll.s.sol` instead.
///
/// Usage (testnet, once chain ID/RPC/deployer key are available):
///   forge script script/DeployAll.s.sol --rpc-url robinhood_testnet --broadcast --verify
///
/// Usage (local dry run against Anvil, no env vars needed beyond Anvil's default key):
///   anvil &
///   forge script script/DeployAll.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract DeployAll is StackScript {
    function run() external returns (Stack memory d) {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address admin = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);
        address settlementToken = vm.envOr("COLLATERAL_TOKEN", address(0));
        require(settlementToken != address(0), "COLLATERAL_TOKEN env var not set");

        if (deployerKey == 0) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        Impls memory impls;
        (d, impls) = _deployStack(admin, settlementToken);

        // RFQ and block trades: the engine only opens at a quoted price for this manager. The maker
        // role goes to the market maker's signing address (default: the deployer, for local runs).
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
        _writeImplementationsFile(impls, _network("localhost"));
        _logSummary(d);
    }

    function _wireRoles(Stack memory d) internal {
        _wireVaultAndCollateral(d);
        _wireFeesAndRisk(d);
        _wirePositionManagers(d);
        _wireFundingAndOracle(d);
    }

    function _wireVaultAndCollateral(Stack memory d) internal {
        CollateralManager cm = CollateralManager(d.collateralManager);
        AlphaMarketsVault vault = AlphaMarketsVault(d.vault);

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

    function _wireFeesAndRisk(Stack memory d) internal {
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

    function _wirePositionManagers(Stack memory d) internal {
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

    function _wireFundingAndOracle(Stack memory d) internal {
        FundingManager fundingManager = FundingManager(d.fundingManager);
        OracleRouter oracleRouter = OracleRouter(d.oracleRouter);

        bytes32 fundingEngineRole = fundingManager.ENGINE_ROLE();
        fundingManager.grantRole(fundingEngineRole, d.perpsEngine);
        fundingManager.grantRole(fundingEngineRole, d.liquidationEngine);

        bytes32 oracleEngineRole = oracleRouter.ENGINE_ROLE();
        oracleRouter.grantRole(oracleEngineRole, d.perpsEngine);
        oracleRouter.grantRole(oracleEngineRole, d.liquidationEngine);
    }

    function _writeDeploymentFile(Stack memory d) internal {
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

    function _logSummary(Stack memory d) internal pure {
        console.log("MarketRegistry:        ", d.marketRegistry);
        console.log("CollateralManager:     ", d.collateralManager);
        console.log("AlphaMarketsVault:          ", d.vault);
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
