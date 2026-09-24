// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice The empty implementation every proxy points at for a moment during the first deployment.
/// The real implementations read the other contracts' proxy addresses as immutables, so the proxies
/// must exist before the implementations do. `DeployAll` creates each proxy on this contract, deploys
/// the real implementations, then upgrades each proxy with `upgradeToAndCall`.
///
/// It keeps its owner in a hashed slot, never slot 0, so the leftover value cannot collide with a
/// state variable of the real implementation.
contract UpgradePlaceholder is UUPSUpgradeable {
    bytes32 private constant OWNER_SLOT = keccak256("alphamarkets.placeholder.owner");

    error AlreadyOwned();
    error NotOwner();
    error ZeroAddress();

    /// @notice Called once, from the proxy constructor, to set the address allowed to upgrade.
    function setOwner(address owner_) external {
        if (owner_ == address(0)) revert ZeroAddress();
        if (_owner() != address(0)) revert AlreadyOwned();
        _setOwner(owner_);
    }

    function _authorizeUpgrade(address) internal view override {
        if (msg.sender != _owner()) revert NotOwner();
    }

    function _owner() private view returns (address owner_) {
        bytes32 slot = OWNER_SLOT;
        assembly {
            owner_ := sload(slot)
        }
    }

    function _setOwner(address owner_) private {
        bytes32 slot = OWNER_SLOT;
        assembly {
            sstore(slot, owner_)
        }
    }
}
