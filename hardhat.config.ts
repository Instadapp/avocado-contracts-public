import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();
import { HttpNetworkUserConfig, HardhatUserConfig } from "hardhat/types/config";

import "hardhat-storage-layout";
import "hardhat-contract-sizer";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import "solidity-docgen";

const { ALCHEMY_TOKEN_MAINNET, ALCHEMY_TOKEN_POLYGON, DEPLOYER_PRIVATE_KEY, NODE_ENV, PROXY_ADMIN_OWNER_PRIVATE_KEY } =
  process.env;

const sharedNetworkConfig: HttpNetworkUserConfig = {};

// public address 0xEFfBa20f2E744DfCfdD2Cf122b93999f9a84Ef08
// randomly generated for test purposes, do not use for actual deployment!
const DEFAULT_DEPLOYER_PRIVATE_KEY = "6666459e446e2b0d620443b02f1f6be4f10df8e2fea81c9f8b343fb5bbfb7743";

sharedNetworkConfig.accounts = [DEPLOYER_PRIVATE_KEY || DEFAULT_DEPLOYER_PRIVATE_KEY];

// proxy admin private key is optional, only needed for automatic upgrades
if (PROXY_ADMIN_OWNER_PRIVATE_KEY) {
  sharedNetworkConfig.accounts.push(PROXY_ADMIN_OWNER_PRIVATE_KEY);
}

const defaultContractSettings = {
  version: "0.8.18",
  settings: {
    optimizer: {
      // Toggles whether the optimizer is on or off.
      // It's good to keep it off for development
      // and turn on for when getting ready to launch.
      enabled: NODE_ENV !== "DEBUG",
      // The number of runs specifies roughly how often
      // the deployed code will be executed across the
      // life-time of the contract. It is best practice to pick a high number.
      runs: 10000000,
    },
  },
};

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [{ ...defaultContractSettings }],
    overrides: {
      // use less optimizer runs for AvocadoMultisig to stay within contract size limits
      "contracts/AvocadoMultisig/AvocadoMultisig.sol": {
        ...defaultContractSettings,
        settings: {
          ...defaultContractSettings.settings,
          optimizer: {
            ...defaultContractSettings.settings.optimizer,
            runs: 10000,
          },
        },
      },
      // use less optimizer runs for AvocadoMultisigSecondary to stay within contract size limits
      // AND to match AvocadoMultisig.sol for simulation gas estimate effects
      "contracts/AvocadoMultisig/AvocadoMultisigSecondary.sol": {
        ...defaultContractSettings,
        settings: {
          ...defaultContractSettings.settings,
          optimizer: {
            ...defaultContractSettings.settings.optimizer,
            runs: 10000,
          },
        },
      },
      // ------------------
      // mocks below only for tests
      "contracts/mocks/MockAvocadoMultisigWithUpgradeHook.sol": {
        ...defaultContractSettings,
        settings: {
          ...defaultContractSettings.settings,
          optimizer: {
            ...defaultContractSettings.settings.optimizer,
            runs: 1,
          },
        },
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: "https://eth-mainnet.g.alchemy.com/v2/" + ALCHEMY_TOKEN_MAINNET,
        blockNumber: 17399270,
        enabled: NODE_ENV !== "CI", // if running in pipeline fork is disabled
      },
      gasPrice: 20000000000,
      gas: 6000000,
      deploy: ["scripts/deploy/"], // run deployment scripts for tests etc.
      allowUnlimitedContractSize: NODE_ENV === "DEBUG",
    },
    localhost: {},
  },
  namedAccounts: {
    deployer: {
      default: 0, // use the first account (index = 0).
    },
    proxyAdmin: {
      default: sharedNetworkConfig.accounts[0] === sharedNetworkConfig.accounts[1] ? 0 : 1, // use the second account (index = 1).
    },
  },
  mocha: {
    timeout: 200000, // increase timeout for high signers count tests
  },
  docgen: {
    pages: "files",
    exclude: ["external", "interfaces", "mocks"],
    templates: "docs-templates",
  },
};

export default config;
