import * as sourcesRegistry from "../contracts/sources-registry";
import { Address, toNano, TupleSlice, WalletContract } from "ton";
import { sendInternalMessageWithWallet, zeroAddress } from "../test/unit/helpers";

// return the init Cell of the contract storage (according to load_data() contract method)
export function initData() {
  return sourcesRegistry.data({
    verifierRegistryAddress: zeroAddress,
    admin: Address.parse("EQBnLd2ta0Od6LkhaeO1zDQ4wcvoUReK8Z8k881BIMrTfjb8"),
    maxTons: toNano(1.1),
    minTons: toNano(0.065),
  });
}

// return the op that should be sent to the contract on deployment, can be "null" to send an empty message
export function initMessage() {
  return null;
}

// optional end-to-end sanity test for the actual on-chain contract to see it is actually working on-chain
export async function postDeployTest(
  walletContract: WalletContract,
  secretKey: Buffer,
  contractAddress: Address
) {}
