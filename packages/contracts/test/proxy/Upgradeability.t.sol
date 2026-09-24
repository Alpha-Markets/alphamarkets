// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {BaseTest} from "../utils/BaseTest.sol";
import {VaultV2} from "../mocks/VaultV2.sol";
import {AlphaMarketsVault} from "../../src/core/AlphaMarketsVault.sol";
import {UpgradePlaceholder} from "../../src/proxy/UpgradePlaceholder.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";
import {RFQManager} from "../../src/perps/RFQManager.sol";

/// @dev The stack lives behind ERC-1967 proxies so a redeploy keeps every address and all state. These
/// tests cover the promises: the address and state survive an upgrade, only the admin can upgrade, and
/// a proxy or an implementation cannot be initialized a second time.
contract UpgradeabilityTest is BaseTest {
    function _implementationOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT))));
    }

    function _allProxies() internal view returns (address[20] memory p) {
        p = [
            stack.marketRegistry,
            stack.collateralManager,
            stack.vault,
            stack.feeManager,
            stack.buybackModule,
            stack.priceValidator,
            stack.oracleRouter,
            stack.riskManager,
            stack.optionPositionManager,
            stack.optionMarket,
            stack.optionsEngine,
            stack.perpPositionManager,
            stack.perpOrderManager,
            stack.fundingManager,
            stack.perpsEngine,
            stack.liquidationEngine,
            stack.insuranceFund,
            stack.crossMargin,
            stack.subaccountFactory,
            stack.rfqManager
        ];
    }

    // ---- address and state survive an upgrade ------------------------------

    function test_upgrade_keepsTheAddressStateAndRoles() public {
        uint256 before_ = vault.availableBalance(alice, address(usdc));
        assertGt(before_, 0);
        address oldImpl = _implementationOf(address(vault));

        vm.startPrank(admin);
        VaultV2 v2 = new VaultV2(address(collateralManager));
        vault.upgradeToAndCall(address(v2), "");
        vm.stopPrank();

        assertNotEq(_implementationOf(address(vault)), oldImpl, "implementation did not change");
        assertEq(_implementationOf(address(vault)), address(v2));
        assertEq(vault.availableBalance(alice, address(usdc)), before_, "state was lost");
        assertTrue(vault.hasRole(vault.ENGINE_ROLE(), address(perpsEngine)), "role was lost");
        assertEq(VaultV2(address(vault)).version(), 2);

        VaultV2(address(vault)).bump();
        assertEq(VaultV2(address(vault)).v2Counter(), 1, "an appended variable does not work");
    }

    function test_upgrade_tradingStillWorksAfterEveryContractIsUpgraded() public {
        vm.prank(alice);
        uint256 id = perpsEngine.openPosition(NVDA, true, 1_000e18, 2, type(uint256).max, block.timestamp + 1 hours);

        address[20] memory before_ = _allProxies();
        vm.startPrank(admin);
        Impls memory impls = _deployImpls(stack);
        _upgradeAll(stack, impls);
        vm.stopPrank();

        address[20] memory after_ = _allProxies();
        for (uint256 i = 0; i < 20; i++) {
            assertEq(after_[i], before_[i], "an address changed");
            assertNotEq(_implementationOf(after_[i]), address(0));
        }
        assertEq(_implementationOf(stack.vault), impls.vault);
        assertEq(_implementationOf(stack.perpsEngine), impls.perpsEngine);

        // The position opened before the upgrade is still there and can still be closed.
        assertTrue(perpPositionManager.getPosition(id).open);
        vm.prank(alice);
        perpsEngine.closePosition(id, 0, block.timestamp + 1 hours);
        assertFalse(perpPositionManager.getPosition(id).open);
    }

    // ---- who can upgrade ---------------------------------------------------

    function test_upgrade_onlyTheAdminCanUpgrade() public {
        address impl = address(new VaultV2(address(collateralManager)));
        address[20] memory proxies = _allProxies();
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(alice);
            vm.expectRevert();
            UUPSUpgradeable(proxies[i]).upgradeToAndCall(impl, "");
        }
    }

    function test_upgrade_authorityMovesWithTheAdminRole() public {
        address timelock = makeAddr("timelock");
        address impl = address(new VaultV2(address(collateralManager)));

        vm.startPrank(admin);
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), timelock);
        vault.revokeRole(vault.DEFAULT_ADMIN_ROLE(), admin);
        vm.expectRevert();
        vault.upgradeToAndCall(impl, "");
        vm.stopPrank();

        vm.prank(timelock);
        vault.upgradeToAndCall(impl, "");
        assertEq(_implementationOf(address(vault)), impl);
    }

    function test_admin_holdsTheDefaultAdminRoleOnBothEngines() public view {
        assertTrue(IAccessControl(address(perpsEngine)).hasRole(bytes32(0), admin));
        assertTrue(IAccessControl(address(liquidationEngine)).hasRole(bytes32(0), admin));
    }

    // ---- initialization ----------------------------------------------------

    function test_initialize_cannotRunTwiceOnAnyProxy() public {
        address[20] memory proxies = _allProxies();
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(alice);
            (bool ok, bytes memory ret) = proxies[i].call(abi.encodeWithSignature("initialize(address)", alice));
            assertFalse(ok, "a proxy can be initialized again");
            assertEq(bytes4(ret), Initializable.InvalidInitialization.selector);
        }
    }

    function test_initialize_cannotRunOnAnImplementation() public {
        address[20] memory proxies = _allProxies();
        for (uint256 i = 0; i < 20; i++) {
            address impl = _implementationOf(proxies[i]);
            vm.prank(alice);
            (bool ok, bytes memory ret) = impl.call(abi.encodeWithSignature("initialize(address)", alice));
            assertFalse(ok, "an implementation can be initialized");
            assertEq(bytes4(ret), Initializable.InvalidInitialization.selector);
        }
    }

    function test_upgrade_implementationCannotBeUpgradedDirectly() public {
        address impl = _implementationOf(address(vault));
        address v2 = address(new VaultV2(address(collateralManager)));
        vm.prank(admin);
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        UUPSUpgradeable(impl).upgradeToAndCall(v2, "");
    }

    function test_upgrade_cannotUpgradeToANonUupsContract() public {
        vm.prank(admin);
        vm.expectRevert();
        vault.upgradeToAndCall(address(usdc), "");
    }

    // ---- values that used to be set by the constructor ---------------------

    function test_initialize_setsTheDefaultsTheConstructorsUsedToSet() public view {
        assertEq(crossMargin.portfolioFloorBps(), 3_000);
        assertEq(rfqManager.maxDeviationBps(), 100);
        assertEq(crossMargin.shocksBps(0), -2_000);
        assertEq(crossMargin.shocksBps(3), 2_000);
    }

    function test_eip712_domainUsesTheProxyAddress() public view {
        (,,,, address verifying,,) = rfqManager.eip712Domain();
        assertEq(verifying, address(rfqManager));
        (,,,, address optionsVerifying,,) = optionsEngine.eip712Domain();
        assertEq(optionsVerifying, address(optionsEngine));
    }

    // ---- placeholder used during the first deployment ----------------------

    function test_placeholder_onlyItsOwnerCanUpgradeIt() public {
        address placeholder = address(new UpgradePlaceholder());
        address proxy = address(new ERC1967Proxy(placeholder, abi.encodeCall(UpgradePlaceholder.setOwner, (admin))));
        address impl = address(new VaultV2(address(collateralManager)));

        vm.prank(alice);
        vm.expectRevert(UpgradePlaceholder.NotOwner.selector);
        UUPSUpgradeable(proxy).upgradeToAndCall(impl, "");

        vm.prank(admin);
        UUPSUpgradeable(proxy).upgradeToAndCall(impl, abi.encodeWithSignature("initialize(address)", admin));
        assertEq(_implementationOf(proxy), impl);
    }

    function test_placeholder_ownerCanBeSetOnlyOnce() public {
        address placeholder = address(new UpgradePlaceholder());
        address proxy = address(new ERC1967Proxy(placeholder, abi.encodeCall(UpgradePlaceholder.setOwner, (admin))));
        vm.expectRevert(UpgradePlaceholder.AlreadyOwned.selector);
        UpgradePlaceholder(proxy).setOwner(alice);
    }
}
