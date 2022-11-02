import { Cell, contractAddress } from "ton";
import { SmartContract } from "ton-contract-executor";


export async function makeContract(codeHex: string, dataCell: Cell) {
  const codeCell = Cell.fromBoc(codeHex)[0]; // code cell from build output;

  const ca = contractAddress({
    workchain: 0,
    initialCode: codeCell,
    initialData: dataCell,
  });

  const contract = {
    contract: await SmartContract.fromCell(codeCell, dataCell, { debug: true }),
    address: ca,
  };

  contract.contract.setC7Config({ myself: ca });

  return contract;
}
