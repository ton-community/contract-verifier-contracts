import { RegistryData, Verifier, Queries, buildMsgDescription } from "./verifier-registry";
import { Cell, CellMessage, CommonMessageInfo, InternalMessage, toNano } from "ton";
import { VerifierRegistry } from "./verifier-registry";
import { SendMsgAction } from "ton-contract-executor";
import BN from "bn.js";
import { beginCell } from "ton/dist";
import { sign } from "ton-crypto";
import { createHash } from "crypto";
import { randomAddress, randomKeyPair } from "./helpers";
import { expect } from "chai";

const ADMIN1_ADDRESS = randomAddress("ADMIN1");

export async function genDefaultVerifierRegistryConfig(quorum = 2) {
  let kp = await randomKeyPair();
  let kp2 = await randomKeyPair();
  let kp3 = await randomKeyPair();
  return {
    keys: [kp, kp2, kp3],
    data: {
      verifiers: new Map<BN, Verifier>([
        [
          sha256BN("verifier1"),
          {
            admin: ADMIN1_ADDRESS,
            quorum,
            name: "verifier1",
            pub_key_endpoints: new Map<BN, number>([
              [new BN(kp.publicKey), ip2num("1.2.3.0")],
              [new BN(kp2.publicKey), ip2num("1.2.3.1")],
              [new BN(kp3.publicKey), ip2num("1.2.3.2")],
            ]),
            marketingUrl: "https://myverifier.com",
          },
        ],
      ]),
    } as RegistryData,
  };
}

