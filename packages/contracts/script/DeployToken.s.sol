// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {AlphaToken} from "../src/token/AlphaToken.sol";

/// @notice Deploys the protocol token: a fixed supply, minted once to RECIPIENT, with no owner and no mint.
/// This cannot be undone or changed after it is sent, so check every value in the dry run first.
///
/// Required env: TOKEN_NAME, TOKEN_SYMBOL, TOKEN_SUPPLY (whole tokens, 18 decimals are added), RECIPIENT.
/// It does not touch `BuybackModule`: setting `protocolToken` is a separate admin call
/// (`BuybackModule.setProtocolToken`), done after the token exists.
///
/// Usage (dry run, then add --broadcast):
///   TOKEN_NAME="AlphaMarkets" TOKEN_SYMBOL=ALPHA TOKEN_SUPPLY=1000000000 RECIPIENT=<wallet> \
///   forge script script/DeployToken.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --account alphamarkets-mainnet --sender <deployer> [--broadcast]
contract DeployToken is Script {
    function run() external returns (AlphaToken token) {
        string memory name = vm.envString("TOKEN_NAME");
        string memory symbol = vm.envString("TOKEN_SYMBOL");
        uint256 supply = vm.envUint("TOKEN_SUPPLY") * 1e18;
        address recipient = vm.envAddress("RECIPIENT");

        vm.startBroadcast();
        token = new AlphaToken(name, symbol, supply, recipient);
        vm.stopBroadcast();

        console.log("Token:    ", address(token));
        console.log("Name:     ", token.name());
        console.log("Symbol:   ", token.symbol());
        console.log("Supply:   ", token.totalSupply() / 1e18);
        console.log("Recipient:", recipient);
    }
}
