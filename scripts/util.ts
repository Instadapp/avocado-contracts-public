import { HardhatRuntimeEnvironment } from "hardhat/types";

import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();
const { DETERMINISTIC_DEPLOYMENT_SALT, PROXY_ADMIN_ADDRESS, NODE_ENV } = process.env;

export const deterministicDeploymentSalt = () => {
  return DETERMINISTIC_DEPLOYMENT_SALT || "0x0001";
};

export const proxyAdmin = async (hre: HardhatRuntimeEnvironment): Promise<string> => {
  if (NODE_ENV === "TEST" || NODE_ENV === "CI" || NODE_ENV === "DEBUG") {
    // locally for tests set proxyAdmin to accounts[2] to get an unrelated address
    return (await hre.ethers.getSigners())[2].address;
  }

  const { proxyAdmin } = await hre.getNamedAccounts();

  return (PROXY_ADMIN_ADDRESS as string) || proxyAdmin;
};

export const waitConfirmations = (hre: HardhatRuntimeEnvironment): number => {
  return 0;
};
