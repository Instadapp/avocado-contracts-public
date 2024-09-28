import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AvoRegistry__factory } from "../../typechain-types";
import { deterministicDeploymentSalt, proxyAdmin, waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n00_AvoRegistry______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const factory = await deployments.get("AvoFactoryProxy");

  // deploy logic contract
  const avoRegistry = await deployments.deploy("AvoRegistry", {
    from: deployer,
    args: [factory.address],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  // initialize callData
  const avoRegistryContract = AvoRegistry__factory.connect(avoRegistry.address, await ethers.getSigner(deployer));
  const initializeCallData = (await avoRegistryContract.populateTransaction.initialize(deployer)).data;

  // deploy proxy
  const avoRegistryProxy = await deployments.deploy("AvoRegistryProxy", {
    from: deployer,
    args: [avoRegistry.address, await proxyAdmin(hre), initializeCallData],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed avoRegistry (logic contract) to", avoRegistry.address);
  console.log(
    "Deployed avoRegistry proxy to",
    avoRegistryProxy.address,
    "for proxyAdmin:",
    await proxyAdmin(hre),
    "and owner:",
    deployer
  );
  console.log("--------------------------------------------\n");
};
export default func;
