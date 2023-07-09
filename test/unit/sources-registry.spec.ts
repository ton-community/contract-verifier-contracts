import { expect } from "chai";

import { Cell, contractAddress, beginCell, toNano, Address } from "ton-core";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { compile } from "@ton-community/blueprint";

import { randomAddress } from "./helpers";
import { SourcesRegistry } from "../../wrappers/sources-registry";
import { SourceItem } from "../../wrappers/source-item";
import { transactionsFrom } from "./helpers";

const specs = [
  {
    codeCellHash: "E/XXoxbG124QU+iKxZtd5loHKjiEUTcdxcW+y7oT9Q4=",
    verifier: "my verifier",
    jsonURL: "https://myjson.com/sources.json",
  },
];

describe("Sources", () => {
  let code: Cell;
  let sourceItemCode: Cell;

  let blockchain: Blockchain;
  let sourceRegistryContract: SandboxContract<SourcesRegistry>;
  let admin: SandboxContract<TreasuryContract>;
  let verifierRegistryAddress: Address;

  before(async () => {
    code = await compile("sources-registry");
    sourceItemCode = await compile("source-item");
  });

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    blockchain.now = 1000;

    admin = await blockchain.treasury("admin");
    verifierRegistryAddress = randomAddress("verifierReg");

    sourceRegistryContract = blockchain.openContract(
      SourcesRegistry.create(
        {
          admin: admin.address, 
          verifierRegistryAddress,
          sourceItemCode
        }, 
        code
      )
    );

    const deployResult = await sourceRegistryContract.sendDeploy(admin.getSender(), toNano(100));

    expect(deployResult.transactions).to.have.transaction({
      from: admin.address,
      to: sourceRegistryContract.address,
      deploy: true,
      success: true,
    });
  });

  describe("Deploy source item", () => {
    it("should deploy a source contract item", async () => {
      const send = await sourceRegistryContract.sendDeploySource(
        blockchain.sender(verifierRegistryAddress),

        {
          verifierId: specs[0].verifier,
          codeCellHash: specs[0].codeCellHash,
          jsonURL: specs[0].jsonURL,
          version: 1,
          value: toNano("0.5"),
        }
      );

      expect(send.transactions).to.have.transaction({
        from: verifierRegistryAddress,
        exitCode: 0,
      });

      let outMessages = transactionsFrom(send.transactions, verifierRegistryAddress)[0].outMessages;
      const msg = outMessages.values()[0];

      const sourceItemContract = blockchain.openContract(
        SourceItem.createFromAddress(contractAddress(0, msg.init!))
      );

      expect(await parseUrlFromGetSourceItemData(sourceItemContract)).to.equal(specs[0].jsonURL);
    });

    it("disallows a non-verifier reg to deploy a source item", async () => {
      const notVerifier = await blockchain.treasury("non-verifier");
      const send = await sourceRegistryContract.sendDeploySource(notVerifier.getSender(), {
        verifierId: specs[0].verifier,
        codeCellHash: specs[0].codeCellHash,
        jsonURL: specs[0].jsonURL,
        version: 1,
        value: toNano("0.5"),
      });
      expect(send.transactions).to.have.transaction({
        from: notVerifier.address,
        exitCode: 401,
      });
    });
  });

  describe("Source item addresses", () => {
    it("returns source item address", async () => {
      const send = await sourceRegistryContract.sendDeploySource(
        blockchain.sender(verifierRegistryAddress),
        {
          verifierId: specs[0].verifier,
          codeCellHash: specs[0].codeCellHash,
          jsonURL: specs[0].jsonURL,
          version: 1,
          value: toNano("0.5"),
        }
      );

      const childFromChain = await sourceRegistryContract.getSourceItemAddress(
        specs[0].verifier,
        specs[0].codeCellHash
      );

      let outMessages = transactionsFrom(send.transactions, verifierRegistryAddress)[0].outMessages;
      const msg = outMessages.values()[0];
      expect(msg.info.dest).to.equalAddress(childFromChain);
    });

    it("returns different source item addresses for different verifiers", async () => {
      const childFromChain = await sourceRegistryContract.getSourceItemAddress(
        specs[0].verifier,
        specs[0].codeCellHash
      );
      const childFromChain2 = await sourceRegistryContract.getSourceItemAddress(
        specs[0].verifier + 1,
        specs[0].codeCellHash
      );

      expect(childFromChain).to.not.equalAddress(childFromChain2);
    });

    it("returns different source item addresses for different code cell hashes", async () => {
      const childFromChain = await sourceRegistryContract.getSourceItemAddress(
        specs[0].verifier,
        specs[0].codeCellHash
      );
      const childFromChain2 = await sourceRegistryContract.getSourceItemAddress(
        specs[0].verifier,
        "E/XXoxbG124QU+iKxZtd5loHKjiEUTcdxcW+y7oT9ZZ="
      );

      expect(childFromChain).to.not.equalAddress(childFromChain2);
    });
  });

  describe("Set verifier registry", () => {
    it("changes the verifier registry", async () => {
      const newVerifierRegistryAddress = randomAddress("newVerifierRegistry");
      await sourceRegistryContract.sendChangeVerifierRegistry(admin.getSender(), {
        value: toNano("0.5"),
        newVerifierRegistry: newVerifierRegistryAddress,
      });

      const verifierRegistryAddress = await sourceRegistryContract.getVerifierRegistryAddress();

      expect(verifierRegistryAddress).to.equalAddress(newVerifierRegistryAddress);

      const send = await sourceRegistryContract.sendDeploySource(
        blockchain.sender(newVerifierRegistryAddress),
        {
          verifierId: specs[0].verifier,
          codeCellHash: specs[0].codeCellHash,
          jsonURL: specs[0].jsonURL,
          version: 1,
          value: toNano("0.5"),
        }
      );
      expect(send.transactions).to.have.transaction({
        from: newVerifierRegistryAddress,
        aborted: false,
        exitCode: 0,
      });
    });

    it("disallows a non admin to change the verifier registry", async () => {
      const send = await sourceRegistryContract.sendChangeVerifierRegistry(
        blockchain.sender(randomAddress("notadmin")),
        {
          value: toNano("0.5"),
          newVerifierRegistry: randomAddress("newadmin"),
        }
      );

      expect(send.transactions).to.have.transaction({
        from: randomAddress("notadmin"),
        aborted: true,
        exitCode: 401,
      });
    });
  });

  describe("Set admin", () => {
    it("allows the admin to change admin", async () => {
      const send = await sourceRegistryContract.sendChangeAdmin(admin.getSender(), {
        value: toNano("0.5"),
        newAdmin: randomAddress("newadmin"),
      });

      const adminAddress = await sourceRegistryContract.getAdminAddress();

      expect(adminAddress).to.equalAddress(randomAddress("newadmin"));
    });

    it("disallows a non admin to change the admin", async () => {
      const send = await sourceRegistryContract.sendChangeAdmin(
        blockchain.sender(randomAddress("notadmin")),
        {
          value: toNano("0.5"),
          newAdmin: randomAddress("newadmin"),
        }
      );

      expect(send.transactions).to.have.transaction({
        from: randomAddress("notadmin"),
        aborted: true,
        exitCode: 401,
      });
    });
  });

  describe("Set code", () => {
    it("allows the admin to set code", async () => {
      const newCode = beginCell().storeBit(1).endCell();

      const send = await sourceRegistryContract.sendChangeCode(admin.getSender(), {
        value: toNano("0.5"),
        newCode,
      });
      expect(send.transactions).to.have.transaction({
        from: admin.address,
        exitCode: 0,
      });
      // expect(send.exit_code).to.equal(0);
      const code = await sourceRegistryContract.getCodeOpt();
      expect(Cell.fromBoc(code!).toString()).to.equal(newCode.toString());
    });

    it("disallows setting an empty set code", async () => {
      const newCode = beginCell().endCell();

      const send = await sourceRegistryContract.sendChangeCode(admin.getSender(), {
        value: toNano("0.5"),
        newCode,
      });

      expect(send.transactions).to.have.transaction({
        from: admin.address,
        exitCode: 902,
      });
    });

    it("disallows a non admin to set code", async () => {
      const newCode = beginCell().endCell();
      const send = await sourceRegistryContract.sendChangeCode(
        blockchain.sender(randomAddress("notadmin")),
        {
          value: toNano("0.5"),
          newCode,
        }
      );

      expect(send.transactions).to.have.transaction({
        from: randomAddress("notadmin"),
        aborted: true,
        exitCode: 401,
      });
    });
  });

  describe("Set source item code", () => {
    it("allows the admin to set source item code", async () => {
      const newCode = beginCell().storeBit(1).endCell();

      const childFromChainBefore = await sourceRegistryContract.getSourceItemAddress(
        specs[0].verifier,
        specs[0].codeCellHash
      );

      const send = await sourceRegistryContract.sendSetSourceItemCode(admin.getSender(), {
        value: toNano("0.5"),
        newCode,
      });

      expect(send.transactions).to.have.transaction({
        from: admin.address,
        exitCode: 0,
      });

      const childFromChainAfter = await sourceRegistryContract.getSourceItemAddress(
        specs[0].verifier,
        specs[0].codeCellHash
      );

      expect(childFromChainBefore).to.not.equalAddress(childFromChainAfter);
    });

    it("disallows setting an empty set source item code", async () => {
      const newCode = beginCell().endCell();

      const send = await sourceRegistryContract.sendSetSourceItemCode(admin.getSender(), {
        value: toNano("0.5"),
        newCode,
      });

      expect(send.transactions).to.have.transaction({
        from: admin.address,
        exitCode: 902,
      });
    });

    it("disallows a non admin to set source item code", async () => {
      const send = await sourceRegistryContract.sendSetSourceItemCode(
        blockchain.sender(randomAddress("notadmin")),
        {
          value: toNano("0.5"),
          newCode: new Cell(),
        }
      );

      expect(send.transactions).to.have.transaction({
        from: randomAddress("notadmin"),
        exitCode: 401,
      });
    });
  });

  describe("Deployment costs", () => {
    it("rejects deploy messages with less than min TON", async () => {
      const send = await sourceRegistryContract.sendDeploySource(
        blockchain.sender(verifierRegistryAddress),
        {
          verifierId: specs[0].verifier,
          codeCellHash: specs[0].codeCellHash,
          jsonURL: specs[0].jsonURL,
          version: 1,
          value: toNano("0.049"),
        }
      );

      expect(send.transactions).to.have.transaction({
        from: verifierRegistryAddress,
        exitCode: 900,
      });
    });

    it("Allows changing min and max ton deployment costs", async () => {
      await sourceRegistryContract.sendSetDeploymentCosts(admin.getSender(), {
        value: toNano("0.01"),
        min: toNano(10),
        max: toNano(20),
      });

      const { min, max } = await sourceRegistryContract.getDeploymentCosts();
      expect(min).to.equal("10");
      expect(max).to.equal("20");

      const send = await sourceRegistryContract.sendDeploySource(
        blockchain.sender(verifierRegistryAddress),
        {
          verifierId: specs[0].verifier,
          codeCellHash: specs[0].codeCellHash,
          jsonURL: specs[0].jsonURL,
          version: 1,
          value: toNano(9),
        }
      );

      expect(send.transactions).to.have.transaction({
        from: verifierRegistryAddress,
        exitCode: 900,
      });

      const send2 = await sourceRegistryContract.sendDeploySource(
        blockchain.sender(verifierRegistryAddress),
        {
          verifierId: specs[0].verifier,
          codeCellHash: specs[0].codeCellHash,
          jsonURL: specs[0].jsonURL,
          version: 1,
          value: toNano(19),
        }
      );

      expect(send2.transactions).to.have.transaction({
        from: verifierRegistryAddress,
        exitCode: 0,
      });

      const send3 = await sourceRegistryContract.sendDeploySource(
        blockchain.sender(verifierRegistryAddress),
        {
          verifierId: specs[0].verifier,
          codeCellHash: specs[0].codeCellHash,
          jsonURL: specs[0].jsonURL,
          version: 1,
          value: toNano("20.1"),
        }
      );

      expect(send3.transactions).to.have.transaction({
        from: verifierRegistryAddress,
        exitCode: 901,
      });
    });

    it("Rejects changing min below lower bound", async () => {
      const send = await sourceRegistryContract.sendSetDeploymentCosts(admin.getSender(), {
        value: toNano("0.01"),
        min: toNano("0.05"),
        max: toNano(20),
      });
      expect(send.transactions).to.have.transaction({
        from: admin.address,
        exitCode: 903,
      });
    });

    it("Rejects changing min/max from nonadmin", async () => {
      const send = await sourceRegistryContract.sendSetDeploymentCosts(
        blockchain.sender(randomAddress("notadmin")),
        {
          value: toNano("0.01"),
          min: toNano(10),
          max: toNano(20),
        }
      );

      expect(send.transactions).to.have.transaction({
        from: randomAddress("notadmin"),
        exitCode: 401,
      });
    });

    it("rejects deploy messages with more than max TON", async () => {
      const send = await sourceRegistryContract.sendDeploySource(
        blockchain.sender(verifierRegistryAddress),
        {
          verifierId: specs[0].verifier,
          codeCellHash: specs[0].codeCellHash,
          jsonURL: specs[0].jsonURL,
          version: 1,
          value: toNano("1.01"),
        }
      );
      expect(send.transactions).to.have.transaction({
        from: verifierRegistryAddress,
        exitCode: 901,
      });
    });
  });
});

async function parseUrlFromGetSourceItemData(
  contract: SandboxContract<SourceItem>
): Promise<string | null> {
  const res = await contract.getData();
  if (res === null) return null;
  const sourceItemData = res.beginParse();
  sourceItemData.loadUint(8); // skip version
  return sourceItemData.loadStringTail();
}
