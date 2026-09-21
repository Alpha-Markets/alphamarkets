// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console} from "forge-std/console.sol";

import {StackScript} from "./utils/StackScript.sol";

/// @notice Ships a contract change to a network that is already deployed, without changing any address
/// and without losing any state. It reads the proxy addresses from `deployments/<network>.json`,
/// deploys a fresh implementation of every contract, and points each proxy at its new implementation.
/// No `initialize` runs, so balances, positions and roles stay as they are. Clients keep the same
/// addresses, so `packages/config` needs no change.
///
/// The caller must hold `DEFAULT_ADMIN_ROLE` on every proxy: the deployer key until
/// `HandOverAdmin.s.sol` runs, then the multisig or timelock (upgrade with that instead).
///
/// A change is safe to ship this way only if it keeps the storage layout: append state variables, never
/// reorder, remove or retype one. CI checks it (see `storage-layouts/`). A change that cannot keep the
/// layout needs `DeployAll.s.sol` and a fresh set of addresses.
///
/// Usage:
///   PRIVATE_KEY=0x... NETWORK_NAME=robinhood_testnet forge script script/UpgradeAll.s.sol \
///     --rpc-url robinhood_testnet --broadcast
/// Then verify the new implementations with `script/verify.sh`.
contract UpgradeAll is StackScript {
    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        string memory network = _network("robinhood_testnet");
        Stack memory s = _readStack(network);

        if (deployerKey == 0) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        Impls memory impls = _deployImpls(s);
        _upgradeAll(s, impls);

        vm.stopBroadcast();

        _writeImplementationsFile(impls, network);
        console.log("Upgraded 20 proxies on", network);
        console.log("Vault implementation:", impls.vault);
    }
}
