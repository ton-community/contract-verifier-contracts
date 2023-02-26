import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import * as sourcesRegistry from "../../contracts/sources-registry";
import { internalMessage, randomAddress } from "./helpers";

import nacl from "tweetnacl";
import { TvmBus } from "ton-tvm-bus";
import { SourcesRegistry } from "./sources-registry";
import { VerifierRegistry } from "./verifier-registry";
import { SourceItem } from "./source-item";
import { timeUnixTimeStamp } from "./helpers";
import { toNano } from "ton";
import { genDefaultVerifierRegistryConfig, sha256BN } from "./verifier-registry.spec";
import { buildMsgDescription, Queries } from "./verifier-registry";
import { KeyPair, sign } from "ton-crypto";

const VERIFIER_ID = "verifier1";

describe("Integration", () => {
  let sourceRegistryContract: SourcesRegistry;
  let verifierRegistryContract: VerifierRegistry;
  let tvmBus: TvmBus;
  let keys: KeyPair[];

  const admin = randomAddress("admin");

  const debugTvmBusPool = () =>
    console.log(Array.from(tvmBus.pool.entries()).map(([k, x]) => `${x.constructor.name}:${k}`));

  beforeEach(async () => {
    tvmBus = new TvmBus();

    const verifierConfig = await genDefaultVerifierRegistryConfig(1);
    keys = verifierConfig.keys;
    verifierRegistryContract = await VerifierRegistry.createFromConfig(verifierConfig.data, 1);

    tvmBus.registerContract(verifierRegistryContract);

    sourceRegistryContract = await SourcesRegistry.create(verifierRegistryContract.address!, admin);
    tvmBus.registerContract(sourceRegistryContract);

    tvmBus.registerCode(new SourceItem()); // TODO?
  });

  it("Updates an existing source item contract's data", async () => {
    const messageListBefore = await deployFakeSource(verifierRegistryContract, keys[0]);

    const [versionBefore, urlBefore] = await readSourceItemContent(
      messageListBefore[messageListBefore.length - 1].contractImpl as SourceItem
    );

    expect(versionBefore).to.equal(1);
    expect(urlBefore).to.equal("http://myurl.com");

    const messageList = await deployFakeSource(
      verifierRegistryContract,
      keys[0],
      "http://changed.com",
      4
    );

    const [version, url] = await readSourceItemContent(
      messageList[messageList.length - 1].contractImpl as SourceItem
    );

    expect(version).to.equal(4);
    expect(url).to.equal("http://changed.com");
  });

  it("Modifies the verifier registry address and is able to deploy a source item contract", async () => {
    const alternativeVerifierConfig = await genDefaultVerifierRegistryConfig(1);
    const alternativeKp = alternativeVerifierConfig.keys[0];
    const alternativeVerifierRegistryContract = await VerifierRegistry.createFromConfig(
      alternativeVerifierConfig.data,
      1
    );

    const changeVerifierRegistryMessage = sourcesRegistry.changeVerifierRegistry(
      alternativeVerifierRegistryContract.address!
    );

    await tvmBus.broadcast(
      internalMessage({
        from: admin,
        body: changeVerifierRegistryMessage,
        to: sourceRegistryContract.address!,
      })
    );

    tvmBus.registerContract(alternativeVerifierRegistryContract);

    const messageList = await deployFakeSource(alternativeVerifierRegistryContract, alternativeKp);

    const [version, url] = await readSourceItemContent(
      messageList[messageList.length - 1].contractImpl as SourceItem
    );

    expect(version).to.equal(1);
    expect(url).to.equal("http://myurl.com");
  });

  async function deployFakeSource(
    verifierRegistryContract: VerifierRegistry,
    kp: KeyPair,
    url = "http://myurl.com",
    version: number = 1
  ) {
    const sender = randomAddress("someSender");
    const msg = sourcesRegistry.deploySource(VERIFIER_ID, "XXX123", url, version);

    let desc = buildMsgDescription(
      sha256BN(VERIFIER_ID),
      1500,
      sender,
      sourceRegistryContract.address!,
      msg
    );

    return await tvmBus.broadcast(
      internalMessage({
        from: sender,
        body: Queries.forwardMessage({
          desc: desc,
          signatures: new Map<BN, Buffer>([
            [new BN(kp.publicKey), sign(desc.hash(), kp.secretKey)],
          ]),
        }),
        to: verifierRegistryContract.address!,
        value: toNano(0.5),
      })
    );
  }

  async function readSourceItemContent(sourceItem: SourceItem): Promise<[number, string]> {
    const sourceItemData = (await sourceItem.getData()).beginParse();
    return [
      sourceItemData.readUintNumber(8),
      sourceItemData.readRemainingBytes().toString("ascii"),
    ];
  }

  it("Deploys a source item contract", async () => {
    const messageList = await deployFakeSource(
      verifierRegistryContract,
      keys[0],
      "http://myurl.com",
      2
    );

    const [version, url] = await readSourceItemContent(
      messageList[messageList.length - 1].contractImpl as SourceItem
    );

    expect(version).to.equal(2);
    expect(url).to.equal("http://myurl.com");

    // debugTvmBusPool();
  });
});
