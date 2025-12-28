import { toNano, Address } from "@ton/core";
import { SourcesRegistry } from "../wrappers/sources-registry";
import { compile, NetworkProvider } from "@ton/blueprint";
import { zeroAddress } from "../test/unit/helpers";


// actual verifier registries in the wild
const verifierRegistryAddrMainnet = Address.parse("EQDn0lCfJbUPhD6ST-Lwh8bj-9xcc24_G_C1QAk6uBAfaeMN");
const verifierRegistryAddrTestnet = Address.parse("EQBVqiwETtNvCLUqFGeeFpMGk7qnUeQM3gVegnufxn0lUrOa");

export async function run(provider: NetworkProvider) {
  const verifierRegistryAddr =
    provider.network() === "testnet" ? verifierRegistryAddrTestnet :
      provider.network() === "mainnet" ? verifierRegistryAddrMainnet : zeroAddress;

  const sourcesRegistry = provider.open(
    SourcesRegistry.create(
      {
        verifierRegistryAddress: verifierRegistryAddr,
        admin: provider.sender().address!,
        maxTons: toNano("1.1"),
        minTons: toNano("0.065"),
        sourceItemCode: await compile("source-item"),
      },
      await compile("sources-registry")
    )
  );

  const isDeployed = await provider.isContractDeployed(sourcesRegistry.address);
  if (isDeployed) {
    console.log("Contract already deployed at: ", sourcesRegistry.address);
    return;
  }

  await sourcesRegistry.sendDeploy(provider.sender(), toNano("1.00"));
  await provider.waitForDeploy(sourcesRegistry.address);

  console.log("Source Registry Deployed! address: ", sourcesRegistry.address);
}
