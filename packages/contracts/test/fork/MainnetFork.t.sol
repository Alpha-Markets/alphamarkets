// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {MarketRegistry} from "../../src/core/MarketRegistry.sol";
import {AlphaMarketsVault} from "../../src/core/AlphaMarketsVault.sol";
import {OracleRouter} from "../../src/oracle/OracleRouter.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";
import {ChainlinkPriceFeed} from "../../src/oracle/ChainlinkPriceFeed.sol";
import {IChainlinkAggregator} from "../../src/interfaces/IChainlinkAggregator.sol";
import {MarketConfig} from "../../src/interfaces/DataTypes.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";
import {FeeManager} from "../../src/core/FeeManager.sol";
import {MarketLister} from "../../script/utils/MarketLister.sol";

/// @notice Fork tests against the LIVE Robinhood Chain mainnet (4663): the real USDG token, the real
/// Chainlink stock feeds and the empty stack that `DeployAll` created on 2026-09-25
/// (`deployments/robinhood_mainnet.json`). It changes nothing on the real chain: the fork is local.
///
/// Skipped unless `ROBINHOOD_MAINNET_RPC_URL` is set, so CI (no RPC secret) does not run it:
///   ROBINHOOD_MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-path 'test/fork/MainnetFork*' -vv
///
/// It reads live state (feed prices, the deployed roles), so a failure can mean the chain changed.
contract MainnetForkTest is Test, MarketLister {
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    /// The wallet that ran DeployAll and holds every admin role until the multisig handover.
    address internal constant DEPLOYER = 0xd09D9c87ECfe008B4D6D3cEbeAd25103c16d9a7C;

    string internal deployment;
    string internal markets;
    MarketRegistry internal registry;
    AlphaMarketsVault internal vault;
    OracleRouter internal oracle;
    PriceValidator internal validator;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 4663);

        deployment = vm.readFile("deployments/robinhood_mainnet.json");
        markets = vm.readFile("deployments/robinhood_mainnet.markets.json");
        registry = MarketRegistry(vm.parseJsonAddress(deployment, ".marketRegistry"));
        vault = AlphaMarketsVault(vm.parseJsonAddress(deployment, ".vault"));
        oracle = OracleRouter(vm.parseJsonAddress(deployment, ".oracleRouter"));
        validator = PriceValidator(vm.parseJsonAddress(deployment, ".priceValidator"));
    }

    // -----------------------------------------------------------------------------------------
    // The deployment
    // -----------------------------------------------------------------------------------------

    function test_deployedStackIsEmptyAndOwnedByTheDeployer() public view {
        assertEq(registry.allMarketIds().length, 0, "no market is listed yet");
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), DEPLOYER));
        assertTrue(vault.hasRole(vault.DEFAULT_ADMIN_ROLE(), DEPLOYER));
        assertTrue(oracle.hasRole(oracle.ORACLE_ADMIN_ROLE(), DEPLOYER));
        assertEq(vault.totalLiabilities(USDG), 0);
        assertEq(IERC20(USDG).balanceOf(address(vault)), 0);
    }

    // -----------------------------------------------------------------------------------------
    // The settlement token
    // -----------------------------------------------------------------------------------------

    function test_usdgIsTheSettlementTokenWith6Decimals() public view {
        assertEq(vm.parseJsonAddress(deployment, ".settlementToken"), USDG);
        assertEq(IERC20Metadata(USDG).decimals(), 6);
        assertEq(IERC20Metadata(USDG).symbol(), "USDG");
    }

    /// USDG is an upgradeable, pausable Paxos token. Prove a deposit credits exactly what was sent (no fee
    /// on transfer) and a withdrawal returns it, on the real token code and the real deployed vault.
    function test_usdgDepositAndWithdrawMoveExactAmounts() public {
        address alice = makeAddr("alice");
        uint256 amount = 1_000 * 1e6;
        deal(USDG, alice, amount);
        if (IERC20(USDG).balanceOf(alice) != amount) {
            vm.skip(true, "cannot mint USDG balance on the fork with deal()");
        }

        vm.startPrank(alice);
        IERC20(USDG).approve(address(vault), amount);
        vault.deposit(USDG, amount);
        assertEq(IERC20(USDG).balanceOf(address(vault)), amount, "vault received exactly the amount");
        assertEq(vault.availableBalance(alice, USDG), amount, "ledger credited exactly the amount");

        vault.withdraw(USDG, amount);
        vm.stopPrank();
        assertEq(IERC20(USDG).balanceOf(alice), amount, "user got the full amount back");
        assertEq(IERC20(USDG).balanceOf(address(vault)), 0);
    }

    // -----------------------------------------------------------------------------------------
    // Real Chainlink feeds through the adapter
    // -----------------------------------------------------------------------------------------

    function test_everyListedFeedAndTokenIsReadable() public {
        uint256 count = abi.decode(vm.parseJson(markets, ".markets[*].symbol"), (string[])).length;
        assertGt(count, 0);
        for (uint256 i; i < count; i++) {
            string memory p = string.concat(".markets[", vm.toString(i), "]");
            string memory symbol = vm.parseJsonString(markets, string.concat(p, ".symbol"));
            address token = vm.parseJsonAddress(markets, string.concat(p, ".token"));
            address feed = vm.parseJsonAddress(markets, string.concat(p, ".feed"));

            assertEq(IERC20Metadata(token).symbol(), symbol, "token symbol matches the market");

            ChainlinkPriceFeed adapter = new ChainlinkPriceFeed(feed);
            assertEq(adapter.decimals(), 8, symbol);
            (uint256 price, uint256 ts) = adapter.latestPrice();
            assertGt(price, 1e8, symbol); // above $1
            assertLt(price, 100_000e8, symbol); // below $100,000
            assertLe(ts, block.timestamp, symbol);
            console.log(symbol, price, (block.timestamp - ts) / 60);
        }
    }

    // -----------------------------------------------------------------------------------------
    // Listing a market as the deployer, exactly as the launch script will
    // -----------------------------------------------------------------------------------------

    function test_deployerCanListAMarketOnARealFeedAndReadItsPrice() public {
        address token = vm.parseJsonAddress(markets, ".markets[0].token");
        address feed = vm.parseJsonAddress(markets, ".markets[0].feed");
        bytes32 id = bytes32(bytes(vm.parseJsonString(markets, ".markets[0].symbol")));

        vm.startPrank(DEPLOYER);
        ChainlinkPriceFeed adapter = new ChainlinkPriceFeed(feed);
        oracle.setPrimarySource(id, address(adapter), adapter.decimals());
        // The feed's heartbeat is 24 hours, so the default 1 hour age limit would refuse most reads.
        validator.setMaxPriceAge(id, 25 hours);
        registry.addMarket(
            MarketConfig({
                marketId: id,
                underlyingToken: token,
                oracleId: id,
                optionsEnabled: true,
                perpsEnabled: true,
                maxLeverage: 5,
                openInterestCap: 1_000_000 * 1e6,
                active: true
            })
        );
        vm.stopPrank();

        (uint256 price, uint256 ts) = oracle.getIndexPrice(id);
        assertGt(price, 1e18, "18 decimal price above $1");
        assertLe(ts, block.timestamp);
        assertEq(registry.allMarketIds().length, 1);
    }

    /// With the default age limit a feed that has not updated for over an hour is refused, so the market
    /// stops instead of trading on an old price. This is the safe failure, and it is why the per-market age
    /// limit is a launch decision.
    function test_anOldFeedIsRefusedUnderTheDefaultAgeLimit() public {
        address feed = vm.parseJsonAddress(markets, ".markets[0].feed");
        bytes32 id = bytes32("OLDFEED");
        ChainlinkPriceFeed adapter = new ChainlinkPriceFeed(feed);
        uint8 feedDecimals = adapter.decimals();
        vm.prank(DEPLOYER);
        oracle.setPrimarySource(id, address(adapter), feedDecimals);

        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(PriceValidator.StaleOraclePrice.selector);
        oracle.getIndexPrice(id);
    }

    /// Runs the launch listing code (the same `MarketLister` `AddMarketsMainnet.s.sol` uses) for every
    /// market in the list, as the deployer, then reads a live price for each through the router.
    function test_launchListingListsEveryMarketAndEveryPriceReads() public {
        Stack memory stack = Stack({
            marketRegistry: registry,
            riskManager: RiskManager(vm.parseJsonAddress(deployment, ".riskManager")),
            feeManager: FeeManager(vm.parseJsonAddress(deployment, ".feeManager")),
            oracleRouter: oracle,
            priceValidator: validator
        });
        uint256 count = abi.decode(vm.parseJson(markets, ".markets[*].symbol"), (string[])).length;

        vm.startPrank(DEPLOYER);
        for (uint256 i; i < count; i++) {
            string memory p = string.concat(".markets[", vm.toString(i), "]");
            bytes32 id = bytes32(bytes(vm.parseJsonString(markets, string.concat(p, ".symbol"))));
            bool etf = id == bytes32("SPY") || id == bytes32("QQQ");
            _list(
                stack,
                Listing({
                    marketId: id,
                    underlyingToken: vm.parseJsonAddress(markets, string.concat(p, ".token")),
                    chainlinkFeed: vm.parseJsonAddress(markets, string.concat(p, ".feed")),
                    maxLeverage: etf ? 10 : 5,
                    maintenanceBps: etf ? 500 : 750,
                    maxPosition: 5_000 * 1e6,
                    openInterestCap: 50_000 * 1e6,
                    maxPriceAge: 72 hours
                })
            );
        }
        vm.stopPrank();

        bytes32[] memory ids = registry.allMarketIds();
        assertEq(ids.length, count);
        for (uint256 i; i < ids.length; i++) {
            (uint256 price,) = oracle.getIndexPrice(ids[i]);
            assertGt(price, 1e18);
            assertTrue(registry.isActive(ids[i]));
        }
    }
}
