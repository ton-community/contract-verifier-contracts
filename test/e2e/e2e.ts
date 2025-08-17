import dotenv from "dotenv";
import { assert } from "chai";

import {
  Address,
  Cell,
  toNano,
  TonClient,
  WalletContractV4,
  OpenedContract,
} from "ton";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";
import { KeyPair, mnemonicToWalletKey } from "ton-crypto";
import { compile } from "@ton-community/blueprint";

import { zeroAddress } from "../unit/helpers";
import { SourcesRegistry } from "../../wrappers/sources-registry";
import { SourcesRegistryOnlySetCode } from "../../wrappers/sources-registry-only-set-code";

dotenv.config();

const ACTUAL_VERIFIER_REGISTRY = Address.parse("EQDZeSc_Mwu7YKcjopglrDLpLZsHGD5z1TK0xzEhD5ic8kBn");

async function getWallet(tc: TonClient, mnemonic: string[]) {
  const deployerMnemonic = mnemonic.join(" "); //(await mnemonicNew(24)).join(" ");

  const walletKey = await mnemonicToWalletKey(deployerMnemonic.split(" "));
  const walletContract = tc.open(
    WalletContractV4.create({ publicKey: walletKey.publicKey, workchain: 0 })
  );
  return { walletContract, walletKey };
}

async function waitToVerify(wallet: WalletStruct, seqnoBefore: number) {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  while (true) {
    await sleep(2000);
    const seqnoAfter = await wallet.walletContract.getSeqno();
    if (seqnoAfter > seqnoBefore) return;
  }
}

type WalletStruct = {
  walletContract: OpenedContract<WalletContractV4>;
  walletKey: KeyPair;
};

async function changeVerifierRegistryTests(
  sourcesRegistryContract: OpenedContract<SourcesRegistry>,
  wallet: WalletStruct
) {
  console.log("ℹ️ Testing changeVerifierRegistry()");

  async function changeVerifier(address: Address) {
    const seqno = await wallet.walletContract.getSeqno();

    await sourcesRegistryContract.sendChangeVerifierRegistry(
      wallet.walletContract.sender(wallet.walletKey.secretKey),
      { value: toNano("0.01"), newVerifierRegistry: address }
    );

    waitToVerify(wallet, seqno);
  }

  const verifierBefore = await sourcesRegistryContract.getVerifierRegistryAddress();
  console.log("Current verifier address is: ", verifierBefore.toString());

  await changeVerifier(zeroAddress);

  const verifierAfter = await sourcesRegistryContract.getVerifierRegistryAddress();
  console.log("After change to zero addr - verifier address is: ", verifierAfter.toString());

  assert(verifierAfter.equals(zeroAddress), "verifier registry address should be zero address");

  await changeVerifier(ACTUAL_VERIFIER_REGISTRY);
  const verifierReverted = await sourcesRegistryContract.getVerifierRegistryAddress();

  assert(
    verifierReverted.equals(ACTUAL_VERIFIER_REGISTRY),
    "verifier registry address should be reverted to original address"
  );

  console.log("After revert - verifier address is: ", verifierReverted.toString());
}

async function replaceAdmin(
  sourcesRegistryContract: OpenedContract<SourcesRegistry>,
  wallet: WalletStruct,
  newAdmin: Address
) {
  console.log("ℹ️ Replacing admin");

  const adminBefore = await sourcesRegistryContract.getAdminAddress();
  console.log("Current admin is: ", adminBefore!.toString());

  const seqno = await wallet.walletContract.getSeqno();

  await sourcesRegistryContract.sendChangeAdmin(
    wallet.walletContract.sender(wallet.walletKey.secretKey),
    { value: toNano("0.01"), newAdmin }
  );
  waitToVerify(wallet, seqno);

  const adminAfter = await sourcesRegistryContract.getAdminAddress();
  console.log("After change, admin is: ", adminAfter!.toString());

  assert(adminAfter!.equals(newAdmin), "Admin should be changed to new admin");
}

async function setCodeTests(
  sourcesRegistryContract: OpenedContract<SourcesRegistry>,
  tc: TonClient,
  wallet: WalletStruct
) {
  console.log("ℹ️ Testing setCode()");
  const dumyCodeCell = await compile("sources-registry-only-set-code");
  const actualCodeCell = await compile("sources-registry");

  async function changeCode(newCode: Cell) {
    const seqno = await wallet.walletContract.getSeqno();

    await sourcesRegistryContract.sendChangeCode(
      wallet.walletContract.sender(wallet.walletKey.secretKey),
      {
        value: toNano("0.01"),
        newCode,
      }
    );

    waitToVerify(wallet, seqno);
  }

  await changeCode(dumyCodeCell);

  const changedContract = tc.open(
    SourcesRegistryOnlySetCode.createFromAddress(sourcesRegistryContract.address)
  );

  const resp = await changedContract.getAmIReplaced();

  assert(resp === BigInt(742), "Contract should be replaced");

  // Revert code
  await changeCode(actualCodeCell);
}

async function setSourceItemCodeTests(
  sourcesRegistryContract: OpenedContract<SourcesRegistry>,
  wallet: WalletStruct
) {
  console.log("ℹ️ Testing setSourceItemCode()");

  const dumyCodeCell = await compile("sources-item-dummy");
  const actualCodeCell = await compile("sources-item");

  const origSourceItem = await sourcesRegistryContract.getSourceItemAddress(
    "testverifier",
    "dummyCodeCellHash"
  );

  async function setSourceItemCode(newCode: Cell) {
    const seqno = await wallet.walletContract.getSeqno();

    await sourcesRegistryContract.sendSetSourceItemCode(
      wallet.walletContract.sender(wallet.walletKey.secretKey),
      { value: toNano("0.01"), newCode }
    );

    waitToVerify(wallet, seqno);
  }

  await setSourceItemCode(dumyCodeCell);

  const modifiedSourceItem = await sourcesRegistryContract.getSourceItemAddress(
    "testverifier",
    "dummyCodeCellHash"
  );

  assert(origSourceItem.equals(modifiedSourceItem), "Source item address should be changed");

  await setSourceItemCode(actualCodeCell);

  const originalSourceItem2 = await sourcesRegistryContract.getSourceItemAddress(
    "testverifier",
    "dummyCodeCellHash"
  );

  assert(
    origSourceItem.equals(originalSourceItem2),
    "Source item address should equal after revert"
  );
}

(async function E2E({ sourcesRegistryAddress }: { sourcesRegistryAddress: Address }) {
  const endpoint = await getHttpEndpoint();
  const tc = new TonClient({ endpoint });
  const sourcesRegistryContract = tc.open(
    SourcesRegistry.createFromAddress(sourcesRegistryAddress)
  );

  const [wallet1, wallet2] = [
    await getWallet(tc, process.env.E2E_WALLET_1!.split(" ")),
    await getWallet(tc, process.env.E2E_WALLET_2!.split(" ")),
  ];

  await replaceAdmin(sourcesRegistryContract, wallet1, wallet2.walletContract.address);
  await changeVerifierRegistryTests(sourcesRegistryContract, wallet2);
  await setCodeTests(sourcesRegistryContract, tc, wallet2);
  await replaceAdmin(sourcesRegistryContract, wallet2, wallet1.walletContract.address);
  await setSourceItemCodeTests(sourcesRegistryContract, wallet1);
})({ sourcesRegistryAddress: Address.parse("EQCFYXRqFFnXfXSnicF8vYxR7jGw4T9B3aNVpeHHVzR2jnuv") });
