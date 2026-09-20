// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {FeeConfig, OptionType} from "../../src/interfaces/DataTypes.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {LiquidationEngine} from "../../src/perps/LiquidationEngine.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";
import {CrossMarginManager} from "../../src/risk/CrossMarginManager.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPriceFeed} from "../../src/oracle/MockPriceFeed.sol";

/// @dev Cross margin, the insurance fund's shortfall cover, multiple collateral and portfolio margin.
contract CrossMarginTest is BaseTest {
    address internal carol = makeAddr("carol");
    bytes32 internal constant TKB = bytes32("TKB");
    MockERC20 internal tokenB;
    MockPriceFeed internal feedB;

    function setUp() public override {
        super.setUp();
        // Carol has a small account, so a crash can take her under the requirement.
        usdc.mint(carol, 10_000e18);
        vm.startPrank(carol);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(usdc), 1_500e18);
        vm.stopPrank();
    }

    function _open(address user, bool isLong, uint256 collateral, uint256 leverage, bool cross)
        internal
        returns (uint256 positionId)
    {
        vm.prank(user);
        positionId = cross
            ? perpsEngine.openPositionCross(
                NVDA, isLong, collateral, leverage, isLong ? type(uint256).max : 0, block.timestamp + 1 hours
            )
            : perpsEngine.openPosition(
                NVDA, isLong, collateral, leverage, isLong ? type(uint256).max : 0, block.timestamp + 1 hours
            );
    }

    function _fundInsurance(uint256 amount) internal {
        usdc.mint(admin, amount);
        vm.startPrank(admin);
        usdc.approve(address(insuranceFund), amount);
        insuranceFund.deposit(address(usdc), amount);
        vm.stopPrank();
    }

    function _addTokenB(uint16 factorBps) internal {
        feedB = new MockPriceFeed(admin, 18, 10e18);
        tokenB = new MockERC20("Token B", "TKB", 18);
        vm.startPrank(admin);
        oracleRouter.setPrimarySource(TKB, address(feedB), 18);
        collateralManager.addSupportedToken(address(tokenB));
        crossMargin.setCollateralConfig(address(tokenB), factorBps, TKB, true);
        vm.stopPrank();
    }

    function _depositB(address user, uint256 amount) internal {
        tokenB.mint(user, amount);
        vm.startPrank(user);
        tokenB.approve(address(vault), amount);
        vault.deposit(address(tokenB), amount);
        vm.stopPrank();
    }

    // ---- opening and health -------------------------------------------------

    function test_openCross_marksThePositionAndCountsIt() public {
        uint256 positionId = _open(alice, true, 1_000e18, 5, true);
        assertTrue(crossMargin.isCross(positionId));
        assertEq(crossMargin.crossPositionsOf(alice).length, 1);
        assertFalse(crossMargin.isCross(_open(alice, true, 1_000e18, 5, false)), "an ordinary open stays isolated");
    }

    function test_openCross_capsThePositionsPerAccount() public {
        for (uint256 i = 0; i < 10; i++) {
            _open(alice, true, 100e18, 2, true);
        }
        vm.prank(alice);
        vm.expectRevert(CrossMarginManager.TooManyCrossPositions.selector);
        perpsEngine.openPositionCross(NVDA, true, 100e18, 2, type(uint256).max, block.timestamp + 1 hours);
    }

    function test_health_isFreeBalancePlusMarginAndPnlAgainstMaintenance() public {
        _open(alice, true, 1_000e18, 5, true);
        (int256 equity, uint256 requirement) = crossMargin.accountHealth(alice);
        assertEq(equity, 100_000e18, "free 99,000 plus 1,000 of margin");
        assertEq(requirement, 250e18, "5% of the 5,000 notional");

        _setPrice(171e18); // -10%: the long is down 500
        (equity, requirement) = crossMargin.accountHealth(alice);
        assertEq(equity, 100_000e18 - 500e18);
    }

    function test_noCrossPositions_isNeverLiquidatable() public {
        assertFalse(crossMargin.isAccountLiquidatable(alice));
        (int256 equity, uint256 requirement) = crossMargin.accountHealth(alice);
        assertEq(equity, 100_000e18);
        assertEq(requirement, 0);
    }

    // ---- liquidation --------------------------------------------------------

    function test_cross_survivesWhereIsolatedIsLiquidated() public {
        uint256 crossId = _open(alice, true, 1_000e18, 5, true);
        uint256 isolatedId = _open(alice, true, 1_000e18, 5, false);

        _setPrice(150e18); // -21%: 5x on its own margin is long gone
        assertTrue(liquidationEngine.isLiquidatable(isolatedId), "on its own margin it is liquidated");
        assertFalse(liquidationEngine.isLiquidatable(crossId), "the account's 99,000 of free balance backs it");
        vm.prank(keeper);
        vm.expectRevert(LiquidationEngine.PositionNotLiquidatable.selector);
        liquidationEngine.liquidate(crossId);
    }

    function test_cross_isLiquidatableOnceTheAccountFallsUnderTheRequirement() public {
        uint256 positionId = _open(carol, true, 1_000e18, 5, true); // free 500
        _setPrice(150e18); // pnl -1,052: equity 447 > requirement 250
        assertFalse(liquidationEngine.isLiquidatable(positionId));

        _setPrice(142e18); // pnl -1,263: equity 236 < 250
        assertTrue(liquidationEngine.isLiquidatable(positionId));
        assertTrue(crossMargin.isAccountLiquidatable(carol));

        vm.prank(keeper);
        liquidationEngine.liquidate(positionId);
        assertFalse(perpPositionManager.getPosition(positionId).open);
        assertGt(vault.availableBalance(keeper, address(usdc)), 0, "the liquidator is paid");
    }

    function test_cross_liquidatesTheWorstPositionFirst() public {
        uint256 big = _open(carol, true, 500e18, 10, true); // 5,000 notional on 500
        uint256 small = _open(carol, true, 300e18, 5, true); // 1,500 notional on 300
        _setPrice(120e18); // both are deep under water, the 10x one worse

        assertTrue(crossMargin.isAccountLiquidatable(carol));
        assertEq(crossMargin.worstPosition(carol), big);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(LiquidationEngine.NotWorstPosition.selector, big));
        liquidationEngine.liquidate(small);

        vm.prank(keeper);
        liquidationEngine.liquidate(big);
        assertFalse(perpPositionManager.getPosition(big).open);
        assertTrue(perpPositionManager.getPosition(small).open, "the other one is not closed with it");
    }

    // ---- withdrawals --------------------------------------------------------

    function test_withdraw_cannotTakeTheFreeBalanceThatBacksAFallingCrossPosition() public {
        _open(carol, true, 1_000e18, 5, true); // free 500
        _setPrice(160e18); // pnl -789: margin plus pnl is 211, equity 711, requirement 250 (275 with the buffer)

        (int256 equity, uint256 requirement) = crossMargin.accountHealth(carol);
        uint256 required = (requirement * 11_000) / 10_000;
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(CrossMarginManager.WithdrawWouldUndermargin.selector, equity - 440e18, required)
        );
        vault.withdraw(address(usdc), 440e18);

        vm.prank(carol);
        vault.withdraw(address(usdc), 100e18); // equity 611 stays above 275
        assertEq(usdc.balanceOf(carol), 10_000e18 - 1_500e18 + 100e18);
    }

    function test_withdraw_isFreeWithNoCrossPositions() public {
        _open(alice, true, 1_000e18, 10, false); // isolated only
        _setPrice(160e18);
        uint256 free = vault.availableBalance(alice, address(usdc));
        vm.prank(alice);
        vault.withdraw(address(usdc), free);
    }

    // ---- insurance fund -----------------------------------------------------

    function test_shortfall_isPaidByTheInsuranceFund() public {
        _fundInsurance(10_000e18);
        uint256 positionId = _open(carol, true, 1_000e18, 5, true);

        _setPrice(100e18); // pnl = -5,000 * 90 / 190 = -2,368.4: carol holds 1,500
        assertTrue(liquidationEngine.isLiquidatable(positionId));

        uint256 loss = 2_368_421_052_631_578_947_368; // 5,000e18 * 90 / 190, rounded down
        uint256 shortfall = loss - 1_500e18;
        vm.expectEmit(true, true, false, true, address(liquidationEngine));
        emit LiquidationEngine.ShortfallCovered(positionId, carol, shortfall);
        vm.prank(keeper);
        liquidationEngine.liquidate(positionId);

        assertEq(vault.availableBalance(carol, address(usdc)), 0, "carol lost everything");
        assertEq(insuranceFund.balance(address(usdc)), 10_000e18 - shortfall, "the fund paid the rest");
    }

    function test_shortfall_beyondTheFundIsBadDebtAndDoesNotRevert() public {
        _fundInsurance(100e18);
        uint256 positionId = _open(carol, true, 1_000e18, 5, true);
        _setPrice(100e18);

        uint256 shortfall = 2_368_421_052_631_578_947_368 - 1_500e18;
        vm.expectEmit(true, true, false, true, address(liquidationEngine));
        emit LiquidationEngine.ShortfallCovered(positionId, carol, 100e18);
        vm.expectEmit(true, true, false, true, address(liquidationEngine));
        emit LiquidationEngine.BadDebt(positionId, carol, shortfall - 100e18);
        vm.prank(keeper);
        liquidationEngine.liquidate(positionId);
        assertEq(insuranceFund.balance(address(usdc)), 0);
        assertFalse(perpPositionManager.getPosition(positionId).open);
    }

    function test_shortfall_withAnEmptyFundIsAllBadDebt() public {
        uint256 positionId = _open(carol, true, 1_000e18, 5, true);
        _setPrice(100e18);
        vm.expectEmit(true, true, false, true, address(liquidationEngine));
        emit LiquidationEngine.BadDebt(positionId, carol, 2_368_421_052_631_578_947_368 - 1_500e18);
        vm.prank(keeper);
        liquidationEngine.liquidate(positionId);
    }

    function test_isolatedShortfall_isAlsoCoveredNotReverted() public {
        // An isolated position that gaps far past its margin used to revert the liquidation.
        _fundInsurance(10_000e18);
        uint256 positionId = _open(carol, true, 500e18, 10, false); // 5,000 notional on 500, free 1,000
        _setPrice(40e18); // -79%: loss 4,157 vs 1,500 held
        vm.prank(keeper);
        liquidationEngine.liquidate(positionId);
        assertEq(vault.availableBalance(carol, address(usdc)), 0);
        assertLt(insuranceFund.balance(address(usdc)), 10_000e18);
    }

    function test_fund_depositWithdrawAndAccess() public {
        _fundInsurance(1_000e18);
        assertEq(insuranceFund.balance(address(usdc)), 1_000e18);
        vm.prank(bob);
        vm.expectRevert();
        insuranceFund.withdraw(address(usdc), bob, 1e18);
        vm.prank(admin);
        insuranceFund.withdraw(address(usdc), admin, 400e18);
        assertEq(insuranceFund.balance(address(usdc)), 600e18);
    }

    // ---- multiple collateral ------------------------------------------------

    function test_otherCollateral_countsAtAHaircut() public {
        _addTokenB(8_000); // 80% of its oracle value
        _open(carol, true, 1_000e18, 5, true);
        (int256 before,) = crossMargin.accountHealth(carol);
        _depositB(carol, 100e18); // 100 tokens at 10 = 1,000, counted at 80%
        (int256 afterDeposit,) = crossMargin.accountHealth(carol);
        assertEq(afterDeposit - before, 800e18);

        vm.prank(admin); // the token halves: 500 * 80% = 400
        feedB.setPrice(5e18);
        (int256 halved,) = crossMargin.accountHealth(carol);
        assertEq(halved - before, 400e18);
    }

    function test_otherCollateral_keepsAnAccountAliveThatWouldBeLiquidated() public {
        _addTokenB(8_000);
        uint256 positionId = _open(carol, true, 1_000e18, 5, true);
        _setPrice(142e18);
        assertTrue(liquidationEngine.isLiquidatable(positionId), "without the token she is under the requirement");
        _depositB(carol, 100e18); // +800 of counted equity
        assertFalse(liquidationEngine.isLiquidatable(positionId));
    }

    function test_otherCollateral_withdrawIsGuardedToo() public {
        _addTokenB(8_000);
        _open(carol, true, 1_000e18, 5, true);
        _depositB(carol, 10e18); // counted 80
        // Taking the 500 of free settlement balance leaves the account exactly at equity 1,080 - 500... still fine;
        vm.prank(carol);
        vault.withdraw(address(tokenB), 10e18);
        (int256 equity,) = crossMargin.accountHealth(carol);
        assertEq(equity, 1_500e18);
    }

    function test_otherCollateral_isSeizedIntoTheFundToCoverAShortfall() public {
        _addTokenB(8_000);
        _fundInsurance(10_000e18);
        uint256 positionId = _open(carol, true, 1_000e18, 5, true);
        _depositB(carol, 100e18); // worth 800 to the account
        _setPrice(100e18); // loss 2,368: settlement balance 1,500 leaves a shortfall of 868

        uint256 fundBefore = insuranceFund.balance(address(usdc));
        vm.prank(keeper);
        liquidationEngine.liquidate(positionId);

        // The 868 shortfall is worth 868 / 0.8 / 10 = 108.5 tokens; carol only had 100, all of which is seized.
        assertEq(vault.availableBalance(carol, address(tokenB)), 0);
        assertEq(insuranceFund.balance(address(tokenB)), 100e18, "the fund now holds the seized tokens");
        assertEq(
            fundBefore - insuranceFund.balance(address(usdc)),
            2_368_421_052_631_578_947_368 - 1_500e18,
            "and paid the shortfall in settlement tokens"
        );
    }

    function test_otherCollateral_configRules() public {
        _addTokenB(8_000);
        vm.startPrank(admin);
        vm.expectRevert(CrossMarginManager.InvalidFactor.selector);
        crossMargin.setCollateralConfig(address(tokenB), 10_001, TKB, true);
        vm.expectRevert(CrossMarginManager.InvalidFactor.selector);
        crossMargin.setCollateralConfig(address(usdc), 9_000, NVDA, true);
        // Disabling stops it counting.
        crossMargin.setCollateralConfig(address(tokenB), 8_000, TKB, false);
        vm.stopPrank();
        _open(carol, true, 1_000e18, 5, true);
        (int256 before,) = crossMargin.accountHealth(carol);
        _depositB(carol, 100e18);
        (int256 afterDeposit,) = crossMargin.accountHealth(carol);
        assertEq(afterDeposit, before, "a disabled token adds nothing");
        vm.prank(bob);
        vm.expectRevert();
        crossMargin.setCollateralConfig(address(tokenB), 5_000, TKB, true);
    }

    // ---- portfolio margin ---------------------------------------------------

    function _openPut(address user, uint256 contracts) internal returns (uint256 positionId) {
        IOptionsEngine.OpenPositionParams memory params = IOptionsEngine.OpenPositionParams({
            marketId: NVDA,
            optionType: OptionType.PUT,
            strike: 190e18,
            expiry: block.timestamp + 30 days,
            contracts: contracts,
            premium: 10e18,
            deadline: block.timestamp + 1 hours
        });
        IOptionsEngine.Quote memory quote = _openQuote(user, params);
        vm.prank(user);
        positionId = optionsEngine.openPosition(params, quote);
    }

    function test_portfolioMargin_chargesAHedgedBookLessThanTheSumOfItsParts() public {
        _open(alice, true, 1_000e18, 5, true); // 5,000 notional = 26.3 units long
        uint256 putId = _openPut(alice, 27); // 27 units of protection at 190

        (, uint256 standard) = crossMargin.accountHealth(alice);
        assertEq(standard, 250e18);

        vm.startPrank(alice);
        crossMargin.setPortfolioMargin(true);
        crossMargin.addPortfolioOption(putId);
        vm.stopPrank();

        (, uint256 hedged) = crossMargin.accountHealth(alice);
        // The put's gain offsets the long's loss on every downward shock, so the worst case is ~0 and the
        // requirement falls to the floor: 30% of the standard 250.
        assertEq(hedged, 75e18);
        assertLt(hedged, standard);
    }

    function test_portfolioMargin_chargesANakedBookMore() public {
        _open(alice, true, 1_000e18, 5, true);
        vm.prank(alice);
        crossMargin.setPortfolioMargin(true);
        (, uint256 requirement) = crossMargin.accountHealth(alice);
        // The worst shock is -20% on 5,000: a 1,000 loss, well over the standard 250.
        assertApproxEqAbs(requirement, 1_000e18, 2);
        vm.prank(alice);
        crossMargin.setPortfolioMargin(false);
        (, requirement) = crossMargin.accountHealth(alice);
        assertEq(requirement, 250e18);
    }

    function test_portfolioMargin_optionRegistrationRules() public {
        uint256 putId = _openPut(alice, 10);
        vm.prank(bob);
        vm.expectRevert(CrossMarginManager.NotOptionOwner.selector);
        crossMargin.addPortfolioOption(putId);

        vm.startPrank(alice);
        crossMargin.addPortfolioOption(putId);
        vm.expectRevert(CrossMarginManager.AlreadyRegistered.selector);
        crossMargin.addPortfolioOption(putId);
        vm.stopPrank();
        assertEq(crossMargin.portfolioOptionsOf(alice).length, 1);
    }

    function test_portfolioMargin_parametersAreAdminOnlyAndValidated() public {
        int256[] memory shocks = new int256[](2);
        shocks[0] = -3_000;
        shocks[1] = 3_000;
        vm.prank(bob);
        vm.expectRevert();
        crossMargin.setPortfolioParameters(shocks, 5_000);

        vm.startPrank(admin);
        crossMargin.setPortfolioParameters(shocks, 5_000);
        assertEq(crossMargin.portfolioFloorBps(), 5_000);
        shocks[0] = -10_000;
        vm.expectRevert(CrossMarginManager.InvalidShock.selector);
        crossMargin.setPortfolioParameters(shocks, 5_000);
        vm.expectRevert(CrossMarginManager.TooManyShocks.selector);
        crossMargin.setPortfolioParameters(new int256[](0), 5_000);
        vm.stopPrank();
    }
}
