import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "hardhat";
import { AvoFactory } from "../../typechain-types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n12_DEPLOY_Avocado_FOR_USER1______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();
  const user1 = (await ethers.getSigners())[5];

  const avoFactory = (
    (await ethers.getContractAt("AvoFactory", (await deployments.get("AvoFactoryProxy")).address)) as AvoFactory
  ).connect(await ethers.getSigner(deployer));

  await avoFactory.deploy(user1.address, 0);

  console.log("\n--------------RESULT------------------------------");
  console.log(
    "Deployed Avocado (proxy) contract for user1 (account[5]): ",
    await avoFactory.computeAvocado(user1.address, 0)
  );
  console.log("--------------------------------------------\n");
};
export default func;
