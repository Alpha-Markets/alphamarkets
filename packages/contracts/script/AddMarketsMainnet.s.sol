// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {MarketLister} from "./utils/MarketLister.sol";
import {MarketRegistry} from "../src/core/MarketRegistry.sol";
import {RiskManager} from "../src/risk/RiskManager.sol";
import {FeeManager} from "../src/core/FeeManager.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {PriceValidator} from "../src/oracle/PriceValidator.sol";
import {MarketConfig} from "../src/interfaces/DataTypes.sol";

/// @notice Lists every market in `deployments/<network>.markets.json` on the deployed mainnet stack, each
/// on the real Robinhood stock token and its real Chainlink feed (through `ChainlinkPriceFeed`). Unlike
/// `AddMarket.s.sol` it deploys no mock token and no mock feed. It skips a market that is already listed,
/// so it is safe to run again after a failure.
///
/// There are no defaults for the numbers that are a product and risk decision (docs/MAINNET_READINESS.md
/// item 9), so the script stops until they are set:
///   MAX_POSITION        largest position per market, whole settlement tokens (USDG)
///   OPEN_INTEREST_CAP   open interest cap per market, whole settlement tokens
///   MAX_PRICE_AGE_HOURS how old a Chainlink price may be before the market stops. The stock feeds have a
///                       24 hour heartbeat and update only while the market trades: a small value halts
///                       trading whenever the feed is quiet, a large one trades on an old price.
/// Optional: NETWORK_NAME (default `robinhood_mainnet`). Signs with the forge `--account` keystore.
///
/// Leverage and maintenance margin come from each market's row in the list (10x SPY and QQQ, 3x for the
/// most volatile names, 5x for the rest). Run this before `SetNetOpenInterest`, `FundPool` and `HandOverAdmin`.
///
/// Usage (dry run first; add --broadcast to send):
///   MAX_POSITION=5000 OPEN_INTEREST_CAP=50000 MAX_PRICE_AGE_HOURS=25 \
///   forge script script/AddMarketsMainnet.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --account alphamarkets-mainnet --sender <deployer> [--broadcast --slow]
contract AddMarketsMainnet is Script, MarketLister {
    function run() external {
        string memory network = vm.envOr("NETWORK_NAME", string("robinhood_mainnet"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));
        string memory list = vm.readFile(string.concat("deployments/", network, ".markets.json"));

        Stack memory stack = Stack({
            marketRegistry: MarketRegistry(vm.parseJsonAddress(json, ".marketRegistry")),
            riskManager: RiskManager(vm.parseJsonAddress(json, ".riskManager")),
            feeManager: FeeManager(vm.parseJsonAddress(json, ".feeManager")),
            oracleRouter: OracleRouter(vm.parseJsonAddress(json, ".oracleRouter")),
            priceValidator: PriceValidator(vm.parseJsonAddress(json, ".priceValidator"))
        });
        Limits memory limits = _readLimits(vm.parseJsonAddress(json, ".settlementToken"));

        uint256 count = abi.decode(vm.parseJson(list, ".markets[*].symbol"), (string[])).length;
        vm.startBroadcast();
        for (uint256 i; i < count; i++) {
            _listOne(stack, list, i, limits);
        }
        vm.stopBroadcast();
    }

    struct Limits {
        uint256 maxPosition;
        uint256 openInterestCap;
        uint256 maxPriceAge;
    }

    function _readLimits(address settlementToken) internal view returns (Limits memory limits) {
        uint256 unit = 10 ** IERC20Metadata(settlementToken).decimals();
        limits.maxPosition = vm.envUint("MAX_POSITION") * unit;
        limits.openInterestCap = vm.envUint("OPEN_INTEREST_CAP") * unit;
        limits.maxPriceAge = vm.envUint("MAX_PRICE_AGE_HOURS") * 1 hours;
        require(
            limits.maxPosition > 0 && limits.openInterestCap >= limits.maxPosition,
            "OPEN_INTEREST_CAP must be at least MAX_POSITION"
        );
        require(limits.maxPriceAge >= 1 hours && limits.maxPriceAge <= 72 hours, "MAX_PRICE_AGE_HOURS must be 1 to 72");
    }

    function _listOne(Stack memory stack, string memory list, uint256 i, Limits memory limits) internal {
        string memory p = string.concat(".markets[", vm.toString(i), "]");
        string memory symbol = vm.parseJsonString(list, string.concat(p, ".symbol"));
        bytes32 id = bytes32(bytes(symbol));
        try stack.marketRegistry.getMarket(id) returns (MarketConfig memory) {
            console.log("skip", symbol, "already listed");
            return;
        } catch {}

        address adapter = _list(
            stack,
            Listing({
                marketId: id,
                underlyingToken: vm.parseJsonAddress(list, string.concat(p, ".token")),
                chainlinkFeed: vm.parseJsonAddress(list, string.concat(p, ".feed")),
                maxLeverage: vm.parseJsonUint(list, string.concat(p, ".maxLeverage")),
                maintenanceBps: vm.parseJsonUint(list, string.concat(p, ".maintenanceBps")),
                maxPosition: limits.maxPosition,
                openInterestCap: limits.openInterestCap,
                maxPriceAge: limits.maxPriceAge
            })
        );
        console.log(symbol, "listed, price adapter:", adapter);
    }
}
