import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import { Address, beginCell, Cell, contractAddress, Slice } from "ton";
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
import { TvmBus } from "ton-tvm-bus";
import { SourcesRegistry } from "./sources-registry";
import { VerifierRegistry } from "./verifier-registry";
import { SourceItem } from "./source-item";
import { timeUnitTimeStamp } from "./verifier-registry.spec";

const VERIFIER_ID = "myverifier.com";

describe("E2E", () => {
  let sourceRegistryContract: SourcesRegistry;
  let verifierRegistryContract: VerifierRegistry;
  let tvmBus: TvmBus;
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32));

  beforeEach(async () => {
    tvmBus = new TvmBus();
    verifierRegistryContract = await VerifierRegistry.create(kp);
    tvmBus.registerContract(verifierRegistryContract);
    sourceRegistryContract = await SourcesRegistry.create(verifierRegistryContract.address!);
    tvmBus.registerContract(sourceRegistryContract);
  });

  it("does the thing", async () => {
    tvmBus.registerCode(new SourceItem()); // TODO?
    console.log(Array.from(tvmBus.pool.entries()).map(([k, x]) => `${x.constructor.name}:${k}`));

    const msg = sourcesRegistry.deploySource(VERIFIER_ID, "XXX123", "http://myurl.com");
    const sig = nacl.sign.detached(msg.hash(), kp.secretKey);

    const messageList = await tvmBus.broadcast(
      internalMessage({
        body: verifierRegistry.sendMessage(
          msg,
          sourceRegistryContract.address!,
          timeUnitTimeStamp(0),
          Buffer.from(sig)
        ),
        to: verifierRegistryContract.address!,
      })
    );

    const nftData = await (
      messageList[messageList.length - 1].contractImpl as SourceItem
    ).getData();
    expect(nftData.beginParse().readRemainingBytes().toString("ascii")).to.equal(
      "http://myurl.com"
    );
  });
});
