import { toUtf8Bytes } from "ethers/lib/utils";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deterministicDeploymentSalt, proxyAdmin, waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n06_AVO_SIGNERS_LIST______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const factory = await deployments.get("AvoFactoryProxy");
  const avoConfigV1 = await deployments.get("AvoConfigV1");

  // deploy logic contract
  const avoSignersList = await deployments.deploy("AvoSignersList", {
    from: deployer,
    args: [factory.address, avoConfigV1.address],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  // deploy proxy
  const avoSignersListProxy = await deployments.deploy("AvoSignersListProxy", {
    from: deployer,
    args: [
      avoSignersList.address,
      await proxyAdmin(hre),
      // no initialize method used for AvoSignersList
      toUtf8Bytes(""),
    ],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed AvoSignersList (logic contract) to", avoSignersList.address);

  console.log(
    "Deployed AvoSignersList proxy to",
    avoSignersListProxy.address,
    "for proxyAdmin:",
    await proxyAdmin(hre)
  );
  console.log("--------------------------------------------\n");
};
export default func;
