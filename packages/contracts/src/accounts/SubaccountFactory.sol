// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AlphaMarketsVault} from "../core/AlphaMarketsVault.sol";
import {Subaccount} from "./Subaccount.sol";

/// @notice Creates subaccounts (PROJECT_BRIEF.md Section 40) at deterministic addresses and keeps
/// the list of contracts a subaccount may call. That list is what stops a delegate, or a
/// mistaken call, from touching the Vault or a token from inside a subaccount: only the trading
/// engines belong on it.
contract SubaccountFactory is AccessControl {
    bytes32 public constant TARGET_ADMIN_ROLE = keccak256("TARGET_ADMIN_ROLE");

    AlphaMarketsVault public immutable vault;

    mapping(address => bool) public allowedTargets;
    mapping(address => address[]) private _subaccounts;

    error AlreadyExists(address subaccount);
    error ZeroAddress();

    event SubaccountCreated(address indexed owner, uint256 indexed index, address subaccount);
    event TargetAllowed(address indexed target, bool allowed);

    constructor(address admin, address vault_) {
        if (admin == address(0) || vault_ == address(0)) revert ZeroAddress();
        vault = AlphaMarketsVault(vault_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TARGET_ADMIN_ROLE, admin);
    }

    function setTargetAllowed(address target, bool allowed) external onlyRole(TARGET_ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress();
        // The Vault holds the money and a token could be `approve`d away: neither is ever a target.
        require(target != address(vault), "the vault is not a valid target");
        allowedTargets[target] = allowed;
        emit TargetAllowed(target, allowed);
    }

    /// @notice Creates the caller's subaccount number `index`. The address depends only on the
    /// owner and the index, so it can be computed, and funded, before it exists.
    function createSubaccount(uint256 index) external returns (address account) {
        address predicted = computeAddress(msg.sender, index);
        if (predicted.code.length != 0) revert AlreadyExists(predicted);

        account = address(new Subaccount{salt: _salt(msg.sender, index)}(msg.sender, index));
        _subaccounts[msg.sender].push(account);
        emit SubaccountCreated(msg.sender, index, account);
    }

    function computeAddress(address owner, uint256 index) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                _salt(owner, index),
                keccak256(abi.encodePacked(type(Subaccount).creationCode, abi.encode(owner, index)))
            )
        );
        return address(uint160(uint256(hash)));
    }

    function subaccountsOf(address owner) external view returns (address[] memory) {
        return _subaccounts[owner];
    }

    function _salt(address owner, uint256 index) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, index));
    }
}
