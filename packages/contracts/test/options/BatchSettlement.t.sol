// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {OptionsEngine} from "../../src/options/OptionsEngine.sol";
import {OptionPositionManager} from "../../src/options/OptionPositionManager.sol";
import {OptionType} from "../../src/interfaces/DataTypes.sol";

/// @notice A series with many positions is settled in bounded batches, and each holder can settle their own
/// position at once, so a large series can never make settlement run out of gas.
contract BatchSettlementTest is BaseTest {
    uint256 internal constant STRIKE = 190e18;
    uint256 internal expiry;
    bytes32 internal seriesId;

    function setUp() public override {
        super.setUp();
        expiry = block.timestamp + 7 days;
    }

    function _openN(uint256 count) internal returns (uint256[] memory ids) {
        ids = new uint256[](count);
        for (uint256 i; i < count; i++) {
            IOptionsEngine.OpenPositionParams memory p = IOptionsEngine.OpenPositionParams({
                marketId: NVDA,
                optionType: OptionType.CALL,
                strike: STRIKE,
                expiry: expiry,
                contracts: 1,
                premium: 5e18,
                deadline: block.timestamp + 1 hours
            });
            IOptionsEngine.Quote memory quote = _openQuote(alice, p);
            vm.prank(alice);
            ids[i] = optionsEngine.openPosition(p, quote);
        }
        seriesId = optionMarket.seriesId(NVDA, expiry, STRIKE, OptionType.CALL);
    }

    function _expire(uint256 price) internal {
        vm.warp(expiry);
        _setPrice(price);
    }

    function _status(uint256 id) internal view returns (OptionPositionManager.PositionStatus) {
        return optionPositionManager.getPosition(id).status;
    }

    function _settledCount(uint256[] memory ids) internal view returns (uint256 n) {
        for (uint256 i; i < ids.length; i++) {
            if (_status(ids[i]) == OptionPositionManager.PositionStatus.SETTLED) n++;
        }
    }

    function test_smallSeries_settlesInOneCall() public {
        uint256[] memory ids = _openN(7);
        _expire(210e18);
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        assertEq(_settledCount(ids), 7);
        assertEq(optionsEngine.settleCursor(seriesId), 7);
    }

    function test_largeSeries_isSettledInBoundedBatches() public {
        uint256[] memory ids = _openN(120);
        _expire(210e18);
        uint256 batch = optionsEngine.DEFAULT_SETTLE_BATCH();
        assertEq(batch, 50);

        uint256 gasBefore = gasleft();
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        uint256 batchGas = gasBefore - gasleft();
        emit log_named_uint("gas for one 50-position batch", batchGas);
        assertLt(batchGas, 20_000_000, "a batch must stay well inside a block");
        assertEq(_settledCount(ids), 50, "one call settles one batch");
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        assertEq(_settledCount(ids), 100);
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        assertEq(_settledCount(ids), 120, "the third call finishes the series");
        assertEq(optionsEngine.settleCursor(seriesId), 120);
    }

    function test_customBatchSize_andProgress() public {
        uint256[] memory ids = _openN(7);
        _expire(210e18);
        optionsEngine.settleExpiredBatch(NVDA, expiry, STRIKE, OptionType.CALL, 3);
        assertEq(optionsEngine.settleCursor(seriesId), 3);
        assertEq(_settledCount(ids), 3);
        optionsEngine.settleExpiredBatch(NVDA, expiry, STRIKE, OptionType.CALL, 3);
        optionsEngine.settleExpiredBatch(NVDA, expiry, STRIKE, OptionType.CALL, 3);
        assertEq(_settledCount(ids), 7);
        assertEq(optionPositionManager.seriesPositionCount(seriesId), 7);
    }

    function test_batchingPaysTheSameAsOneCall() public {
        uint256[] memory ids = _openN(6);
        uint256 before = vault.availableBalance(alice, address(usdc));
        _expire(210e18); // in the money by 20 per contract
        optionsEngine.settleExpiredBatch(NVDA, expiry, STRIKE, OptionType.CALL, 2);
        optionsEngine.settleExpiredBatch(NVDA, expiry, STRIKE, OptionType.CALL, 2);
        optionsEngine.settleExpiredBatch(NVDA, expiry, STRIKE, OptionType.CALL, 2);
        assertEq(_settledCount(ids), 6);
        // Six payouts of 20, each less the settlement fee (none is configured in the test base).
        assertEq(vault.availableBalance(alice, address(usdc)), before + 6 * 20e18);
    }

    function test_callingAgainAfterTheSeriesIsDone_doesNothing() public {
        _openN(3);
        _expire(210e18);
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        uint256 balance = vault.availableBalance(alice, address(usdc));
        vm.recordLogs();
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        assertEq(vm.getRecordedLogs().length, 0, "no event, no payout");
        assertEq(vault.availableBalance(alice, address(usdc)), balance);
    }

    function test_aHolderCanSettleTheirOwnPositionAtOnce_andItIsNotPaidTwice() public {
        uint256[] memory ids = _openN(120);
        _expire(210e18);
        uint256 last = ids[119];
        uint256 before = vault.availableBalance(alice, address(usdc));

        optionsEngine.settlePosition(last); // the 120th, well beyond the first batch
        assertEq(uint256(_status(last)), uint256(OptionPositionManager.PositionStatus.SETTLED));
        assertEq(vault.availableBalance(alice, address(usdc)), before + 20e18);

        // Finish the series by batches: the position settled early is skipped, not paid again.
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        assertEq(_settledCount(ids), 120);
        assertEq(vault.availableBalance(alice, address(usdc)), before + 120 * 20e18, "each paid exactly once");
    }

    function test_settlePosition_beforeExpiry_reverts() public {
        uint256[] memory ids = _openN(1);
        vm.expectRevert(OptionsEngine.PositionNotExpired.selector);
        optionsEngine.settlePosition(ids[0]);
    }

    function test_zeroBatch_reverts() public {
        _openN(1);
        _expire(210e18);
        vm.expectRevert(OptionsEngine.ZeroBatch.selector);
        optionsEngine.settleExpiredBatch(NVDA, expiry, STRIKE, OptionType.CALL, 0);
    }

    function test_settledOutOfTheMoney_paysNothing_andClosesOpenInterest() public {
        uint256[] memory ids = _openN(4);
        _expire(150e18); // the call expires worthless
        optionsEngine.settleExpired(NVDA, expiry, STRIKE, OptionType.CALL);
        assertEq(_settledCount(ids), 4);
        assertEq(riskManager.openInterestLong(NVDA), 0, "open interest is released");
    }
}
