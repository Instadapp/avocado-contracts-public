import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deterministicDeploymentSalt, waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n13_AvoGasEstimationsHelper______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const factory = await deployments.get("AvoFactoryProxy");

  // deploy logic contract
  const avoGasEstimationsHelper = await deployments.deploy("AvoGasEstimationsHelper", {
    from: deployer,
    args: [factory.address],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed AvoGasEstimationsHelper (logic contract) to", avoGasEstimationsHelper.address);
  console.log("--------------------------------------------\n");
};
export default func;
