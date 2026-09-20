// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {SubaccountFactory} from "../../src/accounts/SubaccountFactory.sol";
import {HandOverAdmin} from "../../script/HandOverAdmin.s.sol";

/// @dev Cross-cutting rule: every admin path assumes a later move to a multisig or timelock. This runs
/// the handover script's logic on the full stack and checks that authority really moves.
contract AdminHandoverTest is BaseTest, HandOverAdmin {
    address internal timelock;
    SubaccountFactory internal subaccounts;

    function setUp() public override {
        super.setUp();
        subaccounts = new SubaccountFactory(admin, address(vault));
        timelock = makeAddr("timelock");
        vm.etch(timelock, hex"00"); // any address with code stands in for a multisig or a timelock
    }

    function _targets() internal view returns (address[] memory t) {
        t = new address[](18);
        t[0] = address(marketRegistry);
        t[1] = address(collateralManager);
        t[2] = address(vault);
        t[3] = address(feeManager);
        t[4] = address(buybackModule);
        t[5] = address(priceValidator);
        t[6] = address(oracleRouter);
        t[7] = address(riskManager);
        t[8] = address(optionPositionManager);
        t[9] = address(optionMarket);
        t[10] = address(optionsEngine);
        t[11] = address(perpPositionManager);
        t[12] = address(perpOrderManager);
        t[13] = address(fundingManager);
        t[14] = address(insuranceFund);
        t[15] = address(crossMargin);
        t[16] = address(subaccounts);
        t[17] = address(rfqManager);
    }

    function _run(bool renounce) internal returns (uint256 changes) {
        address[] memory targets = _targets();
        vm.startPrank(admin);
        changes = handOver(targets, admin, timelock, renounce, false);
        vm.stopPrank();
    }

    function test_grantOnlyKeepsBothAdmins() public {
        uint256 changes = _run(false);
        assertGt(changes, 0);

        address[] memory targets = _targets();
        bytes32[] memory roles = _adminRoles();
        for (uint256 t = 0; t < targets.length; t++) {
            for (uint256 r = 0; r < roles.length; r++) {
                bool hadIt = IAccessControl(targets[t]).hasRole(roles[r], admin);
                // The deployer keeps every role it had, and the new admin holds exactly those.
                assertEq(IAccessControl(targets[t]).hasRole(roles[r], timelock), hadIt);
            }
        }
    }

    function test_renounceLeavesOnlyTheNewAdmin() public {
        _run(false);
        _run(true);

        address[] memory targets = _targets();
        bytes32[] memory roles = _adminRoles();
        for (uint256 t = 0; t < targets.length; t++) {
            assertTrue(IAccessControl(targets[t]).hasRole(bytes32(0), timelock), "new admin lost the default admin");
            for (uint256 r = 0; r < roles.length; r++) {
                assertFalse(IAccessControl(targets[t]).hasRole(roles[r], admin), "old admin kept a role");
            }
        }
    }

    function test_oneRunCanGrantAndRenounce() public {
        _run(true);
        assertFalse(marketRegistry.hasRole(bytes32(0), admin));
        assertTrue(marketRegistry.hasRole(marketRegistry.MARKET_ADMIN_ROLE(), timelock));
    }

    function test_secondRunChangesNothing() public {
        _run(true);
        // The old admin holds nothing now, so there is nothing left to move.
        vm.startPrank(admin);
        assertEq(handOver(_targets(), admin, timelock, true, false), 0);
        vm.stopPrank();
    }

    function test_newAdminCanChangeParametersAndTheOldAdminCannot() public {
        _run(true);

        vm.startPrank(timelock);
        priceValidator.setMaxPriceAge(NVDA, 2 hours);
        oracleRouter.pauseMarket(NVDA);
        oracleRouter.unpauseMarket(NVDA);
        fundingManager.setFundingInterval(NVDA, 1 hours);
        feeManager.setBuybackShare(0);
        marketRegistry.setActive(NVDA, true);
        collateralManager.addSupportedToken(address(0xBEEF));
        optionMarket.setContractSize(NVDA, 1e18);
        buybackModule.setProtocolToken(address(0xBEEF));
        vault.setWithdrawGuard(address(crossMargin));
        subaccounts.setTargetAllowed(address(0xBEEF), true);
        vm.stopPrank();

        vm.startPrank(admin);
        vm.expectRevert();
        priceValidator.setMaxPriceAge(NVDA, 3 hours);
        vm.expectRevert();
        oracleRouter.pauseMarket(NVDA);
        vm.expectRevert();
        marketRegistry.setActive(NVDA, false);
        vm.expectRevert();
        vault.setWithdrawGuard(address(0));
        vm.expectRevert();
        collateralManager.addSupportedToken(address(0xCAFE));
        vm.stopPrank();
    }

    function test_operationalRolesAreLeftAlone() public {
        _run(true);
        // Contracts keep the roles they need to talk to each other.
        assertTrue(vault.hasRole(vault.ENGINE_ROLE(), address(perpsEngine)));
        assertTrue(rfqManager.hasRole(rfqManager.MAKER_ROLE(), quoter));
        assertTrue(optionsEngine.hasRole(optionsEngine.QUOTER_ROLE(), quoter));
    }

    /// @dev External calls (`this.`), so `expectRevert` sees the revert one call level down. The checks
    /// run before any role is touched, so the caller does not matter.
    function test_rejectsBadTargets() public {
        address[] memory targets = _targets();
        vm.expectRevert(HandOverAdmin.NewAdminIsZero.selector);
        this.handOver(targets, admin, address(0), false, false);
        vm.expectRevert(HandOverAdmin.NewAdminIsCurrentAdmin.selector);
        this.handOver(targets, admin, admin, false, false);
        vm.expectRevert(abi.encodeWithSelector(HandOverAdmin.NewAdminIsNotAContract.selector, alice));
        this.handOver(targets, admin, alice, false, false);
    }

    function test_anEoaIsAcceptedOnlyWhenAllowed() public {
        address[] memory targets = _targets();
        vm.startPrank(admin);
        assertGt(handOver(targets, admin, alice, false, true), 0);
        vm.stopPrank();
    }
}
