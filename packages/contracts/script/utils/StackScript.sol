// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";

import {StackDeployer} from "./StackDeployer.sol";

/// @notice Reads and writes the `deployments/` files for the deploy and upgrade scripts.
/// `deployments/<network>.json` holds the proxy addresses (what clients use, and what
/// `packages/config` mirrors); `deployments/<network>.implementations.json` holds the current
/// implementation behind each one, for explorer verification.
abstract contract StackScript is Script, StackDeployer {
    function _network(string memory fallbackName) internal view returns (string memory) {
        return vm.envOr("NETWORK_NAME", fallbackName);
    }

    function _readStack(string memory network) internal view returns (Stack memory s) {
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));
        s.marketRegistry = vm.parseJsonAddress(json, ".marketRegistry");
        s.collateralManager = vm.parseJsonAddress(json, ".collateralManager");
        s.vault = vm.parseJsonAddress(json, ".vault");
        s.feeManager = vm.parseJsonAddress(json, ".feeManager");
        s.buybackModule = vm.parseJsonAddress(json, ".buybackModule");
        s.priceValidator = vm.parseJsonAddress(json, ".priceValidator");
        s.oracleRouter = vm.parseJsonAddress(json, ".oracleRouter");
        s.riskManager = vm.parseJsonAddress(json, ".riskManager");
        s.optionPositionManager = vm.parseJsonAddress(json, ".optionPositionManager");
        s.optionMarket = vm.parseJsonAddress(json, ".optionMarket");
        s.optionsEngine = vm.parseJsonAddress(json, ".optionsEngine");
        s.perpPositionManager = vm.parseJsonAddress(json, ".perpPositionManager");
        s.perpOrderManager = vm.parseJsonAddress(json, ".perpOrderManager");
        s.fundingManager = vm.parseJsonAddress(json, ".fundingManager");
        s.perpsEngine = vm.parseJsonAddress(json, ".perpsEngine");
        s.liquidationEngine = vm.parseJsonAddress(json, ".liquidationEngine");
        s.insuranceFund = vm.parseJsonAddress(json, ".insuranceFund");
        s.crossMargin = vm.parseJsonAddress(json, ".crossMargin");
        s.subaccountFactory = vm.parseJsonAddress(json, ".subaccountFactory");
        s.rfqManager = vm.parseJsonAddress(json, ".rfqManager");
        s.settlementToken = vm.parseJsonAddress(json, ".settlementToken");
    }

    function _writeImplementationsFile(Impls memory i, string memory network) internal {
        string memory json = "implementations";
        vm.serializeAddress(json, "marketRegistry", i.marketRegistry);
        vm.serializeAddress(json, "collateralManager", i.collateralManager);
        vm.serializeAddress(json, "vault", i.vault);
        vm.serializeAddress(json, "feeManager", i.feeManager);
        vm.serializeAddress(json, "buybackModule", i.buybackModule);
        vm.serializeAddress(json, "priceValidator", i.priceValidator);
        vm.serializeAddress(json, "oracleRouter", i.oracleRouter);
        vm.serializeAddress(json, "riskManager", i.riskManager);
        vm.serializeAddress(json, "optionPositionManager", i.optionPositionManager);
        vm.serializeAddress(json, "optionMarket", i.optionMarket);
        vm.serializeAddress(json, "optionsEngine", i.optionsEngine);
        vm.serializeAddress(json, "perpPositionManager", i.perpPositionManager);
        vm.serializeAddress(json, "perpOrderManager", i.perpOrderManager);
        vm.serializeAddress(json, "fundingManager", i.fundingManager);
        vm.serializeAddress(json, "perpsEngine", i.perpsEngine);
        vm.serializeAddress(json, "liquidationEngine", i.liquidationEngine);
        vm.serializeAddress(json, "insuranceFund", i.insuranceFund);
        vm.serializeAddress(json, "crossMargin", i.crossMargin);
        vm.serializeAddress(json, "subaccountFactory", i.subaccountFactory);
        string memory finalJson = vm.serializeAddress(json, "rfqManager", i.rfqManager);
        vm.writeJson(finalJson, string.concat("deployments/", network, ".implementations.json"));
    }
}
