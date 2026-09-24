// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {MarketConfig} from "../../src/interfaces/DataTypes.sol";
import {OracleRouter} from "../../src/oracle/OracleRouter.sol";
import {PriceValidator} from "../../src/oracle/PriceValidator.sol";

/// @notice A pauser key can stop trading fast and can do nothing else: it cannot turn a market back on, change
/// an oracle source, or change any configuration. Only the admin (the timelock after the handover) can.
contract PauserTest is BaseTest {
    address internal pauser = makeAddr("pauser");
    bytes32 internal constant TSLA = bytes32("TSLA");

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        marketRegistry.grantRole(marketRegistry.PAUSER_ROLE(), pauser);
        oracleRouter.grantRole(oracleRouter.PAUSER_ROLE(), pauser);
        // A second market, so the protocol-wide pause has more than one to stop.
        marketRegistry.addMarket(
            MarketConfig({
                marketId: TSLA,
                underlyingToken: address(0xBEEF),
                oracleId: TSLA,
                optionsEnabled: true,
                perpsEnabled: true,
                maxLeverage: 10,
                openInterestCap: 5_000_000e18,
                active: true
            })
        );
        vm.stopPrank();
    }

    function _open(address user) internal returns (uint256 id) {
        vm.prank(user);
        id = perpsEngine.openPosition(NVDA, true, 1_000e18, 5, type(uint256).max, block.timestamp + 1 hours);
    }

    // --- the oracle pause

    function test_pauser_canPauseAMarketsOracle() public {
        vm.prank(pauser);
        oracleRouter.pauseMarket(NVDA);
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.MarketOraclePaused.selector, NVDA));
        oracleRouter.getIndexPrice(NVDA);
    }

    function test_pauser_cannotUnpauseOrChangeTheOracle() public {
        vm.startPrank(pauser);
        oracleRouter.pauseMarket(NVDA);
        vm.expectRevert();
        oracleRouter.unpauseMarket(NVDA);
        vm.expectRevert();
        oracleRouter.setPrimarySource(NVDA, address(0xBAD), 18);
        vm.expectRevert();
        oracleRouter.setFallbackSource(NVDA, address(0xBAD), 18);
        vm.stopPrank();
    }

    function test_oracleAdmin_canStillPauseAndUnpause() public {
        vm.startPrank(admin);
        oracleRouter.pauseMarket(NVDA);
        oracleRouter.unpauseMarket(NVDA);
        vm.stopPrank();
        (uint256 price,) = oracleRouter.getIndexPrice(NVDA);
        assertGt(price, 0);
    }

    function test_anyoneElse_cannotPauseTheOracle() public {
        vm.prank(alice);
        vm.expectRevert();
        oracleRouter.pauseMarket(NVDA);
    }

    // --- the market pause

    function test_pauser_canStopANewMarketButNotTurnItBackOn() public {
        vm.startPrank(pauser);
        marketRegistry.setActive(NVDA, false);
        assertFalse(marketRegistry.isActive(NVDA));
        vm.expectRevert();
        marketRegistry.setActive(NVDA, true);
        vm.stopPrank();

        vm.prank(admin);
        marketRegistry.setActive(NVDA, true);
        assertTrue(marketRegistry.isActive(NVDA));
    }

    function test_pauser_cannotAddOrChangeMarkets() public {
        MarketConfig memory config = marketRegistry.getMarket(NVDA);
        vm.startPrank(pauser);
        vm.expectRevert();
        marketRegistry.updateMarket(NVDA, config);
        config.marketId = bytes32("AAPL");
        vm.expectRevert();
        marketRegistry.addMarket(config);
        vm.stopPrank();
    }

    function test_anyoneElse_cannotPauseAMarket() public {
        vm.prank(alice);
        vm.expectRevert();
        marketRegistry.setActive(NVDA, false);
    }

    // --- the protocol-wide pause

    function test_pauseAll_stopsNewTradingInEveryMarket() public {
        vm.prank(pauser);
        marketRegistry.pauseAll();
        assertFalse(marketRegistry.isActive(NVDA));
        assertFalse(marketRegistry.isActive(TSLA));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("MarketPaused(bytes32)", NVDA));
        perpsEngine.openPosition(NVDA, true, 1_000e18, 5, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_pauseAll_stillLetsUsersCloseAndBeLiquidated() public {
        uint256 id = _open(alice);
        vm.prank(pauser);
        marketRegistry.pauseAll();

        vm.prank(alice);
        perpsEngine.closePosition(id, 0, block.timestamp + 1 hours); // a paused market never traps a position
        assertFalse(perpPositionManager.getPosition(id).open);
    }

    function test_pauseAll_needsThePauserRole() public {
        vm.prank(alice);
        vm.expectRevert();
        marketRegistry.pauseAll();
        // A market admin who is not a pauser is not enough: pausing everything is its own power.
        address marketAdmin = makeAddr("marketAdmin");
        vm.startPrank(admin);
        marketRegistry.grantRole(marketRegistry.MARKET_ADMIN_ROLE(), marketAdmin);
        vm.stopPrank();
        vm.prank(marketAdmin);
        vm.expectRevert();
        marketRegistry.pauseAll();
    }

    function test_pauseAll_isIdempotent_andTurningBackOnIsOneByOne() public {
        vm.prank(pauser);
        marketRegistry.pauseAll();
        vm.prank(pauser);
        marketRegistry.pauseAll(); // no revert, no change
        vm.prank(admin);
        marketRegistry.setActive(TSLA, true);
        assertTrue(marketRegistry.isActive(TSLA));
        assertFalse(marketRegistry.isActive(NVDA), "the other market stays paused");
    }

    function test_theAdminHoldsThePauserRoleFromTheStart() public view {
        assertTrue(marketRegistry.hasRole(marketRegistry.PAUSER_ROLE(), admin));
        assertTrue(oracleRouter.hasRole(oracleRouter.PAUSER_ROLE(), admin));
    }
}
