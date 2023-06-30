import { Address, WalletContractV3R2 } from "ton";
import { buildRegistryDataCell } from "../wrappers/verifier-registry";

export function timeUnixTimeStamp(offsetMinute: number) {
  return Math.floor(Date.now() / 1000 + offsetMinute * 60);
}

// return the init Cell of the contract storage (according to load_data() contract method)
export function initData() {
  return buildRegistryDataCell({ verifiers: new Map() }, 0);
}

// return the op that should be sent to the contract on deployment, can be "null" to send an empty message
export function initMessage() {
  return null;
}

// optional end-to-end sanity test for the actual on-chain contract to see it is actually working on-chain
export async function postDeployTest(
  walletContract: WalletContractV3R2,
  secretKey: Buffer,
  contractAddress: Address
) {}
