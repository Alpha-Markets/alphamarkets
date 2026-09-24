// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {MarketRegistry} from "../src/core/MarketRegistry.sol";
import {RiskManager} from "../src/risk/RiskManager.sol";
import {FeeManager} from "../src/core/FeeManager.sol";
import {OracleRouter} from "../src/oracle/OracleRouter.sol";
import {PriceValidator} from "../src/oracle/PriceValidator.sol";
import {ChainlinkFeedAdapter, IAggregatorV3} from "../src/oracle/ChainlinkFeedAdapter.sol";
import {MarketConfig, FeeConfig} from "../src/interfaces/DataTypes.sol";

/// @notice Lists one market on a real chain: the real stock token, a real Chainlink feed behind
/// `ChainlinkFeedAdapter`, and risk, fee and price-age settings that you choose. Unlike `AddMarket.s.sol` it deploys
/// no mock token and no mock feed, and it has no default for any number that carries money: every limit and every
/// fee is a required environment variable, so nothing is listed with a placeholder.
///
/// Required: SYMBOL (at most 32 bytes), TOKEN (the stock token), FEED (the Chainlink proxy),
/// MAX_PRICE_AGE (seconds a feed price may be old before reads revert: it must cover the feed's own heartbeat),
/// MAX_LEVERAGE (1 to 10), MAINTENANCE_MARGIN_BPS, MAX_POSITION, OPEN_INTEREST_CAP, MAX_NET_OPEN_INTEREST
/// (whole settlement tokens), and the six fees in basis points: MAKER_FEE_BPS, TAKER_FEE_BPS,
/// OPTION_OPEN_FEE_BPS, OPTION_CLOSE_FEE_BPS, SETTLEMENT_FEE_BPS, LIQUIDATION_FEE_BPS.
/// Optional: NETWORK_NAME (default `robinhood_mainnet`), PRIVATE_KEY (must hold the admin roles).
///
/// It refuses to run if the token's symbol is not SYMBOL, the token does not have 18 decimals, the feed returns no
/// positive price, or the price is older than MAX_PRICE_AGE. Check the token address against the StockFactory's
/// `Deployed` event and the feed against Chainlink's Robinhood page before you run it: those two addresses are the
/// whole trust in a market's price.
contract AddMainnetMarket is Script {
    struct Params {
        string symbol;
        bytes32 marketId;
        address token;
        address feed;
        uint256 maxPriceAge;
        uint256 maxLeverage;
        uint256 maintenanceBps;
        uint256 maxPosition;
        uint256 openInterestCap;
        uint256 maxNetOpenInterest;
        FeeConfig fees;
    }

    function run() external {
        string memory network = vm.envOr("NETWORK_NAME", string("robinhood_mainnet"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));
        MarketRegistry registry = MarketRegistry(vm.parseJsonAddress(json, ".marketRegistry"));
        RiskManager risk = RiskManager(vm.parseJsonAddress(json, ".riskManager"));
        FeeManager feeManager = FeeManager(vm.parseJsonAddress(json, ".feeManager"));
        OracleRouter router = OracleRouter(vm.parseJsonAddress(json, ".oracleRouter"));
        PriceValidator validator = PriceValidator(vm.parseJsonAddress(json, ".priceValidator"));
        uint256 dollar = 10 ** IERC20Metadata(vm.parseJsonAddress(json, ".settlementToken")).decimals();

        Params memory p = _readParams(dollar);
        (uint256 rawPrice, uint8 feedDecimals) = _checkInputs(p);

        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key == 0) vm.startBroadcast();
        else vm.startBroadcast(key);

        ChainlinkFeedAdapter adapter = new ChainlinkFeedAdapter(p.feed);
        router.setPrimarySource(p.marketId, address(adapter), feedDecimals);
        validator.setMaxPriceAge(p.marketId, p.maxPriceAge);
        registry.addMarket(
            MarketConfig({
                marketId: p.marketId,
                underlyingToken: p.token,
                oracleId: p.marketId,
                optionsEnabled: true,
                perpsEnabled: true,
                maxLeverage: p.maxLeverage,
                openInterestCap: p.openInterestCap,
                active: true
            })
        );
        risk.setRiskConfig(
            p.marketId,
            RiskManager.RiskConfig({
                maxLeverage: p.maxLeverage,
                allowedLeverageTiers: _tiers(p.maxLeverage),
                initialMarginRateBps: 10_000 / p.maxLeverage,
                maintenanceMarginRateBps: p.maintenanceBps,
                maxPositionNotional: p.maxPosition,
                openInterestCap: p.openInterestCap
            })
        );
        risk.setMaxNetOpenInterest(p.marketId, p.maxNetOpenInterest);
        feeManager.setFeeConfig(p.marketId, p.fees);
        vm.stopBroadcast();

        console.log(p.symbol, "adapter:", address(adapter));
        console.log(p.symbol, "feed price (feed decimals):", rawPrice);
    }

    function _readParams(uint256 dollar) internal view returns (Params memory p) {
        p.symbol = vm.envString("SYMBOL");
        require(bytes(p.symbol).length > 0 && bytes(p.symbol).length <= 32, "SYMBOL must be 1 to 32 bytes");
        p.marketId = bytes32(bytes(p.symbol));
        p.token = vm.envAddress("TOKEN");
        p.feed = vm.envAddress("FEED");
        p.maxPriceAge = vm.envUint("MAX_PRICE_AGE");
        require(p.maxPriceAge >= 1 minutes && p.maxPriceAge <= 7 days, "MAX_PRICE_AGE must be 1 minute to 7 days");
        p.maxLeverage = vm.envUint("MAX_LEVERAGE");
        require(p.maxLeverage >= 1 && p.maxLeverage <= 10, "MAX_LEVERAGE must be 1 to 10");
        p.maintenanceBps = vm.envUint("MAINTENANCE_MARGIN_BPS");
        require(p.maintenanceBps < 10_000 / p.maxLeverage, "maintenance margin must be below initial margin");
        p.maxPosition = vm.envUint("MAX_POSITION") * dollar;
        p.openInterestCap = vm.envUint("OPEN_INTEREST_CAP") * dollar;
        p.maxNetOpenInterest = vm.envUint("MAX_NET_OPEN_INTEREST") * dollar;
        require(p.maxNetOpenInterest > 0, "MAX_NET_OPEN_INTEREST must be above 0");
        p.fees = FeeConfig({
            makerFee: vm.envUint("MAKER_FEE_BPS"),
            takerFee: vm.envUint("TAKER_FEE_BPS"),
            optionOpenFee: vm.envUint("OPTION_OPEN_FEE_BPS"),
            optionCloseFee: vm.envUint("OPTION_CLOSE_FEE_BPS"),
            settlementFee: vm.envUint("SETTLEMENT_FEE_BPS"),
            liquidationFee: vm.envUint("LIQUIDATION_FEE_BPS")
        });
    }

    function _checkInputs(Params memory p) internal view returns (uint256 rawPrice, uint8 feedDecimals) {
        require(p.token.code.length > 0, "TOKEN has no code");
        require(p.feed.code.length > 0, "FEED has no code");
        require(
            keccak256(bytes(IERC20Metadata(p.token).symbol())) == keccak256(bytes(p.symbol)),
            "TOKEN symbol is not SYMBOL"
        );
        require(IERC20Metadata(p.token).decimals() == 18, "TOKEN must have 18 decimals");

        IAggregatorV3 feed = IAggregatorV3(p.feed);
        feedDecimals = feed.decimals();
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        require(answer > 0, "FEED returns no positive price");
        require(updatedAt != 0 && updatedAt <= block.timestamp, "FEED timestamp is impossible");
        require(block.timestamp - updatedAt <= p.maxPriceAge, "FEED price is older than MAX_PRICE_AGE");
        rawPrice = uint256(answer);
        console.log("feed description:", feed.description());
    }

    function _tiers(uint256 maxLeverage) internal pure returns (uint256[] memory tiers) {
        uint256[5] memory all = [uint256(1), 2, 3, 5, 10];
        uint256 count;
        for (uint256 i; i < all.length; i++) {
            if (all[i] <= maxLeverage) count++;
        }
        tiers = new uint256[](count);
        for (uint256 i; i < count; i++) {
            tiers[i] = all[i];
        }
    }
}
