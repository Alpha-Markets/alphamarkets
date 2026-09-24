// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {PerpPositionManager} from "../../src/perps/PerpPositionManager.sol";

/// @notice Drives random perp opens, closes, liquidations and price moves against the full stack and
/// keeps a ghost record of every position id, so the invariants below can be checked against the
/// contracts' own accounting without trusting it.
contract PerpsHandler is BaseTest {
    address[] internal actors;
    uint256[] public positionIds;
    uint256 public liquidations;
    uint256 public opens;

    constructor() {
        BaseTest.setUp();
        actors.push(alice);
        actors.push(bob);
    }

    /// @dev A small pool, so random profits reach its limit and the solvency guard is exercised: a winner
    /// that the pool cannot pay reverts, and the invariants below must still hold.
    function _poolSeed() internal pure override returns (uint256) {
        return 100;
    }

    /// @dev The test contract below calls this instead of `setUp` so the handler owns the deployment.
    function setUp() public override {}

    function open(uint256 actorSeed, bool isLong, uint256 collateral, uint256 tierSeed) external {
        address actor = actors[actorSeed % actors.length];
        collateral = bound(collateral, 10e18, 5_000e18);
        uint256[5] memory tiers = [uint256(1), 2, 3, 5, 10];
        uint256 leverage = tiers[tierSeed % 5];
        vm.prank(actor);
        try perpsEngine.openPosition(
            NVDA, isLong, collateral, leverage, isLong ? type(uint256).max : 0, block.timestamp + 1 hours
        ) returns (
            uint256 id
        ) {
            positionIds.push(id);
            opens++;
        } catch {}
    }

    function close(uint256 idSeed) external {
        if (positionIds.length == 0) return;
        uint256 id = positionIds[idSeed % positionIds.length];
        PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(id);
        if (!pos.open) return;
        vm.prank(pos.owner);
        try perpsEngine.closePosition(id, pos.isLong ? 0 : type(uint256).max, block.timestamp + 1 hours) {} catch {}
    }

    function liquidate(uint256 idSeed) external {
        if (positionIds.length == 0) return;
        uint256 id = positionIds[idSeed % positionIds.length];
        vm.prank(keeper);
        try liquidationEngine.liquidate(id) {
            liquidations++;
        } catch {}
    }

    function movePrice(uint256 newPrice, uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 10 minutes));
        _setPrice(bound(newPrice, 60e18, 400e18));
    }

    /// @dev Everything the invariants read, exposed here because BaseTest keeps the stack internal.
    function openInterest()
        external
        view
        returns (uint256 longs, uint256 shorts, uint256 recordedLong, uint256 recordedShort)
    {
        for (uint256 i; i < positionIds.length; i++) {
            PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionIds[i]);
            if (!pos.open) continue;
            if (pos.isLong) longs += pos.size;
            else shorts += pos.size;
        }
        recordedLong = riskManager.openInterestLong(NVDA);
        recordedShort = riskManager.openInterestShort(NVDA);
    }

    function malformedOpenPositions() external view returns (uint256 bad) {
        for (uint256 i; i < positionIds.length; i++) {
            PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionIds[i]);
            if (pos.open && (pos.size == 0 || pos.collateral == 0)) bad++;
        }
    }

    /// @return ledger Available balance of every tracked account plus margin locked in open positions.
    /// @return tokens Settlement token the vault actually holds.
    function solvency() external view returns (uint256 ledger, uint256 tokens) {
        address token = address(usdc);
        ledger = vault.availableBalance(keeper, token) + vault.availableBalance(address(insuranceFund), token);
        for (uint256 a; a < actors.length; a++) {
            ledger += vault.availableBalance(actors[a], token);
        }
        for (uint256 i; i < positionIds.length; i++) {
            PerpPositionManager.PerpPosition memory pos = perpPositionManager.getPosition(positionIds[i]);
            if (pos.open) ledger += pos.collateral;
        }
        tokens = usdc.balanceOf(address(vault));
    }

    /// @return liabilities_ The vault's own count of what it owes.
    /// @return ledger The sum of the ledger balances of every account that can hold one in this run.
    function liabilities() external view returns (uint256 liabilities_, uint256 ledger) {
        address token = address(usdc);
        liabilities_ = vault.totalLiabilities(token);
        ledger = collateralManager.balanceOf(keeper, token) + collateralManager.balanceOf(address(insuranceFund), token);
        for (uint256 a; a < actors.length; a++) {
            ledger += collateralManager.balanceOf(actors[a], token);
        }
    }

    function totalOpenInterestCap() external view returns (uint256) {
        return riskManager.getRiskConfig(NVDA).openInterestCap;
    }
}

contract PerpsInvariantTest is StdInvariant, Test {
    PerpsHandler internal handler;

    function setUp() public {
        handler = new PerpsHandler();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = PerpsHandler.open.selector;
        selectors[1] = PerpsHandler.close.selector;
        selectors[2] = PerpsHandler.liquidate.selector;
        selectors[3] = PerpsHandler.movePrice.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// Open interest in RiskManager equals the summed size of open positions, per side.
    function invariant_openInterestMatchesOpenPositions() public view {
        (uint256 longs, uint256 shorts, uint256 recordedLong, uint256 recordedShort) = handler.openInterest();
        assertEq(recordedLong, longs, "long OI drifted");
        assertEq(recordedShort, shorts, "short OI drifted");
    }

    /// Open interest never exceeds the market cap.
    function invariant_openInterestUnderCap() public view {
        (,, uint256 recordedLong, uint256 recordedShort) = handler.openInterest();
        assertLe(recordedLong + recordedShort, handler.totalOpenInterestCap(), "OI above cap");
    }

    /// An open position always has size and margin.
    function invariant_openPositionsAreWellFormed() public view {
        assertEq(handler.malformedOpenPositions(), 0, "open position with zero size or margin");
    }

    /// Solvency: the token the vault holds covers every tracked ledger balance plus locked margin, however
    /// the profits and losses fall. The vault refuses a profit credit that the pool cannot pay
    /// (`InsufficientPoolReserves`), which is what keeps this true.
    function invariant_vaultTokensCoverLedger() public view {
        (uint256 ledger, uint256 tokens) = handler.solvency();
        assertLe(ledger, tokens, "ledger exceeds tokens held");
    }

    /// The vault's own count of what it owes equals the sum of the ledger balances, so the solvency check
    /// above compares against a true figure.
    function invariant_liabilitiesMatchTheLedger() public view {
        (uint256 liabilities, uint256 ledger) = handler.liabilities();
        assertEq(liabilities, ledger, "liabilities counter drifted from the ledger");
    }
}
