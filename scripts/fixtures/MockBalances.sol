// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// Local Anvil fixture only. Never deployed by the website.
contract MockBalances {
    function balanceOf(address account) external view returns(uint256) {
        if (address(this) == 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D) {
            return account == 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 ? 2 : 0;
        }
        if (address(this) == 0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7) {
            if (account == 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) return 1250 ether;
            if (account == 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC) return 101 ether;
            if (account == 0x90F79bf6EB2c4f870365E785982E1f101E93b906) return 100 ether;
        }
        if (address(this) == 0x9Efa934D9fAd4AE28c998a40195646b965a97247) {
            if (account == 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) return 300 ether;
            if (account == 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65) return 101 ether;
        }
        return 0;
    }
}
