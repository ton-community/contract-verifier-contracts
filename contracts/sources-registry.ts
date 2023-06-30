import { Cell, beginCell, Address } from "ton";
import { Sha256 } from "@aws-crypto/sha256-js";

import { hex as sourceItemHex } from "../build/source-item.compiled.json";
import { toBigIntBE } from "bigint-buffer";

// encode contract storage according to save_data() contract method
export function data(params: {
  minTons: bigint;
  maxTons: bigint;
  verifierRegistryAddress: Address;
  admin: Address;
}): Cell {
  return beginCell()
    .storeCoins(params.minTons)
    .storeCoins(params.maxTons)
    .storeAddress(params.admin)
    .storeAddress(params.verifierRegistryAddress)
    .storeRef(Cell.fromBoc(Buffer.from(sourceItemHex, "hex"))[0])
    .endCell();
}

export const toSha256Buffer = (s: string) => {
  const sha = new Sha256();
  sha.update(s);
  return Buffer.from(sha.digestSync());
};

// message encoders for all ops (see contracts/imports/constants.fc for consts)
export function deploySource(
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

export function changeVerifierRegistry(newVerifierRegistry: Address): Cell {
  return beginCell()
    .storeUint(2003, 32)
    .storeUint(0, 64)
    .storeAddress(newVerifierRegistry)
    .endCell();
}

export function changeAdmin(newAdmin: Address): Cell {
  return beginCell().storeUint(3004, 32).storeUint(0, 64).storeAddress(newAdmin).endCell();
}

export function setSourceItemCode(newCode: Cell): Cell {
  return beginCell().storeUint(4005, 32).storeUint(0, 64).storeRef(newCode).endCell();
}

export function changeCode(newCode: Cell): Cell {
  return beginCell().storeUint(5006, 32).storeUint(0, 64).storeRef(newCode).endCell();
}

export function setDeploymentCosts(minTon: bigint, maxTon: bigint): Cell {
  return beginCell()
    .storeUint(6007, 32)
    .storeUint(0, 64)
    .storeCoins(minTon)
    .storeCoins(maxTon)
    .endCell();
}
