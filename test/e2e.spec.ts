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

const VERIFIER_ID = 12;

describe("E2E", () => {
  let sourceRegistryContract: SourcesRegistry;
  let verifierRegistryContract: VerifierRegistry;
  let tvmBus: TvmBus;
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0));

  const debugTvmBusPool = () =>
    console.log(Array.from(tvmBus.pool.entries()).map(([k, x]) => `${x.constructor.name}:${k}`));

  beforeEach(async () => {
    tvmBus = new TvmBus();

    verifierRegistryContract = await VerifierRegistry.create(kp);
    tvmBus.registerContract(verifierRegistryContract);

    sourceRegistryContract = await SourcesRegistry.create(verifierRegistryContract.address!);
    tvmBus.registerContract(sourceRegistryContract);

    tvmBus.registerCode(new SourceItem()); // TODO?
  });

  it("Cannot update an existing source item contract's data", async () => {
    await deployFakeSource(verifierRegistryContract, kp);

    const messageList = await deployFakeSource(verifierRegistryContract, kp, "http://changed.com");

    const url = await readSourceItemContent(
      messageList[messageList.length - 1].contractImpl as SourceItem
    );

    expect(url).to.equal("http://myurl.com");
  });

  it("Modifies the owner and is able to deploy a source item contract", async () => {
    const alternativeKp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1));
    const alternativeVerifierRegistryContract = await VerifierRegistry.create(alternativeKp);

    const changeOwnerMsg = sourcesRegistry.changeOwner(
      alternativeVerifierRegistryContract.address!
    );

    await tvmBus.broadcast(
      internalMessage({
        body: verifierRegistry.sendMessage(
          changeOwnerMsg,
          sourceRegistryContract.address!,
          timeUnitTimeStamp(0),
          Buffer.from(nacl.sign.detached(changeOwnerMsg.hash(), kp.secretKey))
        ),
        to: verifierRegistryContract.address!,
      })
    );

    tvmBus.registerContract(alternativeVerifierRegistryContract);

    const messageList = await deployFakeSource(alternativeVerifierRegistryContract, alternativeKp);

    const url = await readSourceItemContent(
      messageList[messageList.length - 1].contractImpl as SourceItem
    );

    expect(url).to.equal("http://myurl.com");
  });

  async function deployFakeSource(
    verifierRegistryContract: VerifierRegistry,
    kp: nacl.SignKeyPair,
    url = "http://myurl.com"
  ) {
    const msg = sourcesRegistry.deploySource(VERIFIER_ID, "XXX123", url);
    const sig = nacl.sign.detached(msg.hash(), kp.secretKey);

    return await tvmBus.broadcast(
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
  }

  async function readSourceItemContent(sourceItem: SourceItem): Promise<string> {
    const nftData = await sourceItem.getData();
    return nftData.beginParse().readRemainingBytes().toString("ascii");
  }

  it("Deploys a source item contract", async () => {
    const messageList = await deployFakeSource(verifierRegistryContract, kp);

    const url = await readSourceItemContent(
      messageList[messageList.length - 1].contractImpl as SourceItem
    );

    expect(url).to.equal("http://myurl.com");

    // debugTvmBusPool();
  });
});
