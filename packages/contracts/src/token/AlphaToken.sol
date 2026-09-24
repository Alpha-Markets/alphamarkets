// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice The protocol token (`BuybackModule.protocolToken`). Deliberately plain: the whole fixed supply is
/// minted once, in the constructor, to `recipient`. There is no owner, no mint function, no pause, no
/// blacklist and no fee on transfer, so nobody can change the supply or freeze a holder after deployment.
/// Holders may burn their own tokens (`burn`, `burnFrom`), which is how a buyback can retire supply.
/// `ERC20Permit` allows gasless approvals. Not upgradeable: a deployed token never changes.
contract AlphaToken is ERC20, ERC20Burnable, ERC20Permit {
    error ZeroRecipient();
    error ZeroSupply();

    constructor(string memory name_, string memory symbol_, uint256 supply, address recipient)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        if (recipient == address(0)) revert ZeroRecipient();
        if (supply == 0) revert ZeroSupply();
        _mint(recipient, supply);
    }
}
