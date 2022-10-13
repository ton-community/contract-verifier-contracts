import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import { Address, Cell, contractAddress, Slice, beginCell } from 'ton';
import { OutAction, SendMsgAction, SmartContract } from "ton-contract-executor";
import * as sourcesRegistry from "../contracts/sources-registry";
import { internalMessage, randomAddress } from "./helpers";

import { hex as sourceRegistryHex } from "../build/sources-registry.compiled.json";
import { hex as sourceItemHex } from "../build/source-item.compiled.json";
import {
  data,
  keyToAddress,
  keyToIntString,
  prepareKey,
  toSha256Buffer,
} from "../contracts/sources-registry";

const specs = [
  {
    codeCellHash: "E/XXoxbG124QU+iKxZtd5loHKjiEUTcdxcW+y7oT9Q4=",
    verifier: "my verifier",
    jsonURL: "https://myjson.com/sources.json",
  },
];

describe("Sources", () => {
  let sourceRegistryContract: { contract: SmartContract; address: Address };

  const childAddressFromChain = async (verifier: string, codeCellHash: string) => {
    const childFromChain = await sourceRegistryContract.contract.invokeGetMethod(
      "get_source_item_address",
      [
        {
          type: "int",
          value: new BN(toSha256Buffer(verifier)).toString(),
        },
        {
          type: "int",
          value: new BN(Buffer.from(codeCellHash, "base64")).toString(),
        },
      ]
    );
    return (childFromChain.result[0] as Slice).readAddress()!;
  };

  beforeEach(async () => {
    const codeCell = Cell.fromBoc(sourceRegistryHex)[0]; // code cell from build output;
    const dataCell = sourcesRegistry.data({
      admin: randomAddress("admin"),
      verifierRegistryAddress: randomAddress("verifierReg"),
    });

    const ca = contractAddress({
      workchain: 0,
      initialCode: codeCell,
      initialData: dataCell,
    });

    sourceRegistryContract = {
      contract: await SmartContract.fromCell(codeCell, dataCell, { debug: true }),
      address: ca,
    };

    sourceRegistryContract.contract.setC7Config({ myself: ca });
  });

  it("should deploy a source contract item", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("verifierReg"),
        body: sourcesRegistry.deploySource(
          specs[0].verifier,
          specs[0].codeCellHash,
          specs[0].jsonURL
        ),
      })
    );

    const msg = send.actionList[0] as SendMsgAction;

    const sourceItemContract = await SmartContract.fromCell(
      msg.message.init!.code!,
      msg.message.init!.data!
    );

    expect(await parseUrlFromGetSourceItemData(sourceItemContract)).to.be.null;

    await sourceItemContract.sendInternalMessage(
      internalMessage({
        from: sourceRegistryContract.address,
        body: msg.message.body,
      })
    );

    expect(await parseUrlFromGetSourceItemData(sourceItemContract)).to.equal(specs[0].jsonURL);
  });

  it("returns source item address", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("verifierReg"),
        body: sourcesRegistry.deploySource(
          specs[0].verifier,
          specs[0].codeCellHash,
          specs[0].jsonURL
        ),
      })
    );

    const childFromChain = await childAddressFromChain(specs[0].verifier, specs[0].codeCellHash);

    expect((send.actionList[0] as SendMsgAction).message.info.dest?.toFriendly()).to.equal(
      childFromChain.toFriendly()
    );
  });

  it("returns different source item addresses for different verifiers", async () => {
    const childFromChain = await childAddressFromChain(specs[0].verifier, specs[0].codeCellHash);
    const childFromChain2 = await childAddressFromChain(
      specs[0].verifier + 1,
      specs[0].codeCellHash
    );

    expect(childFromChain.toFriendly()).to.not.equal(childFromChain2.toFriendly());
  });

  it("returns different source item addresses for different code cell hashes", async () => {
    const childFromChain = await childAddressFromChain(specs[0].verifier, specs[0].codeCellHash);
    const childFromChain2 = await childAddressFromChain(
      specs[0].verifier,
      "E/XXoxbG124QU+iKxZtd5loHKjiEUTcdxcW+y7oT9ZZ="
    );

    expect(childFromChain.toFriendly()).to.not.equal(childFromChain2.toFriendly());
  });

  it("disallows a non-verifier reg to deploy a source item", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("not_verifier_reg"),
        body: sourcesRegistry.deploySource(
          specs[0].verifier,
          specs[0].codeCellHash,
          specs[0].jsonURL
        ),
      })
    );

    expect(send.exit_code).to.equal(401);
  });

  it("changes the verifier registry", async () => {
    await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("admin"),
        body: sourcesRegistry.changeVerifierRegistry(randomAddress("newVerifierRegistry")),
      })
    );

    const res = await sourceRegistryContract.contract.invokeGetMethod("get_verifier_registry_address", []);

    expect((res.result[0] as Slice).readAddress()?.toFriendly()).to.equal(randomAddress("newVerifierRegistry").toFriendly());

    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("newVerifierRegistry"),
        body: sourcesRegistry.deploySource(
          specs[0].verifier,
          specs[0].codeCellHash,
          specs[0].jsonURL
        ),
      })
    );

    expect(send.type).to.equal("success");
    expect(send.exit_code).to.equal(0);
  });

  it("disallows a non admin to change the verifier registry", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("notadmin"),
        body: sourcesRegistry.changeVerifierRegistry(randomAddress("newadmin")),
      })
    );

    expect(send.exit_code).to.equal(401);
  });
  
  it("allows the admin to change admin", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("admin"),
        body: sourcesRegistry.changeAdmin(randomAddress("newadmin")),
      })
    );

    const res = await sourceRegistryContract.contract.invokeGetMethod("get_admin_address", []);

    expect((res.result[0] as Slice).readAddress()?.toFriendly()).to.equal(randomAddress("newadmin").toFriendly());
  });

  it("disallows a non admin to change the admin", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("notadmin"),
        body: sourcesRegistry.changeAdmin(randomAddress("newadmin")),
      })
    );

    expect(send.exit_code).to.equal(401);
  });
  
  it("allows the admin to set code", async () => {
    const newCodeCell = beginCell().storeBit(1).endCell();

    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("admin"),
        body: sourcesRegistry.changeCode(newCodeCell),
      })
    );

    expect(sourceRegistryContract.contract.codeCell.hash().toString()).to.equal(newCodeCell.hash().toString());
  });

  it("disallows a non admin to set code", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("notadmin"),
        body: sourcesRegistry.changeCode(new Cell()),
      })
    );

    expect(send.exit_code).to.equal(401);
  });
});

async function parseUrlFromGetSourceItemData(contract: SmartContract): Promise<string | null> {
  const res = await contract.invokeGetMethod("get_source_item_data", []);
  if (res.result[4] !== null) {
    return (res.result[4] as Cell).beginParse().readRemainingBytes().toString("ascii");
  }
  return null;
}
