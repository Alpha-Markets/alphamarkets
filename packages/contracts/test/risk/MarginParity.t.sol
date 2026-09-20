// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MarginEngine} from "../../src/risk/MarginEngine.sol";

/// @dev The web app shows liquidation price, PnL and margin ratio from the SDK's bigint mirror of
/// `MarginEngine` (`packages/sdk/src/math.ts`). The contract stays the source of truth, so both
/// sides run the same vectors from `test/vectors/margin.json`; `packages/sdk/src/math.test.ts` reads
/// the same file. If the two formulas drift, one of the two suites fails.
contract MarginParityTest is Test {
    string internal vectors;

    function setUp() public {
        vectors = vm.readFile("test/vectors/margin.json");
    }

    /// @dev Number of vectors under `group`, and the JSON path of the `field` of vector `i`. Fields are
    /// read one at a time: a struct decode would turn a numeric-looking string into a number.
    function _count(string memory group) internal view returns (uint256 n) {
        while (vm.keyExistsJson(vectors, _path(group, n, "name"))) n++;
        assertGt(n, 0);
    }

    function _path(string memory group, uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".", group, "[", vm.toString(i), "].", field);
    }

    function _str(string memory group, uint256 i, string memory field) internal view returns (string memory) {
        return vm.parseJsonString(vectors, _path(group, i, field));
    }

    function _uint(string memory group, uint256 i, string memory field) internal view returns (uint256) {
        return vm.parseUint(_str(group, i, field));
    }

    function _int(string memory group, uint256 i, string memory field) internal view returns (int256) {
        return vm.parseInt(_str(group, i, field));
    }

    function _bool(string memory group, uint256 i, string memory field) internal view returns (bool) {
        return vm.parseJsonBool(vectors, _path(group, i, field));
    }

    function test_liquidationPriceMatchesTheSharedVectors() public view {
        string memory g = "liquidationPrice";
        uint256 n = _count(g);
        for (uint256 i = 0; i < n; i++) {
            uint256 actual = MarginEngine.liquidationPrice(
                _bool(g, i, "isLong"),
                _uint(g, i, "entry"),
                _uint(g, i, "collateral"),
                _uint(g, i, "size"),
                _uint(g, i, "maintenanceBps")
            );
            assertEq(actual, _uint(g, i, "expected"), _str(g, i, "name"));
        }
    }

    function test_unrealizedPnlMatchesTheSharedVectors() public view {
        string memory g = "unrealizedPnl";
        uint256 n = _count(g);
        for (uint256 i = 0; i < n; i++) {
            int256 actual = MarginEngine.unrealizedPnl(
                _bool(g, i, "isLong"), _uint(g, i, "entry"), _uint(g, i, "mark"), _uint(g, i, "size")
            );
            assertEq(actual, _int(g, i, "expected"), _str(g, i, "name"));
        }
    }

    function test_marginRatioMatchesTheSharedVectors() public view {
        string memory g = "marginRatioBps";
        uint256 n = _count(g);
        for (uint256 i = 0; i < n; i++) {
            uint256 actual =
                MarginEngine.marginRatio(_uint(g, i, "collateral"), _int(g, i, "pnl"), _uint(g, i, "notional"));
            assertEq(actual, _uint(g, i, "expected"), _str(g, i, "name"));
        }
    }
}
