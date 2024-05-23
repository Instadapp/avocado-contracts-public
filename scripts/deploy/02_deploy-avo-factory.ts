import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { AvoFactory__factory } from "../../typechain-types";
import { deterministicDeploymentSalt, proxyAdmin, waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n01_AvoFactory______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const registry = await deployments.get("AvoRegistryProxy");

  // deploy logic contract
  const avoFactory = await deployments.deploy("AvoFactory", {
    from: deployer,
    args: [registry.address],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  // initialize callData
  const avoFactoryContract = AvoFactory__factory.connect(avoFactory.address, await ethers.getSigner(deployer));
  const initializeCallData = (await avoFactoryContract.populateTransaction.initialize()).data;

  const avoFactoryProxyInstance = await hre.ethers.getContractAt(
    "AvoFactoryProxy",
    (
      await deployments.get("AvoFactoryProxy")
    ).address
  );

  const upgradeTx = await avoFactoryProxyInstance.upgradeToAndCall(avoFactory.address, initializeCallData);
  await upgradeTx.wait();

  const transferAdmin = await avoFactoryProxyInstance.changeAdmin(await proxyAdmin(hre));
  await transferAdmin.wait();

  console.log("Upgraded Implementation and changed owner");

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed avoFactory (logic contract) to", avoFactory.address);
  console.log(
    "Deployed avoFactory proxy upgraded to deployed avoFactory and proxyAdmin changed to:",
    await proxyAdmin(hre)
  );
  console.log("--------------------------------------------\n");
};
export default func;
