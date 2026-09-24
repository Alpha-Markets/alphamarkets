// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AlphaToken} from "../../src/token/AlphaToken.sol";

contract AlphaTokenTest is Test {
    uint256 internal constant SUPPLY = 1_000_000_000e18;
    address internal recipient = makeAddr("recipient");
    address internal alice = makeAddr("alice");
    AlphaToken internal token;

    function setUp() public {
        token = new AlphaToken("AlphaMarkets", "ALPHA", SUPPLY, recipient);
    }

    function test_metadataAndSupplyAreFixedAtDeploy() public view {
        assertEq(token.name(), "AlphaMarkets");
        assertEq(token.symbol(), "ALPHA");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(recipient), SUPPLY);
    }

    function test_thereIsNoWayToMintMore() public {
        // No mint, owner or admin function exists to call; the supply can only fall.
        (bool ok,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1));
        assertFalse(ok);
        (ok,) = address(token).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
    }

    function test_holderCanBurnOwnTokensAndSupplyFalls() public {
        vm.prank(recipient);
        token.burn(100e18);
        assertEq(token.totalSupply(), SUPPLY - 100e18);
    }

    function test_burnFromNeedsAllowance() public {
        vm.prank(alice);
        vm.expectRevert();
        token.burnFrom(recipient, 1);

        vm.prank(recipient);
        token.approve(alice, 5e18);
        vm.prank(alice);
        token.burnFrom(recipient, 5e18);
        assertEq(token.balanceOf(recipient), SUPPLY - 5e18);
    }

    function test_transferMovesExactAmount() public {
        vm.prank(recipient);
        token.transfer(alice, 7e18);
        assertEq(token.balanceOf(alice), 7e18);
        assertEq(token.balanceOf(recipient), SUPPLY - 7e18);
    }

    function test_constructorRejectsZeroRecipientAndZeroSupply() public {
        vm.expectRevert(AlphaToken.ZeroRecipient.selector);
        new AlphaToken("A", "A", 1, address(0));
        vm.expectRevert(AlphaToken.ZeroSupply.selector);
        new AlphaToken("A", "A", 0, recipient);
    }

    function test_permitApprovesWithASignature() public {
        (address owner, uint256 key) = makeAddrAndKey("permitOwner");
        vm.prank(recipient);
        token.transfer(owner, 10e18);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                alice,
                3e18,
                token.nonces(owner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        token.permit(owner, alice, 3e18, deadline, v, r, s);
        assertEq(token.allowance(owner, alice), 3e18);
    }
}
