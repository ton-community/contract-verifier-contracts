import * as veriferRegistry from "../contracts/verifier-registry";
import * as sourcesRegistry from "../contracts/sources-registry";
import { Address, toNano, TupleSlice, WalletContract, beginCell } from "ton";
import { sendInternalMessageWithWallet } from "../test/helpers";
import nacl from "tweetnacl";
import { keyToAddress } from "../contracts/sources-registry";

export function timeUnitTimeStamp(offsetMinute: number) {
  return Math.floor(Date.now() / 1000 + offsetMinute * 60);
}

// return the init Cell of the contract storage (according to load_data() contract method)
export function initData() {
  return veriferRegistry.data({
    publicKey: Buffer.from(
      new Uint8Array([
        220, 48, 99, 235, 144, 252, 9, 47, 154, 222, 233, 215, 29, 5, 112, 233, 26, 76, 115, 179,
        108, 109, 241, 252, 3, 53, 223, 30, 189, 15, 69, 23,
      ])
    ),
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
  const kp = nacl.sign.keyPair.fromSecretKey(
    new Uint8Array(
      Buffer.from(
        "z2Wkf2sWS8arwVLSh+uH6FMA6uiIudDS/pyfPjWkVgPcMGPrkPwJL5re6dcdBXDpGkxzs2xt8fwDNd8evQ9FFw==",
        "base64"
      )
    )
  );

  const msgCell = sourcesRegistry.deploySource("orbs.com", "fofokoko", "myurl.com/koko.json");
  const sourcesRegAddr = Address.parse("EQB66ecFPztx7ccoFquOSl2bNKuWJqAHSWMhx--QUFv3UueP");

  await sendInternalMessageWithWallet({
    walletContract,
    secretKey,
    to: contractAddress,
    value: toNano(0.02),
    body: veriferRegistry.sendMessage(
      msgCell,
      sourcesRegAddr,
      timeUnitTimeStamp(0),
      Buffer.from(nacl.sign.detached(msgCell.hash(), kp.secretKey))
    ),
  });

  const addr = keyToAddress("orbs.com", "fofokoko", sourcesRegAddr);

  const res = await walletContract.client.callGetMethod(addr, "get_nft_data", []);
  console.log(
    new TupleSlice(res.stack.slice(3)).readCell().beginParse().readRemainingBytes().toString()
  );
}
