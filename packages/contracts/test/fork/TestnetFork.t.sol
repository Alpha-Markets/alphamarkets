// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {MarketRegistry} from "../../src/core/MarketRegistry.sol";
import {AlphaMarketsVault} from "../../src/core/AlphaMarketsVault.sol";
import {OracleRouter} from "../../src/oracle/OracleRouter.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";
import {MockPriceFeed} from "../../src/oracle/MockPriceFeed.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";
import {OptionsEngine} from "../../src/options/OptionsEngine.sol";
import {OptionPositionManager} from "../../src/options/OptionPositionManager.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {OptionType} from "../../src/interfaces/DataTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

interface IOwned {
    function owner() external view returns (address);
}

/// @notice Runs the pre-mainnet checklist against a fork of the LIVE Robinhood Chain testnet
/// deployment (`deployments/robinhood_testnet.json`), so every safeguard is exercised on the real
/// deployed contracts and their real state, without spending gas or changing the live chain.
///
/// It is skipped unless `ROBINHOOD_TESTNET_RPC_URL` is set, so CI (which has no RPC secret) does not
/// run it. Run it with:
///   forge test --match-path 'test/fork/*' -vv
///
/// It depends on live state (the market list, mock feeds, deployer roles), so a failure can mean
/// the testnet changed, not only that the code is wrong.
contract TestnetForkTest is Test {
    bytes32 internal constant NVDA = bytes32("NVDA");
    /// The deployer of the current testnet stack (packages/contracts/CHANGELOG.md, 1.5.0-testnet).
    address internal constant DEPLOYER = 0xC804c6c50CE6F5B5dFB035378A3F84145914697F;

    MarketRegistry internal registry;
    AlphaMarketsVault internal vault;
    OracleRouter internal oracle;
    PriceValidator internal validator;
    RiskManager internal risk;
    PerpsEngine internal perps;
    PerpPositionManager internal positions;
    LiquidationEngine internal liquidation;
    OptionsEngine internal options;
    OptionPositionManager internal optionPositions;
    MockERC20 internal token;
    MockPriceFeed internal feed;
    address internal feedOwner;
    uint256 internal unit;

    address internal alice = makeAddr("alice");
    address internal keeper = makeAddr("keeper");
    uint256 internal quoterKey = uint256(keccak256("alphamarkets.fork.quoter"));
    string internal json;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        json = vm.readFile("deployments/robinhood_testnet.json");
        registry = MarketRegistry(vm.parseJsonAddress(json, ".marketRegistry"));
        vault = AlphaMarketsVault(vm.parseJsonAddress(json, ".vault"));
        oracle = OracleRouter(vm.parseJsonAddress(json, ".oracleRouter"));
        validator = PriceValidator(vm.parseJsonAddress(json, ".priceValidator"));
        risk = RiskManager(vm.parseJsonAddress(json, ".riskManager"));
        perps = PerpsEngine(vm.parseJsonAddress(json, ".perpsEngine"));
        positions = PerpPositionManager(vm.parseJsonAddress(json, ".perpPositionManager"));
        liquidation = LiquidationEngine(vm.parseJsonAddress(json, ".liquidationEngine"));
        options = OptionsEngine(vm.parseJsonAddress(json, ".optionsEngine"));
        optionPositions = OptionPositionManager(vm.parseJsonAddress(json, ".optionPositionManager"));
        token = MockERC20(vm.parseJsonAddress(json, ".settlementToken"));
        unit = 10 ** IERC20Metadata(address(token)).decimals();

        feed = MockPriceFeed(oracle.primarySource(NVDA));
        feedOwner = IOwned(address(feed)).owner();
    }

    // -----------------------------------------------------------------------------------------
    // Wiring: the deployed stack is configured the way the docs say
    // -----------------------------------------------------------------------------------------

    function test_wiring_deployerHoldsAdminAndStackIsWired() public view {
        string[20] memory keys = [
            "marketRegistry",
            "collateralManager",
            "vault",
            "feeManager",
            "buybackModule",
            "priceValidator",
            "oracleRouter",
            "riskManager",
            "optionPositionManager",
            "optionMarket",
            "optionsEngine",
            "perpPositionManager",
            "perpOrderManager",
            "fundingManager",
            "insuranceFund",
            "crossMargin",
            "subaccountFactory",
            "rfqManager",
            "perpsEngine",
            "liquidationEngine"
        ];
        for (uint256 i; i < keys.length; i++) {
            address target = vm.parseJsonAddress(json, string.concat(".", keys[i]));
            assertGt(target.code.length, 0, string.concat("no code: ", keys[i]));
        }
        assertEq(address(vault.withdrawGuard()), vm.parseJsonAddress(json, ".crossMargin"), "withdraw guard");
        assertEq(perps.rfqManager(), vm.parseJsonAddress(json, ".rfqManager"), "rfq manager");
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), DEPLOYER), "deployer admin");
        assertTrue(registry.isActive(NVDA), "NVDA active");
    }

    // -----------------------------------------------------------------------------------------
    // Oracle safeguards (checklist: stale rejection, deviation rejection, fallback, emergency pause)
    // -----------------------------------------------------------------------------------------

    function test_oracle_rejectsStalePrice() public {
        (uint256 price,) = oracle.getIndexPrice(NVDA); // fresh at the fork block (the keeper refreshes it)
        assertGt(price, 0);
        vm.warp(block.timestamp + validator.maxPriceAge(NVDA) + 1 hours + 1);
        vm.expectRevert(PriceValidator.StaleOraclePrice.selector);
        oracle.getIndexPrice(NVDA);
    }

    function test_oracle_rejectsDeviatingSources() public {
        (uint256 price,) = oracle.getIndexPrice(NVDA);
        vm.startPrank(DEPLOYER);
        MockPriceFeed fallbackFeed = new MockPriceFeed(DEPLOYER, 18, price * 130 / 100); // 30% away
        oracle.setFallbackSource(NVDA, address(fallbackFeed), 18);
        vm.stopPrank();
        vm.expectRevert(PriceValidator.InvalidOraclePrice.selector);
        oracle.getIndexPrice(NVDA);
    }

    function test_oracle_usesFallbackWhenPrimaryIsStale() public {
        (uint256 price,) = oracle.getIndexPrice(NVDA);
        vm.startPrank(DEPLOYER);
        MockPriceFeed fallbackFeed = new MockPriceFeed(DEPLOYER, 18, price);
        oracle.setFallbackSource(NVDA, address(fallbackFeed), 18);
        vm.stopPrank();

        vm.warp(block.timestamp + 3 hours); // primary now stale
        vm.prank(DEPLOYER);
        fallbackFeed.setPrice(price + 1e18); // fallback refreshed
        (uint256 got,) = oracle.getIndexPrice(NVDA);
        assertEq(got, price + 1e18, "fallback price used");
    }

    function test_oracle_emergencyPauseBlocksReads_andUnpauseRestores() public {
        vm.prank(DEPLOYER);
        oracle.pauseMarket(NVDA);
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.MarketOraclePaused.selector, NVDA));
        oracle.getIndexPrice(NVDA);
        vm.prank(DEPLOYER);
        oracle.unpauseMarket(NVDA);
        (uint256 price,) = oracle.getIndexPrice(NVDA);
        assertGt(price, 0);
    }

    function test_oracle_pauseAndSetterNeedAdminRole() public {
        address attacker = makeAddr("attacker");
        vm.startPrank(attacker);
        vm.expectRevert();
        oracle.pauseMarket(NVDA);
        vm.expectRevert();
        oracle.setPrimarySource(NVDA, attacker, 18);
        vm.expectRevert();
        validator.setMaxPriceAge(NVDA, type(uint256).max);
        vm.stopPrank();
    }

    function test_marketPause_blocksNewPerpPositions() public {
        _fund(alice, 10_000 * unit);
        vm.prank(DEPLOYER);
        registry.setActive(NVDA, false);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("MarketPaused(bytes32)", NVDA));
        perps.openPosition(NVDA, true, 1_000 * unit, 5, type(uint256).max, block.timestamp + 1 hours);
    }

    // -----------------------------------------------------------------------------------------
    // Full lifecycles on the real deployment (checklist: open, close, settle, liquidate)
    // -----------------------------------------------------------------------------------------

    function test_perps_openAndCloseAtProfit() public {
        _fund(alice, 10_000 * unit);
        (uint256 entry,) = oracle.getMarkPrice(NVDA);
        vm.prank(alice);
        uint256 id = perps.openPosition(NVDA, true, 1_000 * unit, 5, type(uint256).max, block.timestamp + 1 hours);
        uint256 before = vault.availableBalance(alice, address(token));

        _movePrice(entry * 110 / 100);
        vm.prank(alice);
        perps.closePosition(id, 0, block.timestamp + 1 hours);

        assertFalse(positions.getPosition(id).open, "closed");
        // +10% on a 5x position on 1,000 of margin is about +500 profit, less the taker fee.
        assertGt(vault.availableBalance(alice, address(token)), before + 1_000 * unit, "margin back plus profit");
    }

    function test_perps_liquidatesWhenUnderMaintenanceMargin() public {
        _fund(alice, 10_000 * unit);
        (uint256 entry,) = oracle.getMarkPrice(NVDA);
        vm.prank(alice);
        uint256 id = perps.openPosition(NVDA, true, 1_000 * unit, 10, type(uint256).max, block.timestamp + 1 hours);

        vm.prank(keeper);
        vm.expectRevert(LiquidationEngine.PositionNotLiquidatable.selector);
        liquidation.liquidate(id); // healthy at entry

        _movePrice(entry * 905 / 1000); // -9.5%: equity 5% of a 10x size, under the maintenance margin
        assertTrue(liquidation.isLiquidatable(id), "liquidatable");
        vm.prank(keeper);
        liquidation.liquidate(id);
        assertFalse(positions.getPosition(id).open, "closed by liquidation");
        assertGt(vault.availableBalance(keeper, address(token)), 0, "liquidator rewarded");
    }

    function test_perps_rejectsLeverageAbovePolicyAndStaleOracleOpen() public {
        _fund(alice, 10_000 * unit);
        vm.prank(alice);
        vm.expectRevert(); // 4x is not an allowed tier
        perps.openPosition(NVDA, true, 1_000 * unit, 4, type(uint256).max, block.timestamp + 1 hours);

        vm.warp(block.timestamp + 5 hours);
        vm.prank(alice);
        vm.expectRevert(PriceValidator.StaleOraclePrice.selector);
        perps.openPosition(NVDA, true, 1_000 * unit, 5, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_perps_deadlineAndSlippageAreEnforced() public {
        _fund(alice, 10_000 * unit);
        vm.prank(alice);
        vm.expectRevert(); // deadline already passed
        perps.openPosition(NVDA, true, 1_000 * unit, 5, type(uint256).max, block.timestamp - 1);

        vm.prank(alice);
        vm.expectRevert(); // long with a limit price far below the market: slippage
        perps.openPosition(NVDA, true, 1_000 * unit, 5, 1e18, block.timestamp + 1 hours);
    }

    function test_options_buyAndSettleInTheMoney() public {
        vm.startPrank(DEPLOYER);
        options.grantRole(options.QUOTER_ROLE(), vm.addr(quoterKey));
        vm.stopPrank();
        _fund(alice, 10_000 * unit);

        (uint256 spot,) = oracle.getIndexPrice(NVDA);
        uint256 strike = (spot / 1e18) * 1e18; // a whole-dollar strike at the money
        uint256 expiry = block.timestamp + 1 days;
        uint256 premium = 50 * unit;
        IOptionsEngine.OpenPositionParams memory params = IOptionsEngine.OpenPositionParams({
            marketId: NVDA,
            optionType: OptionType.CALL,
            strike: strike,
            expiry: expiry,
            contracts: 10,
            premium: premium,
            deadline: block.timestamp + 1 hours
        });
        IOptionsEngine.Quote memory quote = _quote(alice, params, 1);
        vm.prank(alice);
        uint256 id = options.openPosition(params, quote);
        uint256 afterOpen = vault.availableBalance(alice, address(token));

        // The same quote cannot be used twice.
        vm.prank(alice);
        vm.expectRevert();
        options.openPosition(params, quote);

        vm.warp(expiry);
        _movePrice(strike + 20e18);
        options.settleExpired(NVDA, expiry, strike, OptionType.CALL);

        OptionPositionManager.OptionPosition memory pos = optionPositions.getPosition(id);
        assertEq(uint256(pos.status), uint256(OptionPositionManager.PositionStatus.SETTLED), "settled");
        // payout = 20 intrinsic x 1 contract size x 10 contracts = 200, less the settlement fee.
        assertGt(vault.availableBalance(alice, address(token)), afterOpen + 150 * unit, "payout credited");
    }

    function test_options_rejectsQuoteFromUnauthorizedSigner() public {
        _fund(alice, 10_000 * unit);
        (uint256 spot,) = oracle.getIndexPrice(NVDA);
        IOptionsEngine.OpenPositionParams memory params = IOptionsEngine.OpenPositionParams({
            marketId: NVDA,
            optionType: OptionType.CALL,
            strike: (spot / 1e18) * 1e18,
            expiry: block.timestamp + 1 days,
            contracts: 1,
            premium: 5 * unit,
            deadline: block.timestamp + 1 hours
        });
        // quoterKey was never granted QUOTER_ROLE in this test.
        IOptionsEngine.Quote memory quote = _quote(alice, params, 7);
        vm.prank(alice);
        vm.expectRevert();
        options.openPosition(params, quote);
    }

    // -----------------------------------------------------------------------------------------
    // Vault: custody and withdrawal validation
    // -----------------------------------------------------------------------------------------

    function test_vault_withdrawIsLimitedToOwnAvailableBalance() public {
        _fund(alice, 1_000 * unit);
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(address(token), 1_001 * unit);
        vm.prank(alice);
        vault.withdraw(address(token), 1_000 * unit);
        assertEq(token.balanceOf(alice), 1_000 * unit);

        vm.prank(makeAddr("thief"));
        vm.expectRevert();
        vault.settlePnl(alice, address(token), int256(1_000_000 * unit)); // engine-only
    }

    // -----------------------------------------------------------------------------------------
    // Upgrade authority: only DEFAULT_ADMIN_ROLE upgrades, state survives an upgrade
    // -----------------------------------------------------------------------------------------

    function test_upgrade_onlyAdminCanUpgrade() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        UUPSUpgradeable(address(vault)).upgradeToAndCall(address(0xdead), "");
        vm.prank(attacker);
        vm.expectRevert();
        UUPSUpgradeable(address(perps)).upgradeToAndCall(address(0xdead), "");
    }

    function test_upgrade_implementationCannotBeInitialisedDirectly() public {
        address impl = vm.parseJsonAddress(vm.readFile("deployments/robinhood_testnet.implementations.json"), ".vault");
        vm.expectRevert();
        AlphaMarketsVault(impl).initialize(address(this));
    }

    // -----------------------------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------------------------

    function _fund(address user, uint256 amount) internal {
        token.mint(user, amount);
        vm.startPrank(user);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(address(token), amount);
        vm.stopPrank();
    }

    /// The mock feed's owner pushes a price, the way the keeper does.
    function _movePrice(uint256 price) internal {
        vm.prank(feedOwner);
        feed.setPrice(price);
    }

    function _quote(address user, IOptionsEngine.OpenPositionParams memory params, uint256 nonce)
        internal
        view
        returns (IOptionsEngine.Quote memory)
    {
        uint256 validUntil = block.timestamp + 60;
        bytes32 digest = options.openQuoteDigest(user, params, validUntil, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(quoterKey, digest);
        return IOptionsEngine.Quote({validUntil: validUntil, nonce: nonce, signature: abi.encodePacked(r, s, v)});
    }
}
