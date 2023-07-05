import { expect } from "chai";

import { Cell, toNano, Dictionary, Contract, beginCell } from "ton-core";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { sign, KeyPair } from "ton-crypto";
import "@ton-community/test-utils";
import { toBigIntBE } from "bigint-buffer";
import { compile } from "@ton-community/blueprint";

import { randomAddress, randomKeyPair } from "./helpers";
import {
  RegistryData,
  VerifierConfig,
  buildMsgDescription,
  VerifierRegistry,
} from "../../wrappers/verifier-registry";
import { ip2num, sha256BN } from "./helpers";
import { transactionsFrom } from "./helpers";

export async function genDefaultVerifierRegistryConfig(
  admin: SandboxContract<Contract>,
  quorum = 2
) {
  let kp = await randomKeyPair();
  let kp2 = await randomKeyPair();
  let kp3 = await randomKeyPair();
  return {
    keys: [kp, kp2, kp3],
    data: {
      verifiers: new Map<bigint, VerifierConfig>([
        [
          sha256BN("verifier1"),
          {
            admin: admin.address,
            quorum,
            name: "verifier1",
            pub_key_endpoints: new Map<bigint, number>([
              [toBigIntBE(kp.publicKey), ip2num("1.2.3.0")],
              [toBigIntBE(kp2.publicKey), ip2num("1.2.3.1")],
              [toBigIntBE(kp3.publicKey), ip2num("1.2.3.2")],
            ]),
            marketingUrl: "https://myverifier.com",
          },
        ],
      ]),
    } as RegistryData,
  };
}

