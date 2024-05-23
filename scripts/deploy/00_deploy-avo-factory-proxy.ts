import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { deterministicDeploymentSalt, proxyAdmin, waitConfirmations } from "../util";
import { solidityKeccak256 } from "ethers/lib/utils";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n00_DEPLOY_AVO_FACTORY_PROXY______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  // ensure deployer is not same address as proxyAdmin because that results in
  // calls to avoRegistry in later scripts to fail because admin can not fallback at proxy
  if (deployer === (await proxyAdmin(hre))) {
    throw new Error("Deployer can not be ProxyAdmin directly. Should point to ProxyAdmin contract instead.");
  }

  // deploy empty logic contract because avo versions registry proxy address is not available yet
  const emptyImplementation = await deployments.deploy("AVO_FACTORY_EMPTY_IMPLEMENTATION", {
    contract: "EmptyImplementation",
    from: deployer,
    args: [],
    log: true,
    deterministicDeployment: solidityKeccak256(["string"], ["AVO_FACTORY_EMPTY_IMPLEMENTATION"]), // custom salt for temp usage
    waitConfirmations: waitConfirmations(hre),
  });

  // deploy proxy
  const avoFactoryProxy = await deployments.deploy("AvoFactoryProxy", {
    from: deployer,
    args: [emptyImplementation.address, deployer, "0x"],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed avoFactory proxy to", avoFactoryProxy.address, "for temporary proxyAdmin:", deployer);
  console.log("--------------------------------------------\n");
};
export default func;
