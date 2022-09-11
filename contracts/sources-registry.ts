import BN from "bn.js";
import { Cell, beginCell, Address } from "ton";
import { Sha256 } from "@aws-crypto/sha256-js";

import { hex as sourceItemHex } from "../build/source-item.compiled.json";

export function prepareKey(verifierId: string, codeCell: string) {
  const hash = new Sha256();
  hash.update(`${verifierId}:${codeCell}`);
  return Buffer.from(hash.digestSync());
}

export function keyToIntString(key: Buffer): string {
  return new BN(key, "hex").toString(10);
}

export function keyToAddress(
  verifierId: string,
  codeCell: string,
  registryAddress: Address
): Address {
  const data = beginCell()
    .storeBuffer(prepareKey(verifierId, codeCell))
    .storeAddress(registryAddress)
    .endCell();

  const si = beginCell()
    .storeUint(0, 2)
    .storeDict(Cell.fromBoc(sourceItemHex)[0])
    .storeDict(data)
    .storeUint(0, 1)
    .endCell();

  return beginCell()
    .storeUint(4, 3)
    .storeInt(0, 8)
    .storeUint(new BN(si.hash(), 16), 256)
    .endCell()
    .beginParse()
    .readAddress()!;
}

// encode contract storage according to save_data() contract method
export function data(params: { ownerAddress: Address }): Cell {
  return beginCell()
    .storeAddress(params.ownerAddress)
    .storeRef(Cell.fromBoc(sourceItemHex)[0])
    .endCell();
}

// message encoders for all ops (see contracts/imports/constants.fc for consts)
export function deploySource(verifierId: string, codeCellHash: string, jsonURL: string): Cell {
  return beginCell()
    .storeUint(0x1, 32)
    .storeUint(0, 64)
    .storeBuffer(prepareKey(verifierId, codeCellHash))
    .storeRef(
      beginCell()
        // TODO support snakes
        .storeRef(beginCell().storeBuffer(Buffer.from(jsonURL)).endCell())
        .endCell()
    )
    .endCell();
}

export function changeOwner(newOwner: Address): Cell {
  return beginCell().storeUint(0x3, 32).storeUint(0, 64).storeAddress(newOwner).endCell();
}
