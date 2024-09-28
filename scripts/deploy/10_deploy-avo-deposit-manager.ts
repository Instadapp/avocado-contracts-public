import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { deterministicDeploymentSalt, proxyAdmin, waitConfirmations } from "../util";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  console.log("\n\n10_AvoDepositManager______________________________________________\n");

  const deployments = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const avoConfigV1 = await deployments.get("AvoConfigV1");

  // initialWithdrawLimit = 10.000 USDC with 18 decimals from mock token
  const initialWithdrawLimit = BigNumber.from(10000).mul(ethers.utils.parseEther("1"));
  const initialWithdrawAddress = deployer;

  // deploy logic contract
  const avoDepositManager = await deployments.deploy("AvoDepositManager", {
    from: deployer,
    args: [(await deployments.get("AvoFactoryProxy")).address, avoConfigV1.address],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  // initialize callData
  const iface = new hre.ethers.utils.Interface([
    "function initialize(address owner_,address withdrawAddress_,uint96 withdrawLimit_,uint96 minWithdrawAmount_,uint96 withdrawFee_) public",
  ]);
  const initializeCallData = iface.encodeFunctionData("initialize", [
    deployer,
    initialWithdrawAddress,
    initialWithdrawLimit,
    ethers.utils.parseEther("10"), // min withdraw amount 10 mock usdc
    ethers.utils.parseEther("1"), // withdraw fee 1 mock usdc
  ]);

  // deploy proxy
  const avoDepositManagerProxy = await deployments.deploy("AvoDepositManagerProxy", {
    from: deployer,
    args: [avoDepositManager.address, await proxyAdmin(hre), initializeCallData],
    log: true,
    deterministicDeployment: deterministicDeploymentSalt(),
    waitConfirmations: waitConfirmations(hre),
  });

  console.log("\n--------------RESULT------------------------------");
  console.log("Deployed AvoDepositManager (logic contract) to", avoDepositManager.address);

  console.log(
    "Deployed AvoDepositManager proxy to",
    avoDepositManagerProxy.address,
    "for proxyAdmin:",
    await proxyAdmin(hre)
  );
  console.log("--------------------------------------------\n");
};
export default func;
