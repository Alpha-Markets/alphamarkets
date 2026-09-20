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

/// @notice Adds one more market to a deployed stack from environment variables, so a new equity is
/// configuration and not a redeploy (PROJECT_BRIEF.md Section 5: "new markets must be addable
/// through configuration"). Like `ConfigureMarkets.s.sol` it deploys a mock tokenized equity and a
/// mock price feed, because this testnet has neither a tokenized equity nor a live oracle for it.
/// A real deployment replaces both with real addresses.
///
/// Required: SYMBOL (e.g. TSLA, at most 32 bytes), NAME (token name), PRICE (whole dollars),
/// MAX_LEVERAGE (whole number, at most 10), MAINTENANCE_MARGIN_BPS, MAX_POSITION (whole dollars),
/// OPEN_INTEREST_CAP (whole dollars). Optional: PRICE_FEED_OWNER (the keeper's address, so the
/// keeper keeps the feed fresh; defaults to the deployer), NETWORK_NAME, PRIVATE_KEY.
///
/// Initial margin is set to 1 / MAX_LEVERAGE, the loosest value at which the maximum leverage is
/// still allowed. The leverage tiers are the brief's 1x, 2x, 3x, 5x, 10x up to MAX_LEVERAGE. Fees
/// are the same placeholders as `ConfigureMarkets.s.sol`; the product owner still has to set them.
///
/// Usage:
///   SYMBOL=TSLA NAME="Tesla (tokenized, mock)" PRICE=350 MAX_LEVERAGE=5 MAINTENANCE_MARGIN_BPS=750 \
///   MAX_POSITION=250000 OPEN_INTEREST_CAP=3000000 \
///   forge script script/AddMarket.s.sol --rpc-url $ROBINHOOD_TESTNET_RPC_URL --broadcast
contract AddMarket is Script {
    struct Params {
        string symbol;
        bytes32 marketId;
        string name;
        uint256 price;
        uint256 maxLeverage;
        uint256 initialBps;
        uint256 maintenanceBps;
        uint256 maxPosition;
        uint256 openInterestCap;
        address feedOwner;
    }

    struct Stack {
        MarketRegistry marketRegistry;
        RiskManager riskManager;
        FeeManager feeManager;
        OracleRouter oracleRouter;
    }

    function run() external {
        string memory json =
            vm.readFile(string.concat("deployments/", vm.envOr("NETWORK_NAME", string("localhost")), ".json"));
        Stack memory stack = Stack({
            marketRegistry: MarketRegistry(vm.parseJsonAddress(json, ".marketRegistry")),
            riskManager: RiskManager(vm.parseJsonAddress(json, ".riskManager")),
            feeManager: FeeManager(vm.parseJsonAddress(json, ".feeManager")),
            oracleRouter: OracleRouter(vm.parseJsonAddress(json, ".oracleRouter"))
        });
        uint256 dollar = 10 ** IERC20Metadata(vm.parseJsonAddress(json, ".settlementToken")).decimals();

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        Params memory p = _readParams(dollar, deployerKey == 0 ? msg.sender : vm.addr(deployerKey));

        if (deployerKey == 0) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);
        (address token, address feed) = _register(stack, p);
        _configure(stack, p);
        vm.stopBroadcast();

        console.log(p.symbol, "underlying token:", token);
        console.log(p.symbol, "price feed:      ", feed);
    }

    function _readParams(uint256 dollar, address admin) internal view returns (Params memory p) {
        p.symbol = vm.envString("SYMBOL");
        require(bytes(p.symbol).length > 0 && bytes(p.symbol).length <= 32, "SYMBOL must be 1 to 32 bytes");
        p.marketId = bytes32(bytes(p.symbol));
        p.name = vm.envString("NAME");
        p.price = vm.envUint("PRICE") * 1e18;
        p.maxLeverage = vm.envUint("MAX_LEVERAGE");
        require(p.maxLeverage >= 1 && p.maxLeverage <= 10, "MAX_LEVERAGE must be 1 to 10");
        p.initialBps = 10_000 / p.maxLeverage;
        p.maintenanceBps = vm.envUint("MAINTENANCE_MARGIN_BPS");
        require(p.maintenanceBps < p.initialBps, "maintenance margin must be below initial margin");
        p.maxPosition = vm.envUint("MAX_POSITION") * dollar;
        p.openInterestCap = vm.envUint("OPEN_INTEREST_CAP") * dollar;
        p.feedOwner = vm.envOr("PRICE_FEED_OWNER", admin);
    }

    /// Deploys the mock token and feed, points the oracle at the feed and lists the market.
    function _register(Stack memory stack, Params memory p) internal returns (address token, address feed) {
        token = address(new MockERC20(p.name, p.symbol, 18));
        feed = address(new MockPriceFeed(p.feedOwner, 18, p.price));
        stack.oracleRouter.setPrimarySource(p.marketId, feed, 18);
        stack.marketRegistry
            .addMarket(
                MarketConfig({
                    marketId: p.marketId,
                    underlyingToken: token,
                    oracleId: p.marketId,
                    optionsEnabled: true,
                    perpsEnabled: true,
                    maxLeverage: p.maxLeverage,
                    openInterestCap: p.openInterestCap,
                    active: true
                })
            );
    }

    function _configure(Stack memory stack, Params memory p) internal {
        uint256[5] memory allTiers = [uint256(1), 2, 3, 5, 10];
        uint256 count;
        for (uint256 i; i < allTiers.length; i++) {
            if (allTiers[i] <= p.maxLeverage) count++;
        }
        uint256[] memory tiers = new uint256[](count);
        for (uint256 i; i < count; i++) {
            tiers[i] = allTiers[i];
        }

        stack.riskManager
            .setRiskConfig(
                p.marketId,
                RiskManager.RiskConfig({
                    maxLeverage: p.maxLeverage,
                    allowedLeverageTiers: tiers,
                    initialMarginRateBps: p.initialBps,
                    maintenanceMarginRateBps: p.maintenanceBps,
                    maxPositionNotional: p.maxPosition,
                    openInterestCap: p.openInterestCap
                })
            );

        stack.feeManager
            .setFeeConfig(
                p.marketId,
                FeeConfig({
                    makerFee: 5, // 0.05%
                    takerFee: 10, // 0.10%
                    optionOpenFee: 20, // 0.20%
                    optionCloseFee: 20, // 0.20%
                    settlementFee: 10, // 0.10%
                    liquidationFee: 100 // 1.00%
                })
            );
    }
}
