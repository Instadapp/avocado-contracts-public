import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "hardhat";

import { AvoForwarder } from "../../typechain-types";
import { waitConfirmations } from "../util";
import { AvoForwarderStructs } from "../../typechain-types/contracts/AvoForwarder.sol/AvoForwarder";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n11_ALLOW_BROADCASTER______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const broadcaster = (await ethers.getSigners())[8];

  const avoForwarder = (await ethers.getContractAt(
    "AvoForwarder",
    (
      await deployments.get("AvoForwarderProxy")
    ).address
  )) as AvoForwarder;

  const broadcastersStatus: AvoForwarderStructs.AddressBoolStruct[] = [
    {
      addr: broadcaster.address,
      value: true,
    },
  ];

  const tx = await avoForwarder.connect(await ethers.getSigner(deployer)).updateBroadcasters(broadcastersStatus);
  await tx.wait(waitConfirmations(hre));

  console.log("\n--------------RESULT------------------------------");
  console.log("Allow broadcaster at AvoForwarder: ", broadcaster.address);
  console.log("--------------------------------------------\n");
};
export default func;
