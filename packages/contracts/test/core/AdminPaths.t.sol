// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {MarketRegistry} from "../../src/core/MarketRegistry.sol";
import {BuybackModule} from "../../src/core/BuybackModule.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {MarketConfig} from "../../src/interfaces/DataTypes.sol";

/// @dev Admin, view and error paths that the flow tests do not reach.
contract AdminPathsTest is BaseTest {
    function _config(address token) internal pure returns (MarketConfig memory) {
        return MarketConfig({
            marketId: "TSLA",
            underlyingToken: token,
            oracleId: "TSLA",
            optionsEnabled: false,
            perpsEnabled: true,
            maxLeverage: 5,
            openInterestCap: 1_000e18,
            active: true
        });
    }

    // ---- MarketRegistry -----------------------------------------------------

    function test_registry_addAndUpdateMarket() public {
        vm.startPrank(admin);
        marketRegistry.addMarket(_config(address(0xCAFE)));
        assertEq(marketRegistry.allMarketIds().length, 2);
        assertFalse(marketRegistry.isOptionsEnabled("TSLA"));

        MarketConfig memory updated = _config(address(0xCAFE));
        updated.maxLeverage = 3;
        updated.active = false;
        marketRegistry.updateMarket("TSLA", updated);
        vm.stopPrank();

        assertEq(marketRegistry.getMarket("TSLA").maxLeverage, 3);
        assertFalse(marketRegistry.isActive("TSLA"));
    }

    function test_registry_rejectsZeroConstructorAndZeroToken() public {
        address registryImpl = address(new MarketRegistry());
        vm.expectRevert(MarketRegistry.ZeroAddress.selector);
        _proxyFor(registryImpl, address(0));

        vm.startPrank(admin);
        vm.expectRevert(MarketRegistry.ZeroAddress.selector);
        marketRegistry.addMarket(_config(address(0)));
        marketRegistry.addMarket(_config(address(0xCAFE)));
        vm.expectRevert(MarketRegistry.ZeroAddress.selector);
        marketRegistry.updateMarket("TSLA", _config(address(0)));
        vm.stopPrank();
    }

    function test_registry_unknownMarketReverts() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(MarketRegistry.MarketDoesNotExist.selector, bytes32("TSLA")));
        marketRegistry.getMarket("TSLA");
        vm.expectRevert(abi.encodeWithSelector(MarketRegistry.MarketDoesNotExist.selector, bytes32("TSLA")));
        marketRegistry.updateMarket("TSLA", _config(address(0xCAFE)));
        vm.expectRevert(abi.encodeWithSelector(MarketRegistry.MarketDoesNotExist.selector, bytes32("TSLA")));
        marketRegistry.setActive("TSLA", true);
        vm.stopPrank();

        assertFalse(marketRegistry.isActive("TSLA"));
    }

    function test_registry_nonAdminCannotUpdateOrPause() public {
        vm.startPrank(alice);
        vm.expectRevert();
        marketRegistry.updateMarket(NVDA, _config(address(0xCAFE)));
        vm.expectRevert();
        marketRegistry.setActive(NVDA, false);
        vm.stopPrank();
    }

    // ---- BuybackModule ------------------------------------------------------

    function test_buyback_protocolTokenGatesExecution() public {
        vm.startPrank(admin);
        vm.expectRevert(BuybackModule.ProtocolTokenNotSet.selector);
        buybackModule.executeBuyback(1, "");

        buybackModule.setProtocolToken(address(0xF00D));
        assertEq(buybackModule.protocolToken(), address(0xF00D));
        buybackModule.executeBuyback(1, ""); // the stub does nothing once a token exists
        vm.stopPrank();
    }

    function test_buyback_accessAndConstructor() public {
        address buybackImpl = address(new BuybackModule());
        vm.expectRevert(BuybackModule.ZeroAddress.selector);
        _proxyFor(buybackImpl, address(0));

        vm.startPrank(alice);
        vm.expectRevert();
        buybackModule.setProtocolToken(address(1));
        vm.expectRevert();
        buybackModule.notifyFees(address(usdc), 1);
        vm.expectRevert();
        buybackModule.executeBuyback(1, "");
        vm.stopPrank();
    }

    // ---- PerpPositionManager ------------------------------------------------

    function test_positionManager_unknownAndClosedPositionsRevert() public {
        vm.startPrank(address(perpsEngine));
        vm.expectRevert(abi.encodeWithSelector(PerpPositionManager.PositionNotFound.selector, 7));
        perpPositionManager.updatePosition(7, 1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(PerpPositionManager.PositionNotFound.selector, 7));
        perpPositionManager.closePosition(7);
        vm.expectRevert(abi.encodeWithSelector(PerpPositionManager.PositionNotFound.selector, 7));
        perpPositionManager.accrueFunding(7, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(PerpPositionManager.PositionNotFound.selector, 7));
        perpPositionManager.setRealizedPnl(7, 1);
        vm.stopPrank();

        vm.prank(alice);
        uint256 id = perpsEngine.openPosition(NVDA, true, 1_000e18, 2, type(uint256).max, block.timestamp + 1 hours);
        vm.startPrank(address(perpsEngine));
        perpPositionManager.closePosition(id);
        vm.expectRevert(abi.encodeWithSelector(PerpPositionManager.PositionNotOpen.selector, id));
        perpPositionManager.closePosition(id);
        vm.expectRevert(abi.encodeWithSelector(PerpPositionManager.PositionNotOpen.selector, id));
        perpPositionManager.updatePosition(id, 1, 1, 1);
        vm.stopPrank();

        assertEq(perpPositionManager.getUserPositions(alice).length, 1);
    }

    // ---- FundingManager -----------------------------------------------------

    function test_funding_intervalAndCapConfig() public {
        vm.startPrank(admin);
        fundingManager.setFundingInterval(NVDA, 4 hours);
        fundingManager.setMaxFundingRateBps(NVDA, 25);
        vm.stopPrank();

        assertEq(fundingManager.nextFundingTimestamp(NVDA), fundingManager.lastFundingTimestamp(NVDA) + 4 hours);

        vm.startPrank(alice);
        vm.expectRevert();
        fundingManager.setFundingInterval(NVDA, 1);
        vm.expectRevert();
        fundingManager.setMaxFundingRateBps(NVDA, 1);
        vm.stopPrank();
    }

    function test_funding_settleFundingOnlyEngine() public {
        vm.expectRevert();
        fundingManager.settleFunding(1);
    }
}
