import { expect } from "chai";

import { toNano, Cell, contractAddress, Address, beginCell } from "@ton/core";
import { KeyPair, sign } from "@ton/crypto";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { toBigIntBE } from "bigint-buffer";
import { compile } from "@ton/blueprint";

import { randomAddress } from "./helpers";
import { SourcesRegistry, toSha256Buffer } from "../../wrappers/sources-registry";
import { VerifierRegistry, buildMsgDescription } from "../../wrappers/verifier-registry";
import { SourceItem } from "../../wrappers/source-item";
import { genDefaultVerifierRegistryConfig } from "./verifier-registry.spec";
import { sha256BN } from "./helpers";
import { transactionsFrom } from "./helpers";

const VERIFIER_ID = "verifier1";

describe("Integration", () => {
  let keys: KeyPair[];
  let verifierRegistryCode: Cell;
  let SourceRegistryCode: Cell;
  let sourceItemCode: Cell;

  let blockchain: Blockchain;
  let sourceRegistryContract: SandboxContract<SourcesRegistry>;
  let verifierRegistryContract: SandboxContract<VerifierRegistry>;
  let admin: SandboxContract<TreasuryContract>;

  before(async () => {
    verifierRegistryCode = await compile("verifier-registry");
    SourceRegistryCode = await compile("sources-registry");
    sourceItemCode = await compile("source-item");
  });

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    blockchain.now = 1000;

    admin = await blockchain.treasury("admin");

    const verifierConfig = await genDefaultVerifierRegistryConfig(admin, 1);
    keys = verifierConfig.keys;
    verifierRegistryContract = blockchain.openContract(
      VerifierRegistry.createFromConfig(verifierRegistryCode, verifierConfig.data, 1)
    );

    const deployResult = await verifierRegistryContract.sendDeploy(admin.getSender(), toNano(100));

    expect(deployResult.transactions).to.have.transaction({
      from: admin.address,
      to: verifierRegistryContract.address,
      deploy: true,
      success: true,
    });

    sourceRegistryContract = blockchain.openContract(
      SourcesRegistry.create(
        {
          verifierRegistryAddress: verifierRegistryContract.address,
          admin: admin.address,
          sourceItemCode,
        },
        SourceRegistryCode,
      )
    );

    const deployResult2 = await sourceRegistryContract.sendDeploy(admin.getSender(), toNano(100));

    expect(deployResult2.transactions).to.have.transaction({
      from: admin.address,
      to: sourceRegistryContract.address,
      deploy: true,
      success: true,
    });
  });

  it("Updates an existing source item contract's data", async () => {
    const sender = randomAddress("someSender");
    const result = await deployFakeSource(verifierRegistryContract, sender, keys[0]);

    const outMessages = transactionsFrom(result.transactions, verifierRegistryContract.address)[0]
      .outMessages;
    const msg = outMessages.values()[0];
    const sourceItemContract = blockchain.openContract(
      SourceItem.createFromAddress(contractAddress(0, msg.init!))
    );

    const [versionBefore, urlBefore] = await readSourceItemContent(sourceItemContract);

    expect(versionBefore).to.equal(1);
    expect(urlBefore).to.equal("http://myurl.com");

    const result2 = await deployFakeSource(
      verifierRegistryContract,
      sender,
      keys[0],
      "http://changed.com",
      4
    );

    const outMessages2 = transactionsFrom(result2.transactions, verifierRegistryContract.address)[0]
      .outMessages;
    const msg2 = outMessages2.values()[0];

    const sourceItemContract2 = blockchain.openContract(
      SourceItem.createFromAddress(contractAddress(0, msg2.init!))
    );
    const [version, url] = await readSourceItemContent(sourceItemContract2);
    expect(version).to.equal(4);
    expect(url).to.equal("http://changed.com");
  });

  it("Modifies the verifier registry address and is able to deploy a source item contract", async () => {
    const alternativeVerifierConfig = await genDefaultVerifierRegistryConfig(admin, 1);
    const alternativeKp = alternativeVerifierConfig.keys[0];
    const alternativeVerifierRegistryContract = blockchain.openContract(
      VerifierRegistry.createFromConfig(verifierRegistryCode, alternativeVerifierConfig.data, 1)
    );

    await sourceRegistryContract.sendChangeVerifierRegistry(admin.getSender(), {
      newVerifierRegistry: alternativeVerifierRegistryContract.address!,
      value: toNano("0.5"),
    });

    blockchain.openContract(alternativeVerifierRegistryContract);
    await alternativeVerifierRegistryContract.sendDeploy(admin.getSender(), toNano(100));
    const sender = randomAddress("someSender");
    const result = await deployFakeSource(
      alternativeVerifierRegistryContract,
      sender,
      alternativeKp
    );

    const outMessages = transactionsFrom(
      result.transactions,
      alternativeVerifierRegistryContract.address
    )[0].outMessages;
    const msg = outMessages.values()[0];

    const sourceItemContract = blockchain.openContract(
      SourceItem.createFromAddress(contractAddress(0, msg.init!))
    );
    const [version, url] = await readSourceItemContent(sourceItemContract);

    expect(version).to.equal(1);
    expect(url).to.equal("http://myurl.com");
  });

  async function deployFakeSource(
    verifierRegistryContract: SandboxContract<VerifierRegistry>,
    sender: Address,
    kp: KeyPair,
    url = "http://myurl.com",
    version: number = 1
  ) {
    function deploySource(
      verifierId: string,
      codeCellHash: string,
      jsonURL: string,
      version: number
    ): Cell {
      return beginCell()
        .storeUint(1002, 32)
        .storeUint(0, 64)
        .storeBuffer(toSha256Buffer(verifierId))
        .storeUint(toBigIntBE(Buffer.from(codeCellHash, "base64")), 256)
        .storeRef(beginCell().storeUint(version, 8).storeBuffer(Buffer.from(jsonURL)).endCell()) // TODO support snakes
        .endCell();
    }
    const msg = deploySource(VERIFIER_ID, "XXX123", url, version);

    let desc = buildMsgDescription(
      sha256BN(VERIFIER_ID),
      1500,
      sender,
      sourceRegistryContract.address!,
      msg
    ).endCell();

    const result = verifierRegistryContract.sendForwardMessage(blockchain.sender(sender), {
      desc: desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(kp.publicKey), sign(desc.hash(), kp.secretKey)],
      ]),
      value: toNano("0.5"),
    });
    return result;
  }

  async function readSourceItemContent(
    sourceItem: SandboxContract<SourceItem>
  ): Promise<[number, string]> {
    const sourceItemData = await sourceItem.getData();
    expect(sourceItemData).to.be.instanceOf(Cell);
    const dataSlice = (sourceItemData as Cell).beginParse();
    return [dataSlice.loadUint(8), dataSlice.loadStringTail()];
  }

  it("Deploys a source item contract", async () => {
    const sender = randomAddress("someSender");
    const result = await deployFakeSource(
      verifierRegistryContract,
      sender,
      keys[0],
      "http://myurl.com",
      2
    );

    const outMessages = transactionsFrom(result.transactions, verifierRegistryContract.address)[0]
      .outMessages;
    const msg = outMessages.values()[0];

    const sourceItemContract = blockchain.openContract(
      SourceItem.createFromAddress(contractAddress(0, msg.init!))
    );
    const [version, url] = await readSourceItemContent(sourceItemContract);

    expect(version).to.equal(2);
    expect(url).to.equal("http://myurl.com");
  });
});
