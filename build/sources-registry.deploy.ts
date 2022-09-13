import * as sourcesRegistry from "../contracts/sources-registry";
import { Address, toNano, TupleSlice, WalletContract } from "ton";
import { sendInternalMessageWithWallet } from "../test/helpers";

// return the init Cell of the contract storage (according to load_data() contract method)
// EQD63bU_HLZbfzlgtYrlHzVjuUhaC2TgVs267rUzaz14I153
export function initData() {
  return sourcesRegistry.data({
    ownerAddress: Address.parse("EQC2Cqgb_OIRFLzzmSjfSyfB9iHwBT55T-NAUH5ouAo5MYgt"),
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
) {
  // const call = await walletContract.client.callGetMethod(contractAddress, "counter");
  // const counter = new TupleSlice(call.stack).readBigNumber();
  // console.log(`   # Getter 'counter' = ${counter.toString()}`);
  // const message = main.increment();
  // await sendInternalMessageWithWallet({
  //   walletContract,
  //   secretKey,
  //   to: contractAddress,
  //   value: toNano(0.02),
  //   body: message,
  // });
  // console.log(`   # Sent 'increment' op message`);
  // const call2 = await walletContract.client.callGetMethod(contractAddress, "counter");
  // const counter2 = new TupleSlice(call2.stack).readBigNumber();
  // console.log(`   # Getter 'counter' = ${counter2.toString()}`);
}
