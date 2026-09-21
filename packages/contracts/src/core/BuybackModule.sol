// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";

/// @notice Minimal stub: receives a configurable share of protocol fees from FeeManager and
/// accrues it for a future buyback. The real swap/execution mechanism is deferred — this
/// contract's job in Phase 1 is only to prove the fee-routing wiring, and to give Phase 2/3
/// a clean seam for a real DEX integration (PROJECT_BRIEF.md Section 21).
///
/// `protocolToken` is env-driven (`NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS`) and may be
/// `address(0)` pre-TGE — the ticker/address must never be hardcoded.
contract BuybackModule is UpgradeableBase {
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant BUYBACK_ADMIN_ROLE = keccak256("BUYBACK_ADMIN_ROLE");

    address public protocolToken;
    mapping(address => uint256) public accruedForBuyback;

    error ProtocolTokenNotSet();
    error ZeroAddress();

    event FeesNotified(address indexed token, uint256 amount);
    event BuybackExecuted(address indexed token, uint256 amountIn, uint256 amountOut);
    event ProtocolTokenUpdated(address indexed protocolToken);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert ZeroAddress();
        __UpgradeableBase_init(admin);
        _grantRole(BUYBACK_ADMIN_ROLE, admin);
    }

    function setProtocolToken(address token) external onlyRole(BUYBACK_ADMIN_ROLE) {
        protocolToken = token;
        emit ProtocolTokenUpdated(token);
    }

    /// @notice Called by FeeManager after it has already transferred `amount` of `token`
    /// to this contract. Accrues the balance; MVP does not execute a swap automatically.
    function notifyFees(address token, uint256 amount) external onlyRole(FEE_MANAGER_ROLE) {
        accruedForBuyback[token] += amount;
        emit FeesNotified(token, amount);
    }

    /// @notice Hook point for a real DEX integration in Phase 2/3. MVP stub reverts until a
    /// protocol token exists (no TGE yet) — swap logic itself is intentionally not built.
    function executeBuyback(
        uint256,
        /* amount */
        bytes calldata /* swapData */
    )
        external
        view
        onlyRole(BUYBACK_ADMIN_ROLE)
    {
        if (protocolToken == address(0)) revert ProtocolTokenNotSet();
        // Real swap execution deferred to Phase 2/3 — see BuybackModule contract docs.
    }
}
