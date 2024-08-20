import { toNano, Address } from "ton-core";
import { SourcesRegistry } from "../wrappers/sources-registry";
import { compile, NetworkProvider } from "@ton-community/blueprint";
import inquirer from "inquirer";

export async function run(provider: NetworkProvider) {
  const compiled = await compile("sources-registry");

  const codeCellHash = compiled.hash().toString("base64");
  const addressToConfirm = Address.parse("[SOURCES_REGISTRY_ADDRESS]");

  const sourcesRegistry = provider.open(SourcesRegistry.createFromAddress(addressToConfirm));

  const { address } = await inquirer.prompt([
    {
      type: "input",
      name: "address",
      message: `\n\n!!!This will set the code of the Sources Registry contract!!! Proceed with extreme caution!\n\nSources Registry Address: ${addressToConfirm}\nNew Code Cell Hash: ${codeCellHash}\n\nWrite the address of the contract to confirm:`,
    },
  ]);

  try {
    if (!Address.parse(address).equals(addressToConfirm)) {
      console.log("Address does not match, aborting...");
      process.exit(1);
    }
  } catch (e) {
    console.log(`Invalid address: ${address}, aborting...`);
    process.exit(1);
  }

  await sourcesRegistry.sendChangeCode(provider.sender(), {
    newCode: compiled,
    value: toNano("0.05"),
  });

  console.log("Source Registry set code", sourcesRegistry.address);
}
