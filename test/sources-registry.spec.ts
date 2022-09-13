import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import { Address, Cell, contractAddress, Slice } from "ton";
import { OutAction, SendMsgAction, SmartContract } from "ton-contract-executor";
import * as sourcesRegistry from "../contracts/sources-registry";
import { internalMessage, randomAddress } from "./helpers";

import { hex as sourceRegistryHex } from "../build/sources-registry.compiled.json";
import { hex as sourceItemHex } from "../build/source-item.compiled.json";
import { data, keyToAddress, keyToIntString, prepareKey } from "../contracts/sources-registry";

const specs = [
  {
    codeCellHash: "E/XXoxbG124QU+iKxZtd5loHKjiEUTcdxcW+y7oT9Q4=",
    verifier: 0,
    jsonURL: "https://myjson.com/sources.json",
  },
];

describe("Sources", () => {
  let sourceRegistryContract: { contract: SmartContract; address: Address };

  const childAddressFromChain = async (verifier: number, codeCellHash: string) => {
    const childFromChain = await sourceRegistryContract.contract.invokeGetMethod(
      "get_source_item_address",
      [
        {
          type: "int",
          value: new BN(verifier).toString(),
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
      ownerAddress: randomAddress("owner"),
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
        from: randomAddress("owner"),
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

    expect(await parseUrlFromGetNftData(sourceItemContract)).to.be.null;

    await sourceItemContract.sendInternalMessage(
      internalMessage({
        from: sourceRegistryContract.address,
        body: msg.message.body,
      })
    );

    expect(await parseUrlFromGetNftData(sourceItemContract)).to.equal(specs[0].jsonURL);
  });

  it("returns source item address", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("owner"),
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

  it("disallows a non-owner to deploy a source item", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("notowner"),
        body: sourcesRegistry.deploySource(
          specs[0].verifier,
          specs[0].codeCellHash,
          specs[0].jsonURL
        ),
      })
    );

    expect(send.exit_code).to.equal(401);
  });

  it("changes the owner", async () => {
    await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("owner"),
        body: sourcesRegistry.changeOwner(randomAddress("newowner")),
      })
    );

    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("newowner"),
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

  it("disallows a non-owner to change the owner", async () => {
    const send = await sourceRegistryContract.contract.sendInternalMessage(
      internalMessage({
        from: randomAddress("notowner"),
        body: sourcesRegistry.changeOwner(randomAddress("newowner")),
      })
    );

    expect(send.exit_code).to.equal(401);
  });
});

async function parseUrlFromGetNftData(contract: SmartContract): Promise<string | null> {
  const res = await contract.invokeGetMethod("get_nft_data", []);
  if (res.result[4] !== null) {
    return (res.result[4] as Cell).beginParse().readRemainingBytes().toString("ascii");
  }
  return null;
}
