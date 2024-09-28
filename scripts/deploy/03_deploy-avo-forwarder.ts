import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AvoForwarder__factory } from "../../typechain-types";
import { deterministicDeploymentSalt, proxyAdmin, waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n03_AvoForwarder______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const factory = await deployments.get("AvoFactoryProxy");

  // deploy logic contract
  const avoForwarder = await deployments.deploy("AvoForwarder", {
    from: deployer,
    args: [factory.address],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  // initialize callData
  const avoForwarderContract = AvoForwarder__factory.connect(avoForwarder.address, await ethers.getSigner(deployer));
  const initializeCallData = (await avoForwarderContract.populateTransaction.initialize(deployer, [])).data;

  // deploy proxy
  const avoForwarderProxy = await deployments.deploy("AvoForwarderProxy", {
    from: deployer,
    args: [avoForwarder.address, await proxyAdmin(hre), initializeCallData],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed AvoForwarder (logic contract) to", avoForwarder.address);

  console.log(
    "Deployed AvoForwarder proxy to",
    avoForwarderProxy.address,
    "for proxyAdmin:",
    await proxyAdmin(hre),
    "and owner:",
    deployer
  );
  console.log("--------------------------------------------\n");
};
export default func;
