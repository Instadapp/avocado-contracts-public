import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { defaultAuthorizedMaxFee, defaultAuthorizedMinFee } from "../../test/TestHelpers";
import { AvoConfigV1, MockERC20Token__factory } from "../../typechain-types";
import { deterministicDeploymentSalt, waitConfirmations } from "../util";

async function getUsdcAddress(hre: HardhatRuntimeEnvironment) {
  // deploy mockToken for usdc
  const { deployer } = await hre.getNamedAccounts();

  const usdcMockToken = await hre.deployments.deploy("MOCK_USDC", {
    from: deployer,
    args: ["Local-Mock-USDC", "MOCKUSDC"],
    log: true,
    contract: "MockERC20Token",
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  // mint some mock usdc for user1
  const user1 = (await ethers.getSigners())[5];
  const usdcMockTokenContract = MockERC20Token__factory.connect(usdcMockToken.address, user1);
  await usdcMockTokenContract.mint();

  console.log("deployed local mock usdc token for deposit manager and received mock funds to user1");

  return usdcMockToken.address;
}

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n05_AVO_CONFIG_V1______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const avoConfigV1Deployment = await deployments.deploy("AvoConfigV1", {
    from: deployer,
    args: [deployer], // deployer as owner
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  const avoConfigV1 = (await ethers.getContractAt("AvoConfigV1", avoConfigV1Deployment.address)) as AvoConfigV1;

  const avocadoMultisigConfig: AvoConfigV1.AvocadoMultisigConfigStruct = {
    authorizedMinFee: defaultAuthorizedMinFee,
    authorizedMaxFee: defaultAuthorizedMaxFee,
    authorizedFeeCollector: (await ethers.getSigners())[11].address,
  };
  const depositManagerConfig: AvoConfigV1.AvoDepositManagerConfigStruct = {
    depositToken: await getUsdcAddress(hre),
  };
  const signersListConfig: AvoConfigV1.AvoSignersListConfigStruct = {
    trackInStorage: true,
  };

  await avoConfigV1.setConfig(avocadoMultisigConfig, depositManagerConfig, signersListConfig);

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed AvoConfigV1", avoConfigV1.address);
  console.log("--------------------------------------------\n");
};
export default func;