describe("Verifier Registry", () => {
  it("should update verifier", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);

    let kp3 = await randomKeyPair();

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: ADMIN1_ADDRESS,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.updateVerifier({
              id: sha256BN("verifier1"),
              quorum: 7,
              endpoints: new Map<BN, number>([[new BN(kp3.publicKey), ip2num("10.0.0.1")]]),
              name: "verifier1",
              marketingUrl: "https://myverifier.com",
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(0);
    expect(res.type).to.equal("success");

    let data = await contract.getVerifier(sha256BN("verifier1"));
    let sets = (data.settings as Cell).beginParse();
    let quorum = sets.readUint(8);
    let settings = sets.readDict<number>(256, function (slice) {
      return slice.readUint(32).toNumber();
    });
    let ip = settings.get(new BN(kp3.publicKey).toString());

    console.log(res.gas_consumed);
    expect(data.admin?.toFriendly()).to.equal(ADMIN1_ADDRESS.toFriendly());
    expect(ip).to.equal(ip2num("10.0.0.1"));
    expect(quorum.toNumber()).to.equal(7);

    let excess = res.actionList[0] as SendMsgAction;
    expect(excess.message.info.dest?.toFriendly()).to.equal(ADMIN1_ADDRESS.toFriendly());
    expect(excess.mode).to.equal(64 + 2);

    let body = excess.message.body.beginParse();
    expect(body.readUint(32).toNumber()).to.equal(0);
    expect(body.readBuffer(body.remaining / 8).toString()).to.equal(
      "You successfully updated verifier data"
    );
  });

  it("should reject verifier updates with too large config", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);

    let kp3 = await randomKeyPair();

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: ADMIN1_ADDRESS,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.updateVerifier({
              id: sha256BN("verifier1"),
              quorum: 7,
              endpoints: new Map<BN, number>(
                Array(1000)
                  .fill("")
                  .map((_, i) => [new BN(kp3.publicKey).sub(new BN(i)), ip2num("10.0.0.0")])
              ),
              name: "verifier1",
              marketingUrl: "https://myverifier.com",
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(402);
  });

  it("should not update verifier", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);

    let kp3 = await randomKeyPair();

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: randomAddress("someSeed"),
        value: toNano(10000),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.updateVerifier({
              id: sha256BN("verifier1"),
              quorum: 7,
              endpoints: new Map<BN, number>([[new BN(kp3.publicKey), ip2num("10.0.0.1")]]),
              name: "verifier1",
              marketingUrl: "https://myverifier.com",
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(401);
  });

  it("should not add verifier", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);

    let kp3 = await randomKeyPair();

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: randomAddress("someSeed"),
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.updateVerifier({
              id: sha256BN("verifier_new"),
              quorum: 7,
              endpoints: new Map<BN, number>([[new BN(kp3.publicKey), ip2num("10.0.0.1")]]),
              name: "verifier_new",
              marketingUrl: "https://myverifier.com",
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(410);
  });

  it("should remove verifier", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: ADMIN1_ADDRESS,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.removeVerifier({
              id: sha256BN("verifier1"),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(0);
    expect(res.type).to.equal("success");

    let exit = res.actionList[0] as SendMsgAction;
    expect(exit.message.info.dest?.toFriendly()).to.equal(ADMIN1_ADDRESS.toFriendly());
    expect(exit.message.info.type).to.equal("internal");
    if (exit.message.info.type === "internal") {
      expect(exit.message.info.value.coins.toNumber()).to.equal(
        toNano(10000).sub(toNano("0.2")).toNumber()
      );
    }
    expect(exit.mode).to.equal(64);

    let body = exit.message.body.beginParse();
    expect(body.readUint(32).toNumber()).to.equal(0);
    expect(body.readBuffer(body.remaining / 8).toString()).to.equal(
      "Withdrawal and exit from the verifier registry"
    );

    let data = await contract.getVerifier(sha256BN("verifier1"));
    expect(data.settings).to.equal(null);
  });

  it("should not remove verifier", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: randomAddress("someSeed"),
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.removeVerifier({
              id: sha256BN("verifier1"),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(401);
  });

  it("should not remove verifier, not found", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: randomAddress("someSeed"),
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.removeVerifier({
              id: new BN(223),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(404);
  });

  it("should forward message", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
                [new BN(cfg.keys[1].publicKey), sign(desc.hash(), cfg.keys[1].secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(0);
    expect(res.type).to.equal("success");

    let excess = res.actionList[0] as SendMsgAction;
    expect(excess.message.info.dest?.toFriendly()).to.equal(dst.toFriendly());
    expect(excess.mode).to.equal(64);

    let body = excess.message.body.beginParse();
    expect(body.readUint(32).toNumber()).to.equal(777);
  });

  it("should forward message, 2 out of 3 correct, quorum = 2", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
                [new BN(cfg.keys[1].publicKey), sign(desc.hash(), cfg.keys[1].secretKey)],
                [new BN(cfg.keys[2].publicKey), sign(desc.hash(), cfg.keys[1].secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(0);
    expect(res.type).to.equal("success");

    let excess = res.actionList[0] as SendMsgAction;
    expect(excess.message.info.dest?.toFriendly()).to.equal(dst.toFriendly());
    expect(excess.mode).to.equal(64);

    let body = excess.message.body.beginParse();
    expect(body.readUint(32).toNumber()).to.equal(777);
  });

  it("should not forward message, 1 sign of 2", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(413);
  });

  it("should not forward message, 2 same signs", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(413);
  });

  it("should not forward message, no signs", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([]),
            })
          ),
        }),
      })
    );

    expect(res.type).to.equal("failed");
  });

  it("should not forward message, 2 signs, 1 invalid", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
                [new BN(cfg.keys[1].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(413);
  });

  it("should not forward message, expired", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 999, src, dst, msgBody);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
                [new BN(cfg.keys[1].publicKey), sign(desc.hash(), cfg.keys[1].secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(411);
  });

  it("should not forward message, wrong sender", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed2");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(
      sha256BN("verifier1"),
      1500,
      randomAddress("someSeed3"),
      dst,
      msgBody
    );

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
                [new BN(cfg.keys[1].publicKey), sign(desc.hash(), cfg.keys[1].secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(414);
  });

  it("should not forward message, unknown verifier", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(new BN(333), 1500, src, dst, msgBody);

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(cfg.keys[0].publicKey), sign(desc.hash(), cfg.keys[0].secretKey)],
                [new BN(cfg.keys[1].publicKey), sign(desc.hash(), cfg.keys[1].secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(404);
  });

  it("should add new verifier", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let user = randomAddress("someSeed");

    let kp3 = await randomKeyPair();

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: user,
        value: toNano(10005),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.updateVerifier({
              id: sha256BN("verifier2"),
              quorum: 7,
              endpoints: new Map<BN, number>([[new BN(kp3.publicKey), ip2num("10.0.0.1")]]),
              name: "verifier2",
              marketingUrl: "https://myverifier.com",
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(0);
    expect(res.type).to.equal("success");

    let data = await contract.getVerifier(sha256BN("verifier2"));
    let sets = (data.settings as Cell).beginParse();
    let quorum = sets.readUint(8);
    let settings = sets.readDict<number>(256, function (slice) {
      return slice.readUint(32).toNumber();
    });
    let ip = settings.get(new BN(kp3.publicKey).toString());

    console.log(res.gas_consumed);
    expect(data.admin?.toFriendly()).to.equal(user.toFriendly());
    expect(ip).to.equal(ip2num("10.0.0.1"));
    expect(quorum.toNumber()).to.equal(7);

    let excess = res.actionList[0] as SendMsgAction;
    expect(excess.message.info.dest?.toFriendly()).to.equal(user.toFriendly());
    expect(excess.message.info.type).to.equal("internal");
    if (excess.message.info.type === "internal") {
      expect(excess.message.info.value.coins.toNumber()).to.equal(toNano(5).toNumber());
    }
    expect(excess.mode).to.equal(1);

    let body = excess.message.body.beginParse();
    expect(body.readUint(32).toNumber()).to.equal(0);
    expect(body.readBuffer(body.remaining / 8).toString()).to.equal(
      "You were successfully registered as a verifier"
    );
  });

  it("should not add new verifier, 20 limit", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 20);
    let user = randomAddress("someSeed");

    let kp3 = await randomKeyPair();

    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: user,
        value: toNano(10005),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.updateVerifier({
              id: sha256BN("verifier2"),
              quorum: 7,
              endpoints: new Map<BN, number>([[new BN(kp3.publicKey), ip2num("10.0.0.1")]]),
              name: "verifier2",
              marketingUrl: "https://myverifier.com",
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(419);
  });

  it("full scenario", async () => {
    let cfg = await genDefaultVerifierRegistryConfig();
    let contract = await VerifierRegistry.createFromConfig(cfg.data, 1);
    let user = randomAddress("someSeed");

    let kp3 = await randomKeyPair();

    // add
    let res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: user,
        value: toNano(10005),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.updateVerifier({
              id: sha256BN("verifier2"),
              quorum: 7,
              endpoints: new Map<BN, number>([[new BN(kp3.publicKey), ip2num("10.0.0.1")]]),
              name: "verifier2",
              marketingUrl: "https://myverifier.com",
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(0);
    expect(res.type).to.equal("success");

    let data = await contract.getVerifier(sha256BN("verifier2"));
    let sets = (data.settings as Cell).beginParse();
    let quorum = sets.readUint(8);
    let settings = sets.readDict<number>(256, function (slice) {
      return slice.readUint(32).toNumber();
    });
    let ip = settings.get(new BN(kp3.publicKey).toString());

    expect(ip).to.equal(ip2num("10.0.0.1"));
    expect(quorum.toNumber()).to.equal(7);

    let verifiersNum = await contract.getVerifiersNum();
    expect(verifiersNum).to.equal(2);

    // update
    res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: user,
        value: toNano(5),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.updateVerifier({
              id: sha256BN("verifier2"),
              quorum: 1,
              endpoints: new Map<BN, number>([[new BN(kp3.publicKey), ip2num("10.0.0.2")]]),
              name: "verifier2",
              marketingUrl: "https://myverifier.com",
            })
          ),
        }),
      })
    );

    data = await contract.getVerifier(sha256BN("verifier2"));
    sets = (data.settings as Cell).beginParse();
    quorum = sets.readUint(8);
    settings = sets.readDict<number>(256, function (slice) {
      return slice.readUint(32).toNumber();
    });
    ip = settings.get(new BN(kp3.publicKey).toString());

    expect(ip).to.equal(ip2num("10.0.0.2"));
    expect(quorum.toNumber()).to.equal(1);

    verifiersNum = await contract.getVerifiersNum();
    expect(verifiersNum).to.equal(2);

    // forward
    let src = randomAddress("someSeed");
    let dst = randomAddress("someSeed");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier2"), 1500, src, dst, msgBody);

    res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(kp3.publicKey), sign(desc.hash(), kp3.secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(0);

    let excess = res.actionList[0] as SendMsgAction;
    expect(excess.message.info.dest?.toFriendly()).to.equal(dst.toFriendly());
    expect(excess.mode).to.equal(64);

    // remove
    res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: user,
        value: toNano(1),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.removeVerifier({
              id: sha256BN("verifier2"),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(0);

    verifiersNum = await contract.getVerifiersNum();
    expect(verifiersNum).to.equal(1);

    // should not forward

    res = await contract.contract.sendInternalMessage(
      new InternalMessage({
        to: contract.address,
        from: src,
        value: toNano(3),
        bounce: false,
        body: new CommonMessageInfo({
          body: new CellMessage(
            Queries.forwardMessage({
              desc,
              signatures: new Map<BN, Buffer>([
                [new BN(kp3.publicKey), sign(desc.hash(), kp3.secretKey)],
              ]),
            })
          ),
        }),
      })
    );

    expect(res.exit_code).to.equal(404);
  });

  it("should retrieve verifiers data", async () => {
    let contract = await VerifierRegistry.createFromConfig({ verifiers: new Map() }, 0);
    let user = randomAddress("someSeed");

    let kp3 = await randomKeyPair();

    const verifierConfig = [
      ["verifier1", "http://verifier1.com"],
      ["verifier2", "http://verifier2.com"],
      ["verifier3", "http://verifier3.com"],
    ];

    for (const [name, url] of verifierConfig) {
      await contract.contract.sendInternalMessage(
        new InternalMessage({
          to: contract.address,
          from: user,
          value: toNano(10005),
          bounce: false,
          body: new CommonMessageInfo({
            body: new CellMessage(
              Queries.updateVerifier({
                id: sha256BN(name),
                quorum: 7,
                endpoints: new Map<BN, number>([[new BN(kp3.publicKey), ip2num("10.0.0.1")]]),
                name: name,
                marketingUrl: url,
              })
            ),
          }),
        })
      );
    }

    const verifiers = await contract.getVerifiers();

    for (const [name, url] of verifierConfig) {
      const actualVerifier = verifiers.find((v) => v.name === name)!;
      const [pub_key, ipnum] = actualVerifier.pub_key_endpoints.entries().next().value;

      expect(ipnum).to.equal(ip2num("10.0.0.1"));
      expect(pub_key.toString()).to.equal(new BN(kp3.publicKey).toString());
      expect(actualVerifier.admin.toFriendly()).to.equal(user.toFriendly());
      expect(actualVerifier.quorum).to.equal(7);
      expect(actualVerifier.name).to.equal(name);
      expect(actualVerifier.marketingUrl).to.equal(url);
    }
  });
});

export function sha256BN(name: string) {
  return new BN(createHash("sha256").update(name).digest());
}

function ip2num(ip: string) {
  let d = ip.split(".");
  return ((+d[0] * 256 + +d[1]) * 256 + +d[2]) * 256 + +d[3];
}
