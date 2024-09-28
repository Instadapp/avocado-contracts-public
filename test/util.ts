import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract } from "ethers";

const { NODE_ENV } = process.env;

import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { solidity } from "ethereum-waffle";
import { deployments, ethers, getNamedAccounts } from "hardhat";
chai.use(chaiAsPromised);
chai.use(solidity);
export const { expect } = chai;

export const dEaDAddress = "0x000000000000000000000000000000000000dEaD";

export async function onlyForked(fn: Function) {
  if (NODE_ENV === "TEST" || NODE_ENV === "DEBUG") {
    await fn();
  }
}

export const setupSigners = async () => {
  // get signers
  const { deployer } = await getNamedAccounts();
  const owner = await ethers.getSigner(deployer);
  const signers = await ethers.getSigners();
  const user1 = signers[5];
  const user2 = signers[6];
  const user3 = signers[7];
  const user4 = signers[9];
  const broadcaster = signers[8];
  const backupFeeCollector = signers[11];

  // for test proxyAdmin is set to signers[2] to have it unrelated to other accounts
  const proxyAdmin = signers[2];

  return { owner, user1, user2, user3, user4, proxyAdmin, broadcaster, backupFeeCollector };
};

export const setupContract = async <T extends Contract>(
  contractName: string,
  signer: SignerWithAddress,
  returnProxy = false
): Promise<T> => {
  const contractAddress = (await deployments.fixture([contractName]))[contractName]?.address;

  const contract = await ethers.getContractAt(
    returnProxy ? contractName : contractName.replace("Proxy", ""),
    contractAddress
  );

  return contract.connect(signer) as T;
};

export const sortAddressesAscending = (addresses: string[]): string[] => {
  return addresses.sort((a, b) => {
    const aSigner = BigNumber.from(a);
    const bSigner = BigNumber.from(b);

    return aSigner.sub(bSigner).isNegative() ? -1 : aSigner.eq(bSigner) ? 0 : 1;
  });
};
