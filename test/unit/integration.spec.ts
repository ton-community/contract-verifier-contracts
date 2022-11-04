import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import * as sourcesRegistry from "../../contracts/sources-registry";
import * as verifierRegistry from "../../contracts/verifier-registry";
import { internalMessage, randomAddress } from "./helpers";

import nacl from "tweetnacl";
import { TvmBus } from "ton-tvm-bus";
import { SourcesRegistry } from "./sources-registry";
import { VerifierRegistry } from "./verifier-registry";
import { SourceItem } from "./source-item";
import { timeUnixTimeStamp } from "./verifier-registry.spec";
import { toNano } from "ton";

const VERIFIER_ID = "myverifier.com";

describe("Integration", () => {
  let sourceRegistryContract: SourcesRegistry;
  let verifierRegistryContract: VerifierRegistry;
  let tvmBus: TvmBus;
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(0));
  const admin = randomAddress("admin");

  const debugTvmBusPool = () =>
    console.log(Array.from(tvmBus.pool.entries()).map(([k, x]) => `${x.constructor.name}:${k}`));

  beforeEach(async () => {
    tvmBus = new TvmBus();

    verifierRegistryContract = await VerifierRegistry.create(kp);
    tvmBus.registerContract(verifierRegistryContract);

    sourceRegistryContract = await SourcesRegistry.create(verifierRegistryContract.address!, admin);
    tvmBus.registerContract(sourceRegistryContract);

    tvmBus.registerCode(new SourceItem()); // TODO?
  });

  it("Updates an existing source item contract's data", async () => {
    await deployFakeSource(verifierRegistryContract, kp);

    const messageList = await deployFakeSource(verifierRegistryContract, kp, "http://changed.com");

    const url = await readSourceItemContent(
      messageList[messageList.length - 1].contractImpl as SourceItem
    );

    expect(url).to.equal("http://changed.com");
  });

  it("Modifies the verifier registry address and is able to deploy a source item contract", async () => {
    const alternativeKp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1));
    const alternativeVerifierRegistryContract = await VerifierRegistry.create(alternativeKp);

    const changeVerifierRegistryMessage = sourcesRegistry.changeVerifierRegistry(
      alternativeVerifierRegistryContract.address!
    );

    const res = await tvmBus.broadcast(
      internalMessage({
        from: admin,
        body: changeVerifierRegistryMessage,
        to: sourceRegistryContract.address!,
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
    url = "http://myurl.com",
    version: number = 1
  ) {
    const msg = sourcesRegistry.deploySource(VERIFIER_ID, "XXX123", url, version);

    return await tvmBus.broadcast(
      internalMessage({
        body: verifierRegistry.sendMessage(
          msg,
          sourceRegistryContract.address!,
          timeUnixTimeStamp(0),
          kp.secretKey
        ),
        to: verifierRegistryContract.address!,
        value: toNano(0.5),
      })
    );
  }

  async function readSourceItemContent(sourceItem: SourceItem): Promise<string> {
    const sourceItemData = (await sourceItem.getData()).beginParse();
    sourceItemData.readUint(8) // skip version
    return sourceItemData.readRemainingBytes().toString("ascii");
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
