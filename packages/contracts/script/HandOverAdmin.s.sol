// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Moves every administrative role from the deployer key to a multisig or timelock
/// (PROJECT_BRIEF.md Section 37), so no protocol parameter, oracle source or collateral rule
/// depends on one EOA.
///
/// It moves the DEFAULT_ADMIN_ROLE and every `*_ADMIN_ROLE` on the AccessControl contracts. It does
/// not touch the operational roles: `ENGINE_ROLE`, `VAULT_ROLE`, `FEE_MANAGER_ROLE` and
/// `LIQUIDATOR_ROLE` belong to contracts, and `QUOTER_ROLE` (OptionsEngine) and `MAKER_ROLE`
/// (RFQManager) belong to service keys that the new admin rotates with `grantRole` / `revokeRole`.
/// `PerpsEngine` has no admin: its deployer only wires the RFQ manager once, during deployment.
///
/// Two runs, on purpose. The first grants and keeps the deployer's roles, so nothing is lost if the
/// new admin address is wrong:
///   NEW_ADMIN=0x... forge script script/HandOverAdmin.s.sol --rpc-url robinhood_testnet --broadcast
/// Prove that the new admin can execute an admin call, then run it again with `RENOUNCE=true` to
/// revoke the deployer:
///   NEW_ADMIN=0x... RENOUNCE=true forge script script/HandOverAdmin.s.sol --rpc-url robinhood_testnet --broadcast
///
/// Environment: `PRIVATE_KEY` (the current admin), `NEW_ADMIN`, `NETWORK_NAME` (default
/// `robinhood_testnet`, selects `deployments/<network>.json`), `RENOUNCE` (default false), and
/// `ALLOW_EOA=true` to accept a `NEW_ADMIN` without code (a local run only: it defeats the purpose).
///
/// When a contract gains a new `*_ADMIN_ROLE`, add its name to `_adminRoles()`.
contract HandOverAdmin is Script {
    error NewAdminIsZero();
    error NewAdminIsCurrentAdmin();
    error NewAdminIsNotAContract(address newAdmin);
    error NewAdminMissingRole(address target, bytes32 role);

    /// @dev Keys of the AccessControl contracts in `deployments/<network>.json`.
    function _targetKeys() internal pure returns (string[18] memory keys) {
        keys = [
            "marketRegistry",
            "collateralManager",
            "vault",
            "feeManager",
            "buybackModule",
            "priceValidator",
            "oracleRouter",
            "riskManager",
            "optionPositionManager",
            "optionMarket",
            "optionsEngine",
            "perpPositionManager",
            "perpOrderManager",
            "fundingManager",
            "insuranceFund",
            "crossMargin",
            "subaccountFactory",
            "rfqManager"
        ];
    }

    /// @dev The DEFAULT_ADMIN_ROLE is last, so it is revoked last: it is the role that can grant the others.
    function _adminRoles() internal pure returns (bytes32[] memory roles) {
        roles = new bytes32[](10);
        roles[0] = keccak256("MARKET_ADMIN_ROLE");
        roles[1] = keccak256("VAULT_ADMIN_ROLE");
        roles[2] = keccak256("FEE_ADMIN_ROLE");
        roles[3] = keccak256("BUYBACK_ADMIN_ROLE");
        roles[4] = keccak256("ORACLE_ADMIN_ROLE");
        roles[5] = keccak256("RISK_ADMIN_ROLE");
        roles[6] = keccak256("OPTIONS_ADMIN_ROLE");
        roles[7] = keccak256("FUND_ADMIN_ROLE");
        roles[8] = keccak256("TARGET_ADMIN_ROLE");
        roles[9] = bytes32(0); // DEFAULT_ADMIN_ROLE
    }

    function run() external {
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        address oldAdmin = key == 0 ? msg.sender : vm.addr(key);
        address newAdmin = vm.envAddress("NEW_ADMIN");
        bool renounce = vm.envOr("RENOUNCE", false);
        bool allowEoa = vm.envOr("ALLOW_EOA", false);

        string memory network = vm.envOr("NETWORK_NAME", string("robinhood_testnet"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));
        string[18] memory keys = _targetKeys();
        address[] memory targets = new address[](keys.length);
        for (uint256 i = 0; i < keys.length; i++) {
            targets[i] = vm.parseJsonAddress(json, string.concat(".", keys[i]));
        }

        if (key == 0) vm.startBroadcast();
        else vm.startBroadcast(key);
        uint256 changes = handOver(targets, oldAdmin, newAdmin, renounce, allowEoa);
        vm.stopBroadcast();

        console.log(
            renounce ? "Roles moved and revoked from the old admin:" : "Roles granted to the new admin:", changes
        );
    }

    /// @notice Grants every admin role `oldAdmin` holds on `targets` to `newAdmin`; with `renounce`, also
    /// revokes them from `oldAdmin`. Idempotent: a role already moved is skipped. Returns the number of
    /// grants and revocations sent. Must run as `oldAdmin`.
    function handOver(address[] memory targets, address oldAdmin, address newAdmin, bool renounce, bool allowEoa)
        public
        returns (uint256 changes)
    {
        if (newAdmin == address(0)) revert NewAdminIsZero();
        if (newAdmin == oldAdmin) revert NewAdminIsCurrentAdmin();
        if (!allowEoa && newAdmin.code.length == 0) revert NewAdminIsNotAContract(newAdmin);

        bytes32[] memory roles = _adminRoles();
        for (uint256 t = 0; t < targets.length; t++) {
            IAccessControl target = IAccessControl(targets[t]);

            for (uint256 r = 0; r < roles.length; r++) {
                if (!target.hasRole(roles[r], oldAdmin) || target.hasRole(roles[r], newAdmin)) continue;
                target.grantRole(roles[r], newAdmin);
                changes++;
            }

            if (!renounce) continue;
            for (uint256 r = 0; r < roles.length; r++) {
                if (!target.hasRole(roles[r], oldAdmin)) continue;
                if (!target.hasRole(roles[r], newAdmin)) revert NewAdminMissingRole(targets[t], roles[r]);
                target.revokeRole(roles[r], oldAdmin);
                changes++;
            }
        }
    }
}
