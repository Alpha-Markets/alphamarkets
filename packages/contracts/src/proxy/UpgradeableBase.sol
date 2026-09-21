// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/// @notice Shared base of every protocol contract, which lives behind an ERC-1967 proxy so its address
/// survives a redeploy. It supplies role-based access control and the UUPS upgrade path, and only
/// `DEFAULT_ADMIN_ROLE` (the role `HandOverAdmin.s.sol` moves to a multisig) may upgrade.
///
/// A contract built on it keeps its `immutable` dependencies in the constructor, which also calls
/// `_disableInitializers()`, and does all storage writes in an `initializer` function that calls
/// `__UpgradeableBase_init`. Immutables sit in the implementation's bytecode, so they work through the
/// proxy; they point at other proxies, whose addresses never change.
///
/// Upgrade rules: never reorder, remove or retype a state variable, only append. CI compares the
/// storage layout with `storage-layouts/` to enforce it.
abstract contract UpgradeableBase is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    function __UpgradeableBase_init(address admin) internal onlyInitializing {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
