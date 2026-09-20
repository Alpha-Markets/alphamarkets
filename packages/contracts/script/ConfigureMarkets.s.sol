// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {MarketRegistry} from "../src/core/MarketRegistry.sol";
import {RiskManager} from "../src/risk/RiskManager.sol";
import {FeeManager} from "../src/core/FeeManager.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {MockPriceFeed} from "../src/oracle/MockPriceFeed.sol";
import {MarketConfig, FeeConfig} from "../src/interfaces/DataTypes.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice Seeds one market (NVDA) on an already-deployed Phase 1 stack, reading contract
/// addresses from `deployments/<NETWORK_NAME>.json` (written by `DeployAll.s.sol`).
/// PROJECT_BRIEF.md doesn't list this as its own numbered step — it's implied by Section
/// 38 Priority 0 and DEVELOPMENT_STEPS.md step 15 ("deploy to testnet"), since nothing is
/// tradeable until at least one market exists in MarketRegistry.
///
/// Deploys a mock tokenized-NVDA ERC20 (standing in for a real tokenized equity, which
/// doesn't exist on this testnet yet) and a MockPriceFeed seeded at $190, since Robinhood
/// Chain has no live NVDA/USD oracle feed to point to.
///
/// Risk config numbers match PROJECT_BRIEF.md Section 13/19's NVDA example exactly:
/// max leverage 10x, initial margin 10%, maintenance margin 5%, max position $500K,
/// open interest cap $5M. Fee numbers are NOT specified anywhere in the brief — the values
/// below are conservative placeholders, not a product decision; tell me a real fee schedule
/// once product decides one and I'll update `setFeeConfig` accordingly.
///
/// Usage:
///   source .env
///   forge script script/ConfigureMarkets.s.sol --rpc-url $ROBINHOOD_TESTNET_RPC_URL --broadcast
contract ConfigureMarkets is Script {
    bytes32 internal constant NVDA = bytes32("NVDA");
    uint256 internal constant NVDA_INITIAL_PRICE = 190e18;

    function run() external {
        string memory network = vm.envOr("NETWORK_NAME", string("localhost"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));

        address marketRegistry = vm.parseJsonAddress(json, ".marketRegistry");
        address riskManager = vm.parseJsonAddress(json, ".riskManager");
        address feeManager = vm.parseJsonAddress(json, ".feeManager");
        address oracleRouter = vm.parseJsonAddress(json, ".oracleRouter");
        // Position and open-interest limits are in settlement-token base units, the unit perp and
        // option notional are both counted in, so the dollar figures below scale with its decimals.
        uint256 dollar = 10 ** IERC20Metadata(vm.parseJsonAddress(json, ".settlementToken")).decimals();

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address admin = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);

        if (deployerKey == 0) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        address underlyingToken = address(new MockERC20("NVIDIA (tokenized, mock)", "NVDA", 18));
        // The mock feed's owner pushes prices. Set PRICE_FEED_OWNER to the keeper's address
        // (services/keeper) so the deployer key never has to run a service; defaults to the deployer.
        address feedOwner = vm.envOr("PRICE_FEED_OWNER", admin);
        address priceFeed = address(new MockPriceFeed(feedOwner, 18, NVDA_INITIAL_PRICE));

        OracleRouter(oracleRouter).setPrimarySource(NVDA, priceFeed, 18);

        MarketRegistry(marketRegistry)
            .addMarket(
                MarketConfig({
                    marketId: NVDA,
                    underlyingToken: underlyingToken,
                    oracleId: NVDA,
                    optionsEnabled: true,
                    perpsEnabled: true,
                    maxLeverage: 10,
                    openInterestCap: 5_000_000 * dollar,
                    active: true
                })
            );

        uint256[] memory tiers = new uint256[](5);
        tiers[0] = 1;
        tiers[1] = 2;
        tiers[2] = 3;
        tiers[3] = 5;
        tiers[4] = 10;

        RiskManager(riskManager)
            .setRiskConfig(
                NVDA,
                RiskManager.RiskConfig({
                    maxLeverage: 10,
                    allowedLeverageTiers: tiers,
                    initialMarginRateBps: 1000, // 10%, PROJECT_BRIEF.md Section 13 example
                    maintenanceMarginRateBps: 500, // 5%, PROJECT_BRIEF.md Section 13/19 example
                    maxPositionNotional: 500_000 * dollar, // $500K, Section 13/19 example
                    openInterestCap: 5_000_000 * dollar // $5M, Section 13/19 example
                })
            );

        // Placeholder fee schedule — not specified in PROJECT_BRIEF.md, confirm with product.
        FeeManager(feeManager)
            .setFeeConfig(
                NVDA,
                FeeConfig({
                    makerFee: 5, // 0.05%
                    takerFee: 10, // 0.10%
                    optionOpenFee: 20, // 0.20%
                    optionCloseFee: 20, // 0.20%
                    settlementFee: 10, // 0.10%
                    liquidationFee: 100 // 1.00%
                })
            );

        vm.stopBroadcast();

        console.log("NVDA underlying token: ", underlyingToken);
        console.log("NVDA price feed:       ", priceFeed);
        console.log("Market NVDA seeded on MarketRegistry, RiskManager, FeeManager, OracleRouter.");
    }
}
