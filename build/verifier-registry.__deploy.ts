import * as veriferRegistry from "../contracts/verifier-registry";
import * as sourcesRegistry from "../contracts/sources-registry";
import { Address, toNano, TupleSlice, WalletContract, beginCell } from "ton";
import { sendInternalMessageWithWallet } from "../test/helpers";
import nacl from "tweetnacl";
import { keyToAddress } from "../contracts/sources-registry";

export function timeUnixTimeStamp(offsetMinute: number) {
  return Math.floor(Date.now() / 1000 + offsetMinute * 60);
}

// {
//   publicKey: Uint8Array(32) [
//     148,  69, 177, 132,  85, 101,  80, 233,
//     160, 155,  14, 151,  13,  47, 168,  10,
//     213, 126,   6, 117, 246, 135, 231, 230,
//      73,  52,  59,  79, 177, 235,  35, 114
//   ],
//   secretKey: Uint8Array(64) [
//      91, 153, 246,  88,   6, 171,  36, 153, 244, 206,  30,
//     200, 206,  84, 122,  12, 232, 110, 138,  84,  25, 179,
//     191,  80, 242,  28, 124,  69, 198, 172, 199, 113, 148,
//      69, 177, 132,  85, 101,  80, 233, 160, 155,  14, 151,
//      13,  47, 168,  10, 213, 126,   6, 117, 246, 135, 231,
//     230,  73,  52,  59,  79, 177, 235,  35, 114
//   ]
// }

// return the init Cell of the contract storage (according to load_data() contract method)
export function initData() {
  return veriferRegistry.data({
    publicKey: Buffer.from(
      new Uint8Array([
        148, 69, 177, 132, 85, 101, 80, 233, 160, 155, 14, 151, 13, 47, 168, 10, 213, 126, 6, 117,
        246, 135, 231, 230, 73, 52, 59, 79, 177, 235, 35, 114,
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
        "W5n2WAarJJn0zh7IzlR6DOhuilQZs79Q8hx8Rcasx3GURbGEVWVQ6aCbDpcNL6gK1X4GdfaH5+ZJNDtPsesjcg==",
        "base64"
      )
    )
  );

  const msgCell = sourcesRegistry.deploySource(0, "fofokoko", "myurl.com/koko.json");
  const sourcesRegAddr = Address.parse("EQB66ecFPztx7ccoFquOSl2bNKuWJqAHSWMhx--QUFv3UueP");

  await sendInternalMessageWithWallet({
    walletContract,
    secretKey,
    to: contractAddress,
    value: toNano(0.02),
    body: veriferRegistry.sendMessage(
      msgCell,
      sourcesRegAddr,
      timeUnixTimeStamp(0),
      kp.secretKey
    ),
  });

  const addr = keyToAddress("orbs.com", "fofokoko", sourcesRegAddr);

  const res = await walletContract.client.callGetMethod(addr, "get_nft_data", []);
  console.log(
    new TupleSlice(res.stack.slice(3)).readCell().beginParse().readRemainingBytes().toString()
  );
}
