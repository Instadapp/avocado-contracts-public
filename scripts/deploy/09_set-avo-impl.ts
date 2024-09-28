import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "hardhat";
import { AvoRegistry } from "../../typechain-types";
import { waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n09_SET_AVOIMPL_AT_REGISTRY______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const avocadoMultisigLogicContract = await deployments.get("AvocadoMultisig");

  const avoRegistry = (await ethers.getContractAt(
    "AvoRegistry",
    (
      await deployments.get("AvoRegistryProxy")
    ).address
  )) as AvoRegistry;

  const currentValue = await avoRegistry
    .connect(await ethers.getSigner(deployer))
    .avoVersions(avocadoMultisigLogicContract.address);

  if (currentValue) {
    console.log("Skipped, avocadoMultisig version is already allowed", avocadoMultisigLogicContract.address);
    console.log("--------------------------------------------\n");
    return;
  }

  const tx = await avoRegistry
    .connect(await ethers.getSigner(deployer))
    .setAvoVersion(avocadoMultisigLogicContract.address, true, true);
  await tx.wait(waitConfirmations(hre));

  console.log("\n--------------RESULT------------------------------");
  console.log(
    "Registered AvocadoMultisig logic contract at AvoRegistry (and set as default): ",
    avocadoMultisigLogicContract.address
  );
  console.log("--------------------------------------------\n");
};
export default func;
