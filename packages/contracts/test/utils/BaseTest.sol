// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {MarketRegistry} from "../../src/core/MarketRegistry.sol";
import {CollateralManager} from "../../src/core/CollateralManager.sol";
import {OrionisVault} from "../../src/core/OrionisVault.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";
import {BuybackModule} from "../../src/core/BuybackModule.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";
import {OracleRouter} from "../../src/oracle/OracleRouter.sol";
import {MockPriceFeed} from "../../src/oracle/MockPriceFeed.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";
import {OptionPositionManager} from "../../src/options/OptionPositionManager.sol";
import {OptionMarket} from "../../src/options/OptionMarket.sol";
import {OptionsEngine} from "../../src/options/OptionsEngine.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {FundingManager} from "../../src/perps/FundingManager.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";
import {MarketConfig} from "../../src/interfaces/DataTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Deploys the full Orionis Markets Phase 1 contract stack, wires every
/// AccessControl role, seeds one market ("NVDA"), and funds two test users with deposited
/// collateral — shared setup for unit, fuzz, and integration tests.
contract BaseTest is Test {
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    bytes32 internal constant NVDA = bytes32("NVDA");
    uint256 internal constant WAD = 1e18;

    MockERC20 internal usdc;
    MockPriceFeed internal priceFeed;

    MarketRegistry internal marketRegistry;
    CollateralManager internal collateralManager;
    OrionisVault internal vault;
    FeeManager internal feeManager;
    BuybackModule internal buybackModule;
    PriceValidator internal priceValidator;
    OracleRouter internal oracleRouter;
    RiskManager internal riskManager;
    OptionPositionManager internal optionPositionManager;
    OptionMarket internal optionMarket;
    OptionsEngine internal optionsEngine;
    PerpPositionManager internal perpPositionManager;
    FundingManager internal fundingManager;
    PerpsEngine internal perpsEngine;
    LiquidationEngine internal liquidationEngine;

    function setUp() public virtual {
        vm.startPrank(admin);

        usdc = new MockERC20("USD Coin", "USDC", 18);
        priceFeed = new MockPriceFeed(admin, 18, 190e18);

        marketRegistry = new MarketRegistry(admin);
        collateralManager = new CollateralManager(admin);
        vault = new OrionisVault(admin, address(collateralManager));
        feeManager = new FeeManager(admin, address(vault));
        buybackModule = new BuybackModule(admin);
        priceValidator = new PriceValidator(admin);
        oracleRouter = new OracleRouter(admin, address(priceValidator));
        riskManager = new RiskManager(admin);
        optionPositionManager = new OptionPositionManager(admin);
        optionMarket = new OptionMarket(admin);
        perpPositionManager = new PerpPositionManager(admin);
        fundingManager = new FundingManager(
            admin, address(oracleRouter), address(perpPositionManager), address(vault), address(usdc)
        );

        optionsEngine = new OptionsEngine(
            address(marketRegistry),
            address(oracleRouter),
            address(vault),
            address(feeManager),
            address(riskManager),
            address(optionPositionManager),
            address(optionMarket),
            address(usdc)
        );

        perpsEngine = new PerpsEngine(
            address(marketRegistry),
            address(oracleRouter),
            address(vault),
            address(feeManager),
            address(riskManager),
            address(perpPositionManager),
            address(fundingManager),
            address(usdc)
        );

        liquidationEngine = new LiquidationEngine(
            address(oracleRouter),
            address(vault),
            address(feeManager),
            address(riskManager),
            address(perpPositionManager),
            address(fundingManager),
            address(usdc)
        );

        _wireRoles();
        _seedMarket();

        vm.stopPrank();

        _fundUser(alice);
        _fundUser(bob);
    }

    function _wireRoles() internal {
        collateralManager.grantRole(collateralManager.VAULT_ROLE(), address(vault));

        bytes32 vaultEngineRole = vault.ENGINE_ROLE();
        vault.grantRole(vaultEngineRole, address(optionsEngine));
        vault.grantRole(vaultEngineRole, address(perpsEngine));
        vault.grantRole(vaultEngineRole, address(liquidationEngine));
        vault.grantRole(vaultEngineRole, address(fundingManager));
        vault.grantRole(vault.FEE_MANAGER_ROLE(), address(feeManager));

        bytes32 feeEngineRole = feeManager.ENGINE_ROLE();
        feeManager.grantRole(feeEngineRole, address(optionsEngine));
        feeManager.grantRole(feeEngineRole, address(perpsEngine));
        feeManager.grantRole(feeEngineRole, address(liquidationEngine));

        bytes32 riskEngineRole = riskManager.ENGINE_ROLE();
        riskManager.grantRole(riskEngineRole, address(optionsEngine));
        riskManager.grantRole(riskEngineRole, address(perpsEngine));
        riskManager.grantRole(riskEngineRole, address(liquidationEngine));

        optionPositionManager.grantRole(optionPositionManager.ENGINE_ROLE(), address(optionsEngine));
        optionMarket.grantRole(optionMarket.ENGINE_ROLE(), address(optionsEngine));

        bytes32 perpEngineRole = perpPositionManager.ENGINE_ROLE();
        perpPositionManager.grantRole(perpEngineRole, address(perpsEngine));
        perpPositionManager.grantRole(perpEngineRole, address(fundingManager));
        perpPositionManager.grantRole(perpEngineRole, address(liquidationEngine));

        bytes32 fundingEngineRole = fundingManager.ENGINE_ROLE();
        fundingManager.grantRole(fundingEngineRole, address(perpsEngine));
        fundingManager.grantRole(fundingEngineRole, address(liquidationEngine));

        bytes32 oracleEngineRole = oracleRouter.ENGINE_ROLE();
        oracleRouter.grantRole(oracleEngineRole, address(perpsEngine));
        oracleRouter.grantRole(oracleEngineRole, address(liquidationEngine));

        buybackModule.grantRole(buybackModule.FEE_MANAGER_ROLE(), address(feeManager));

        collateralManager.addSupportedToken(address(usdc));
        oracleRouter.setPrimarySource(NVDA, address(priceFeed), 18);
    }

    function _seedMarket() internal {
        marketRegistry.addMarket(
            MarketConfig({
                marketId: NVDA,
                underlyingToken: address(0xBEEF),
                oracleId: NVDA,
                optionsEnabled: true,
                perpsEnabled: true,
                maxLeverage: 10,
                openInterestCap: 5_000_000e18,
                active: true
            })
        );

        uint256[] memory tiers = new uint256[](5);
        tiers[0] = 1;
        tiers[1] = 2;
        tiers[2] = 3;
        tiers[3] = 5;
        tiers[4] = 10;

        riskManager.setRiskConfig(
            NVDA,
            RiskManager.RiskConfig({
                maxLeverage: 10,
                allowedLeverageTiers: tiers,
                initialMarginRateBps: 1000,
                maintenanceMarginRateBps: 500,
                maxPositionNotional: 500_000e18,
                openInterestCap: 5_000_000e18
            })
        );
    }

    function _fundUser(address user) internal {
        usdc.mint(user, 1_000_000e18);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(usdc), 100_000e18);
        vm.stopPrank();
    }

    function _setPrice(uint256 price) internal {
        vm.prank(admin);
        priceFeed.setPrice(price);
    }
}
