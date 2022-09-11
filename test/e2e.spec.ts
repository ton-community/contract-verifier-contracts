import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import { Address, Cell, contractAddress, Slice } from "ton";
import { OutAction, SendMsgAction, SmartContract } from "ton-contract-executor";
import * as sourcesRegistry from "../contracts/sources-registry";
import * as verifierRegistry from "../contracts/verifier-registry";
import { internalMessage, randomAddress } from "./helpers";

import { hex as sourceRegistryHex } from "../build/sources-registry.compiled.json";
import { hex as verifierRegistryHex } from "../build/verifier-registry.compiled.json";
import { hex as sourceItemHex } from "../build/source-item.compiled.json";
import { data, keyToAddress } from "../contracts/sources-registry";
import nacl from "tweetnacl";
import { makeContract } from "./makeContract";
import { TvmBus, } from "ton-tvm-bus";

const VERIFIER_ID = "myverifier.com";
const specs = [
  {
    codeCellHash: "E/XXoxbG124QU+iKxZtd5loHKjiEUTcdxcW+y7oT9Q4=",
    verifier: VERIFIER_ID,
    jsonURL: "https://myjson.com/sources.json",
  },
];

describe("E2E", () => {
  let sourceRegistryContract: { contract: SmartContract; address: Address };
  let verifierRegistryContract: { contract: SmartContract; address: Address };
  const kp = nacl.sign.keyPair();

  beforeEach(async () => {
    sourceRegistryContract = await makeContract(
      sourceRegistryHex,
      sourcesRegistry.data({
        ownerAddress: randomAddress("owner"),
      })
    );

    verifierRegistryContract = await makeContract(
      verifierRegistryHex,
      verifierRegistry.data({
        publicKey: Buffer.from(kp.publicKey),
        sourcesRegistry: sourceRegistryContract.address,
      })
    );
  });

  it("does the thing", async () => {
    const tvmBus = new TvmBus();
    const { usdcMinter, usdcWallet } = await createBaseContracts(tvmBus);
    const data = await usdcMinter.getData();
    expect((await usdcWallet.getData()).balance.toString()).eq(data?.totalSupply.toString());
  });
});
