// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OrionisVault} from "../core/OrionisVault.sol";
import {SubaccountFactory} from "./SubaccountFactory.sol";

/// @notice A separate trading account owned by one address (PROJECT_BRIEF.md Section 40,
/// "subaccounts"). It is a small smart-contract wallet: the engines see it as the trader, so its
/// Vault balance, positions, orders and margin are isolated from the owner's main account and from
/// every other subaccount.
///
/// - The OWNER can trade, deposit and withdraw, and can name DELEGATES.
/// - A DELEGATE (a bot, a desk trader) can trade through `execute` and `multicall`, and nothing
///   else: it cannot deposit or withdraw, and can only call targets the factory allows (the
///   engines, never the Vault or a token), so it can never move funds out of the subaccount.
/// - `deposit` and `withdraw` are owner-only and are the only ways money enters or leaves. A
///   withdrawal always goes to the owner.
contract Subaccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    SubaccountFactory public immutable factory;
    address public immutable owner;
    uint256 public immutable index;

    mapping(address => bool) public isDelegate;

    error NotOwner();
    error NotAuthorized();
    error TargetNotAllowed(address target);
    error LengthMismatch();

    event DelegateSet(address indexed delegate, bool allowed);
    event Executed(address indexed caller, address indexed target, bytes4 selector);

    constructor(address owner_, uint256 index_) {
        factory = SubaccountFactory(msg.sender);
        owner = owner_;
        index = index_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setDelegate(address delegate, bool allowed) external onlyOwner {
        isDelegate[delegate] = allowed;
        emit DelegateSet(delegate, allowed);
    }

    /// @notice Calls an allowed engine as this subaccount. Reverts with the target's own error
    /// when the call fails, so a caller sees `InsufficientMargin` and not a generic failure.
    function execute(address target, bytes calldata data) external nonReentrant returns (bytes memory) {
        return _execute(target, data);
    }

    /// @notice Runs several calls in one transaction, all or nothing: how a multi-leg package (a
    /// protective put, a straddle) opens without one leg filling and the other failing.
    function multicall(address[] calldata targets, bytes[] calldata data)
        external
        nonReentrant
        returns (bytes[] memory results)
    {
        if (targets.length != data.length) revert LengthMismatch();
        results = new bytes[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            results[i] = _execute(targets[i], data[i]);
        }
    }

    /// @notice Moves `amount` of `token` from the owner's wallet into this subaccount's Vault
    /// balance. The owner must have approved this subaccount for the token.
    function deposit(address token, uint256 amount) external onlyOwner nonReentrant {
        OrionisVault vault = factory.vault();
        IERC20(token).safeTransferFrom(owner, address(this), amount);
        IERC20(token).forceApprove(address(vault), amount);
        vault.deposit(token, amount);
    }

    /// @notice Withdraws from this subaccount's Vault balance to the owner's wallet.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        factory.vault().withdraw(token, amount);
        IERC20(token).safeTransfer(owner, amount);
    }

    function _execute(address target, bytes calldata data) internal returns (bytes memory) {
        if (msg.sender != owner && !isDelegate[msg.sender]) revert NotAuthorized();
        if (!factory.allowedTargets(target)) revert TargetNotAllowed(target);

        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        emit Executed(msg.sender, target, data.length >= 4 ? bytes4(data[:4]) : bytes4(0));
        return result;
    }
}
