import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import nacl from "tweetnacl";

import { Address, Slice, beginCell } from "ton";
import { OutAction, SendMsgAction, SmartContract } from "ton-contract-executor";
import * as verifierRegistry from "../contracts/verifier-registry";
import { internalMessage, randomAddress } from "./helpers";

import { hex as verifierRegistryHex } from "../build/verifier-registry.compiled.json";
import { makeContract } from "./makeContract";

describe("Verifier Registry", () => {
  let verifierRegistryContract: { contract: SmartContract; address: Address };
  const kp = nacl.sign.keyPair();
  const sourcesRegistryAddress = randomAddress("sources-reg");

  beforeEach(async () => {
    verifierRegistryContract = await makeContract(
      verifierRegistryHex,
      verifierRegistry.data({
        publicKey: Buffer.from(kp.publicKey),
        sourcesRegistry: sourcesRegistryAddress,
      })
    );
  });

  it("Refuses to send a message not signed by the public key", async () => {
    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(
          beginCell().storeUint(1, 1).endCell(),
          Buffer.alloc(64, "0")
        ),
      })
    );

    expect(send.exit_code).to.equal(999);
  });

  it("Refuses to send an empty message", async () => {
    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(beginCell().endCell(), Buffer.alloc(64, "1")),
      })
    );

    // console.log(send);
    expect(send.exit_code).to.equal(998);
  });

  it("Sends a message to the sources registry contract", async () => {
    const msg = beginCell().storeUint(2, 4).endCell();

    const sig = nacl.sign.detached(msg.hash(), kp.secretKey);
    const send = await verifierRegistryContract.contract.sendInternalMessage(
      internalMessage({
        body: verifierRegistry.sendMessage(msg, Buffer.from(sig)),
      })
    );

    expect(send.type).to.equal("success");
    expect(send.exit_code).to.equal(0);

    const messageToSourcesReg = (send.actionList[0] as SendMsgAction).message;

    // Message is sent to sources registry
    expect(messageToSourcesReg.info.dest!.toFriendly()).to.equal(
      sourcesRegistryAddress.toFriendly()
    );

    // Original message is forwarded as-is
    expect(messageToSourcesReg.body.beginParse().readRef().toCell().hash().toString()).to.equal(
      msg.hash().toString()
    );
  });
});