describe("Verifier Registry", () => {
  let code: Cell;

  let blockchain: Blockchain;
  let verifierRegistry: SandboxContract<VerifierRegistry>;
  let admin: SandboxContract<TreasuryContract>;
  let keys: KeyPair[];

  before(async () => {
    code = await compile("verifier-registry");
  });

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    blockchain.now = 1000;

    admin = await blockchain.treasury("admin");

    let cfg = await genDefaultVerifierRegistryConfig(admin);
    keys = cfg.keys;

    verifierRegistry = blockchain.openContract(
      VerifierRegistry.createFromConfig(code, cfg.data, 1)
    );

    const deployResult = await verifierRegistry.sendDeploy(admin.getSender(), toNano("10005"));

    expect(deployResult.transactions).to.have.transaction({
      from: admin.address,
      to: verifierRegistry.address,
      deploy: true,
      success: true,
    });
  });

  it("should update verifier", async () => {
    let kp3 = await randomKeyPair();

    let res = await verifierRegistry.sendUpdateVerifier(admin.getSender(), {
      id: sha256BN("verifier1"),
      quorum: 7,
      endpoints: new Map<bigint, number>([[toBigIntBE(kp3.publicKey), ip2num("10.0.0.1")]]),
      name: "verifier1",
      marketingUrl: "https://myverifier.com",
      value: toNano(1),
    });

    expect(res.transactions).to.have.transaction({
      from: admin.address,
      success: true,
    });

    let data = await verifierRegistry.getVerifier(sha256BN("verifier1"));
    let sets = (data.settings as Cell).beginParse();
    let quorum = sets.loadUint(8);
    let settings = sets.loadDict<bigint, number>(
      Dictionary.Keys.BigUint(256),
      Dictionary.Values.Int(32)
    );

    let ip = settings.get(toBigIntBE(kp3.publicKey));
    expect(data.admin).to.equalAddress(admin.address);
    expect(ip).to.equal(ip2num("10.0.0.1"));
    expect(quorum).to.equal(7);

    let outMessages = transactionsFrom(res.transactions, admin.address)[0].outMessages;
    let excess = outMessages.values()[0];

    expect(excess.info.dest).to.equalAddress(admin.address);
    // expect(excess.mode).to.equal(64 + 2); // TODO

    let body = excess.body.beginParse();
    expect(body.loadUint(32)).to.equal(0);
    expect(body.loadBuffer(body.remainingBits / 8).toString()).to.equal(
      "You successfully updated verifier data"
    );
  });

  it("should reject verifier updates with too large config", async () => {
    let kp3 = await randomKeyPair();

    let res = await verifierRegistry.sendUpdateVerifier(admin.getSender(), {
      id: sha256BN("verifier1"),
      quorum: 7,
      endpoints: new Map<bigint, number>(
        Array(1000)
          .fill("")
          .map((_, i) => [toBigIntBE(kp3.publicKey) - BigInt(i), ip2num("10.0.0.0")])
      ),
      name: "verifier1",
      marketingUrl: "https://myverifier.com",
      value: toNano(1),
    });

    expect(res.transactions).to.have.transaction({
      from: admin.address,
      exitCode: 402,
    });
  });

  it("should not update verifier", async () => {
    let kp3 = await randomKeyPair();
    let fakeAdmin = randomAddress("fakeAdmin");

    let res = await verifierRegistry.sendUpdateVerifier(blockchain.sender(fakeAdmin), {
      id: sha256BN("verifier1"),
      quorum: 7,
      endpoints: new Map<bigint, number>([[toBigIntBE(kp3.publicKey), ip2num("10.0.0.1")]]),
      name: "verifier1",
      marketingUrl: "https://myverifier.com",
      value: toNano(1),
    });

    expect(res.transactions).to.have.transaction({
      from: fakeAdmin,
      exitCode: 401,
    });
  });

  it("should not add verifier", async () => {
    let kp3 = await randomKeyPair();
    let fakeAdmin = randomAddress("fakeAdmin");

    let res = await verifierRegistry.sendUpdateVerifier(blockchain.sender(fakeAdmin), {
      id: sha256BN("verifier_new"),
      quorum: 7,
      endpoints: new Map<bigint, number>([[toBigIntBE(kp3.publicKey), ip2num("10.0.0.1")]]),
      name: "verifier_new",
      marketingUrl: "https://myverifier.com",
      value: toNano(1),
    });

    expect(res.transactions).to.have.transaction({
      from: fakeAdmin,
      exitCode: 410,
    });
  });

  it("should remove verifier", async () => {
    let res = await verifierRegistry.sendRemoveVerifier(admin.getSender(), {
      id: sha256BN("verifier1"),
      value: toNano(1),
    });

    expect(res.transactions).to.have.transaction({
      from: admin.address,
      exitCode: 0,
    });

    let outMessages = transactionsFrom(res.transactions, admin.address)[0].outMessages;
    let exit = outMessages.values()[0];

    expect(exit.info.dest).to.equalAddress(admin.address);
    expect(exit.info.type).to.equal("internal");
    if (exit.info.type === "internal") {
      expect(Number(exit.info.value.coins)).to.be.gte(
        // TODO
        Number(toNano(10000) - toNano("0.2"))
      );
    }
    // expect(exit.mode).to.equal(64); TODO

    let body = exit.body.beginParse();
    expect(body.loadUint(32)).to.equal(0);
    expect(body.loadBuffer(body.remainingBits / 8).toString()).to.equal(
      "Withdrawal and exit from the verifier registry"
    );

    let data = await verifierRegistry.getVerifier(sha256BN("verifier1"));
    expect(data.settings).to.equal(null);
  });

  it("should not remove verifier", async () => {
    let fakeAdmin = randomAddress("fakeadmin");
    let res = await verifierRegistry.sendRemoveVerifier(blockchain.sender(fakeAdmin), {
      id: sha256BN("verifier1"),
      value: toNano(1),
    });

    expect(res.transactions).to.have.transaction({
      from: fakeAdmin,
      exitCode: 401,
    });
  });

  it("should not remove verifier, not found", async () => {
    let fakeAdmin = randomAddress("fakeadmin");

    let res = await verifierRegistry.sendRemoveVerifier(blockchain.sender(fakeAdmin), {
      id: BigInt(223),
      value: toNano(1),
    });

    expect(res.transactions).to.have.transaction({
      from: fakeAdmin,
      exitCode: 404,
    });
  });

  it("should forward message", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
        [toBigIntBE(keys[1].publicKey), sign(desc.hash(), keys[1].secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 0,
      aborted: false,
    });

    let outMessages = transactionsFrom(res.transactions, src)[0].outMessages;
    let excess = outMessages.values()[0];
    expect(excess.info.dest).to.equalAddress(dst);
    // expect(excess.mode).to.equal(64);

    let body = excess.body.beginParse();
    expect(body.loadUint(32)).to.equal(777);
  });

  it("should forward message, 2 out of 3 correct, quorum = 2", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
        [toBigIntBE(keys[1].publicKey), sign(desc.hash(), keys[1].secretKey)],
        [toBigIntBE(keys[2].publicKey), sign(desc.hash(), keys[1].secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 0,
      aborted: false,
    });

    let outMessages = transactionsFrom(res.transactions, src)[0].outMessages;
    let excess = outMessages.values()[0];
    expect(excess.info.dest).to.equalAddress(dst);
    // expect(excess.mode).to.equal(64); TODO

    let body = excess.body.beginParse();
    expect(body.loadUint(32)).to.equal(777);
  });

  it("should not forward message, 1 sign of 2", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 413,
    });
  });

  it("should not forward message, 2 same signs", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 413,
    });
  });

  it("should not forward message, no signs", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([]),
      value: toNano(3),
    });
    expect(res.transactions).to.have.transaction({
      from: src,
      aborted: true,
    });
  });

  it("should not forward message, 2 signs, 1 invalid", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 1500, src, dst, msgBody).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
        [toBigIntBE(keys[1].publicKey), sign(desc.hash(), keys[0].secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 413,
    });
  });

  it("should not forward message, expired", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier1"), 999, src, dst, msgBody).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
        [toBigIntBE(keys[1].publicKey), sign(desc.hash(), keys[1].secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 411,
    });
  });

  it("should not forward message, wrong sender", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(
      sha256BN("verifier1"),
      1500,
      randomAddress("someSeed3"),
      dst,
      msgBody
    ).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
        [toBigIntBE(keys[1].publicKey), sign(desc.hash(), keys[1].secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 414,
    });
  });

  it("should not forward message, unknown verifier", async () => {
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(BigInt(333), 1500, src, dst, msgBody).endCell();

    let res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(keys[0].publicKey), sign(desc.hash(), keys[0].secretKey)],
        [toBigIntBE(keys[1].publicKey), sign(desc.hash(), keys[1].secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 404,
    });
  });

  it("should add new verifier", async () => {
    let user = randomAddress("user");

    let kp3 = await randomKeyPair();

    let res = await verifierRegistry.sendUpdateVerifier(blockchain.sender(user), {
      id: sha256BN("verifier2"),
      quorum: 7,
      endpoints: new Map<bigint, number>([[toBigIntBE(kp3.publicKey), ip2num("10.0.0.1")]]),
      name: "verifier2",
      marketingUrl: "https://myverifier.com",
      value: toNano(10005),
    });

    expect(res.transactions).to.have.transaction({
      from: user,
      exitCode: 0,
      aborted: false,
    });

    let data = await verifierRegistry.getVerifier(sha256BN("verifier2"));
    let sets = (data.settings as Cell).beginParse();
    let quorum = sets.loadUint(8);
    let settings = sets.loadDict(Dictionary.Keys.BigUint(256), Dictionary.Values.Uint(32));
    let ip = settings.get(toBigIntBE(kp3.publicKey));

    expect(data.admin).to.equalAddress(user);
    expect(ip).to.equal(ip2num("10.0.0.1"));
    expect(quorum).to.equal(7);

    let outMessages = transactionsFrom(res.transactions, user)[0].outMessages;
    let excess = outMessages.values()[0];

    expect(excess.info.dest).to.equalAddress(user);
    expect(excess.info.type).to.equal("internal");
    if (excess.info.type === "internal") {
      expect(excess.info.value.coins).to.equal(toNano(5));
    }
    // expect(excess.mode).to.equal(1); TODO

    let body = excess.body.beginParse();
    expect(body.loadUint(32)).to.equal(0);
    expect(body.loadBuffer(body.remainingBits / 8).toString()).to.equal(
      "You were successfully registered as a verifier"
    );
  });

  it("should not add new verifier, 20 limit", async () => {
    let cfg = await genDefaultVerifierRegistryConfig(admin);
    verifierRegistry = blockchain.openContract(
      VerifierRegistry.createFromConfig(code, cfg.data, 20)
    );
    await verifierRegistry.sendDeploy(admin.getSender(), toNano("10005"));

    let user = randomAddress("user");

    let kp3 = await randomKeyPair();

    let res = await verifierRegistry.sendUpdateVerifier(blockchain.sender(user), {
      id: sha256BN("verifier2"),
      quorum: 7,
      endpoints: new Map<bigint, number>([[toBigIntBE(kp3.publicKey), ip2num("10.0.0.1")]]),
      name: "verifier2",
      marketingUrl: "https://myverifier.com",
      value: toNano(10005),
    });

    expect(res.transactions).to.have.transaction({
      from: user,
      exitCode: 419,
    });
  });

  it("full scenario", async () => {
    let user = randomAddress("user");

    let kp3 = await randomKeyPair();

    // add
    let res = await verifierRegistry.sendUpdateVerifier(blockchain.sender(user), {
      id: sha256BN("verifier2"),
      quorum: 7,
      endpoints: new Map<bigint, number>([[toBigIntBE(kp3.publicKey), ip2num("10.0.0.1")]]),
      name: "verifier2",
      marketingUrl: "https://myverifier.com",
      value: toNano(10005),
    });

    expect(res.transactions).to.have.transaction({
      from: user,
      exitCode: 0,
      aborted: false,
    });

    let data = await verifierRegistry.getVerifier(sha256BN("verifier2"));
    let sets = (data.settings as Cell).beginParse();
    let quorum = sets.loadUint(8);
    let settings = sets.loadDict(Dictionary.Keys.BigUint(256), Dictionary.Values.Uint(32));
    let ip = settings.get(toBigIntBE(kp3.publicKey));

    expect(ip).to.equal(ip2num("10.0.0.1"));
    expect(quorum).to.equal(7);

    let verifiersNum = await verifierRegistry.getVerifiersNum();
    expect(verifiersNum).to.equal(2);

    // update
    res = await verifierRegistry.sendUpdateVerifier(blockchain.sender(user), {
      id: sha256BN("verifier2"),
      quorum: 1,
      endpoints: new Map<bigint, number>([[toBigIntBE(kp3.publicKey), ip2num("10.0.0.2")]]),
      name: "verifier2",
      marketingUrl: "https://myverifier.com",
      value: toNano(5),
    });

    data = await verifierRegistry.getVerifier(sha256BN("verifier2"));
    sets = (data.settings as Cell).beginParse();
    quorum = sets.loadUint(8);
    settings = sets.loadDict(Dictionary.Keys.BigUint(256), Dictionary.Values.Uint(32));
    ip = settings.get(toBigIntBE(kp3.publicKey));

    expect(ip).to.equal(ip2num("10.0.0.2"));
    expect(quorum).to.equal(1);

    verifiersNum = await verifierRegistry.getVerifiersNum();
    expect(verifiersNum).to.equal(2);

    // forward
    let src = randomAddress("src");
    let dst = randomAddress("dst");
    let msgBody = beginCell().storeUint(777, 32).endCell();

    let desc = buildMsgDescription(sha256BN("verifier2"), 1500, src, dst, msgBody).endCell();

    res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(kp3.publicKey), sign(desc.hash(), kp3.secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 0,
      aborted: false,
    });

    let outMessages = transactionsFrom(res.transactions, src)[0].outMessages;
    let excess = outMessages.values()[0];
    expect(excess.info.dest).to.equalAddress(dst);
    // expect(excess.mode).to.equal(64); TODO

    // remove
    res = await verifierRegistry.sendRemoveVerifier(blockchain.sender(user), {
      id: sha256BN("verifier2"),
      value: toNano(1),
    });
    expect(res.transactions).to.have.transaction({
      from: user,
      exitCode: 0,
    });

    verifiersNum = await verifierRegistry.getVerifiersNum();
    expect(verifiersNum).to.equal(1);

    // should not forward

    res = await verifierRegistry.sendRemoveVerifier(blockchain.sender(src), {
      id: sha256BN("verifier2"),
      value: toNano(1),
    });
    res = await verifierRegistry.sendForwardMessage(blockchain.sender(src), {
      desc,
      signatures: new Map<bigint, Buffer>([
        [toBigIntBE(kp3.publicKey), sign(desc.hash(), kp3.secretKey)],
      ]),
      value: toNano(3),
    });

    expect(res.transactions).to.have.transaction({
      from: src,
      exitCode: 404,
      aborted: true,
    });
  });

  it("should retrieve verifiers data", async () => {
    verifierRegistry = blockchain.openContract(
      VerifierRegistry.createFromConfig(code, { verifiers: new Map() }, 0)
    );
    await verifierRegistry.sendDeploy(admin.getSender(), toNano("10005"));

    let user = randomAddress("user");

    let kp3 = await randomKeyPair();

    const verifierConfig = [
      ["verifier1", "http://verifier1.com"],
      ["verifier2", "http://verifier2.com"],
      ["verifier3", "http://verifier3.com"],
    ];

    for (const [name, url] of verifierConfig) {
      await verifierRegistry.sendUpdateVerifier(blockchain.sender(user), {
        id: sha256BN(name),
        quorum: 7,
        endpoints: new Map<bigint, number>([[toBigIntBE(kp3.publicKey), ip2num("10.0.0.1")]]),
        name: name,
        marketingUrl: url,
        value: toNano(10005),
      });
    }

    const verifiers = await verifierRegistry.getVerifiers();
    for (const [name, url] of verifierConfig) {
      const actualVerifier = verifiers.find((v) => v.name === name)!;
      const [pub_key, ipnum] = actualVerifier.pub_key_endpoints.entries().next().value;

      expect(ipnum).to.equal(ip2num("10.0.0.1"));
      expect(pub_key.toString()).to.equal(toBigIntBE(kp3.publicKey).toString());
      expect(actualVerifier.admin).to.equalAddress(user);
      expect(actualVerifier.quorum).to.equal(7);
      expect(actualVerifier.name).to.equal(name);
      expect(actualVerifier.marketingUrl).to.equal(url);
    }
  });
});
