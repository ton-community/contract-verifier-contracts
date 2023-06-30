import { createHash } from "crypto";
import Prando from "prando";
import { Address } from "ton-core";
import { mnemonicNew, mnemonicToPrivateKey } from "ton-crypto";
import { toBigIntBE } from "bigint-buffer";
import { BlockchainTransaction } from "@ton-community/sandbox";

export function transactionsFrom(transactions: BlockchainTransaction[], address: Address) {
    return transactions.filter((item) => item.inMessage && item.inMessage.info.src instanceof Address && address.equals(item.inMessage.info.src))
}

export const zeroAddress = new Address(0, Buffer.alloc(32, 0));

export function randomAddress(seed: string, workchain?: number) {
  const random = new Prando(seed);
  const hash = Buffer.alloc(32);
  for (let i = 0; i < hash.length; i++) {
    hash[i] = random.nextInt(0, 255);
  }
  return new Address(workchain ?? 0, hash);
}

export async function randomKeyPair() {
  let mnemonics = await mnemonicNew();
  return mnemonicToPrivateKey(mnemonics);
}

export function sha256BN(name: string) {
  return toBigIntBE(createHash("sha256").update(name).digest());
}

export function ip2num(ip: string) {
  let d = ip.split(".");
  return ((+d[0] * 256 + +d[1]) * 256 + +d[2]) * 256 + +d[3];
}

export function timeUnixTimeStamp(offsetMinute: number) {
  return Math.floor(Date.now() / 1000 + offsetMinute * 60);
}
