import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "hardhat";
import { AvoRegistry } from "../../typechain-types";
import { waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n04_REGISTER_FORWARDER_VERSION______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const forwarder = await deployments.get("AvoForwarderProxy");

  const avoRegistry = (await ethers.getContractAt(
    "AvoRegistry",
    (
      await deployments.get("AvoRegistryProxy")
    ).address
  )) as AvoRegistry;

  const currentValue = await avoRegistry
    .connect(await ethers.getSigner(deployer))
    .avoForwarderVersions(forwarder.address);

  if (currentValue) {
    console.log("Skipped, forwarder version is already allowed", forwarder.address);
    console.log("--------------------------------------------\n");
    return;
  }

  const tx = await avoRegistry
    .connect(await ethers.getSigner(deployer))
    .setAvoForwarderVersion(forwarder.address, true);
  await tx.wait(waitConfirmations(hre));

  console.log("\n--------------RESULT------------------------------");
  console.log("Registered AvoForwarder at AvoRegistry: ", forwarder.address);
  console.log("--------------------------------------------\n");
};
export default func;
