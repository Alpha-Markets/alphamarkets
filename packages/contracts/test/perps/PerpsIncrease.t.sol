// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {FeeConfig} from "../../src/interfaces/DataTypes.sol";
import {PerpsEngine} from "../../src/perps/PerpsEngine.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {RiskManager} from "../../src/risk/RiskManager.sol";
import {SlippageExceeded, DeadlineExpired} from "../../src/interfaces/Errors.sol";

/// @dev Covers `PerpsEngine.increasePosition`, which shipped in 1.1.0-testnet without the taker fee
/// or a leverage check (packages/contracts/CHANGELOG.md, "Known issue").
contract PerpsIncreaseTest is BaseTest {
    uint256 internal constant TAKER_BPS = 10; // 0.10%

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        feeManager.setFeeConfig(
            NVDA,
            FeeConfig({
                makerFee: 0,
                takerFee: TAKER_BPS,
                optionOpenFee: 0,
                optionCloseFee: 0,
                settlementFee: 0,
                liquidationFee: 0
            })
        );
    }

    function _open(address user, uint256 collateral, uint256 leverage) internal returns (uint256 positionId) {
        vm.prank(user);
        positionId =
            perpsEngine.openPosition(NVDA, true, collateral, leverage, type(uint256).max, block.timestamp + 1 hours);
    }

    function _increase(address user, uint256 positionId, uint256 addCollateral, uint256 addSize) internal {
        vm.prank(user);
        perpsEngine.increasePosition(positionId, addCollateral, addSize, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_increase_chargesTakerFeeOnAddedSize() public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        uint256 before = vault.availableBalance(alice, address(usdc));

        vm.expectEmit(true, true, false, true, address(feeManager));
        emit ProtocolFeeCollected(NVDA, alice, address(usdc), 2e18, "TAKER");
        _increase(alice, positionId, 400e18, 2_000e18);

        // 400 of margin locked plus a 0.10% fee on the 2,000 added: 2.
        assertEq(before - vault.availableBalance(alice, address(usdc)), 402e18);
        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
        assertEq(pos.size, 7_000e18);
        assertEq(pos.collateral, 1_400e18);
    }

    function test_increase_revertsWhenResultingLeverageAboveMax() public {
        uint256 positionId = _open(alice, 1_000e18, 10);
        // Adding size with no margin would take 10x to 15x.
        vm.prank(alice);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        perpsEngine.increasePosition(positionId, 0, 5_000e18, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_increase_marginPlusSizeAtCeilingIsAllowed() public {
        uint256 positionId = _open(alice, 1_000e18, 10);
        _increase(alice, positionId, 500e18, 5_000e18); // 15,000 / 1,500 = exactly 10x
        assertEq(perpPositionManager.getPosition(positionId).size, 15_000e18);
    }

    function test_increase_oldBypassNoLongerWorks() public {
        // 1.1.0-testnet let a $100-margin position grow to the size cap with no margin at all.
        uint256 positionId = _open(alice, 100e18, 1);
        vm.prank(alice);
        vm.expectRevert(RiskManager.PositionLimitExceeded.selector);
        perpsEngine.increasePosition(positionId, 0, 400_000e18, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_increase_revertsWhenFeeNotCovered() public {
        // Everything but 1 wei is locked as margin, so the fee cannot be paid.
        vm.prank(bob);
        vault.withdraw(address(usdc), 100_000e18 - 1_000e18);
        uint256 positionId = _open(bob, 500e18, 2);
        uint256 available = vault.availableBalance(bob, address(usdc));
        vm.prank(bob);
        vm.expectRevert(PerpsEngine.InsufficientCollateral.selector);
        perpsEngine.increasePosition(positionId, available, 100e18, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_increase_marginOnlyChargesNoFeeAndLowersLeverage() public {
        uint256 positionId = _open(alice, 1_000e18, 10);
        uint256 before = vault.availableBalance(alice, address(usdc));
        _increase(alice, positionId, 1_000e18, 0);
        assertEq(before - vault.availableBalance(alice, address(usdc)), 1_000e18);
        assertEq(perpPositionManager.getPosition(positionId).collateral, 2_000e18);
    }

    function test_increase_nothingToAddReverts() public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        vm.prank(alice);
        vm.expectRevert(PerpsEngine.ZeroAmount.selector);
        perpsEngine.increasePosition(positionId, 0, 0, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_increase_onlyOwner() public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        vm.prank(bob);
        vm.expectRevert(PerpsEngine.NotPositionOwner.selector);
        perpsEngine.increasePosition(positionId, 100e18, 100e18, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_increase_closedPositionReverts() public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        vm.prank(alice);
        perpsEngine.closePosition(positionId, 0, block.timestamp + 1 hours);
        vm.prank(alice);
        vm.expectRevert(PerpsEngine.PositionNotOpen.selector);
        perpsEngine.increasePosition(positionId, 100e18, 100e18, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_increase_pausedMarketReverts() public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        vm.prank(admin);
        marketRegistry.setActive(NVDA, false);
        vm.prank(alice);
        vm.expectRevert();
        perpsEngine.increasePosition(positionId, 100e18, 100e18, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_increase_expiredDeadlineReverts() public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DeadlineExpired.selector, block.timestamp - 1, block.timestamp));
        perpsEngine.increasePosition(positionId, 100e18, 100e18, type(uint256).max, block.timestamp - 1);
    }

    function test_increase_slippageBoundReverts() public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        _setPrice(200e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SlippageExceeded.selector, 195e18, 200e18));
        perpsEngine.increasePosition(positionId, 100e18, 100e18, 195e18, block.timestamp + 1 hours);
    }

    function test_increase_setsWeightedEntryAndOpenInterest() public {
        uint256 positionId = _open(alice, 1_000e18, 5); // 5,000 at 190
        _setPrice(200e18);
        _increase(alice, positionId, 1_000e18, 5_000e18); // +5,000 at 200
        assertEq(perpPositionManager.getPosition(positionId).entryPrice, 195e18);
        assertEq(riskManager.openInterestLong(NVDA), 10_000e18);
    }

    function test_increase_recordsLastPrice() public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        _setPrice(200e18);
        _increase(alice, positionId, 1_000e18, 5_000e18);
        (uint256 last,) = oracleRouter.getLastPrice(NVDA);
        assertEq(last, 200e18);
    }

    function test_increase_openInterestCapReverts() public {
        vm.startPrank(admin);
        RiskManager.RiskConfig memory config = riskManager.getRiskConfig(NVDA);
        config.openInterestCap = 6_000e18;
        riskManager.setRiskConfig(NVDA, config);
        vm.stopPrank();

        uint256 positionId = _open(alice, 1_000e18, 5);
        vm.prank(alice);
        vm.expectRevert(RiskManager.OpenInterestLimitExceeded.selector);
        perpsEngine.increasePosition(positionId, 200e18, 2_000e18, type(uint256).max, block.timestamp + 1 hours);
    }

    /// Whatever is added, a position never ends up above the leverage ceiling, and every unit of
    /// added size pays the fee.
    function testFuzz_increase_leverageCeilingAndFee(uint256 addCollateral, uint256 addSize) public {
        uint256 positionId = _open(alice, 1_000e18, 5);
        addCollateral = bound(addCollateral, 0, 20_000e18);
        addSize = bound(addSize, 0, 100_000e18);
        if (addCollateral == 0 && addSize == 0) return;

        uint256 before = vault.availableBalance(alice, address(usdc));
        vm.prank(alice);
        try perpsEngine.increasePosition(
            positionId, addCollateral, addSize, type(uint256).max, block.timestamp + 1 hours
        ) {
            PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionId);
            assertLe(pos.size, pos.collateral * 10, "leverage above the ceiling");
            assertEq(
                before - vault.availableBalance(alice, address(usdc)), addCollateral + (addSize * TAKER_BPS) / 10_000
            );
        } catch {
            // A rejected increase must leave the position and balance alone.
            assertEq(perpPositionManager.getPosition(positionId).size, 5_000e18);
            assertEq(vault.availableBalance(alice, address(usdc)), before);
        }
    }

    event ProtocolFeeCollected(
        bytes32 indexed marketId, address indexed payer, address token, uint256 amount, bytes32 feeType
    );
}
