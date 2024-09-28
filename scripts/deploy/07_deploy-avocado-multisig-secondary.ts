import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deterministicDeploymentSalt, waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n07_AVOCADO_MULTISIG_SECONDARY______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const registry = await deployments.get("AvoRegistryProxy");
  const forwarder = await deployments.get("AvoForwarderProxy");
  const avoSignersList = await deployments.get("AvoSignersListProxy");

  const avoConfigV1 = await deployments.get("AvoConfigV1");

  const avocadoMultisigSecondary = await deployments.deploy("AvocadoMultisigSecondary", {
    from: deployer,
    args: [registry.address, forwarder.address, avoSignersList.address, avoConfigV1.address],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed AvocadoMultisigSecondary (logic contract) to", avocadoMultisigSecondary.address);
  console.log("--------------------------------------------\n");
};
export default func;
