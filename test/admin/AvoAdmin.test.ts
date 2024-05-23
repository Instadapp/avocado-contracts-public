import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments, ethers } from "hardhat";

import { AvoAdmin, AvoAdmin__factory } from "../../typechain-types";
import { expect, setupSigners } from "../util";

describe("AvoAdmin", () => {
  let avoAdmin: AvoAdmin;
  let proxyAdmin: SignerWithAddress;
  let owner: SignerWithAddress;

  beforeEach(async () => {
    ({ proxyAdmin, owner } = await setupSigners());
    // setup contracts
    const avoAdminDeployment = await deployments.deploy("AvoAdmin", {
      from: owner.address,
      args: [proxyAdmin.address],
    });

    avoAdmin = AvoAdmin__factory.connect(avoAdminDeployment.address, proxyAdmin);
  });

  describe("deployment", async () => {
    it("should deploy AvoAdmin", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const deployedCode = await ethers.provider.getCode(avoAdmin.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should have proxyAdmin as owner", async () => {
      expect(await avoAdmin.owner()).to.equal(proxyAdmin.address);
    });
  });

  describe("renounceOwnerhsip", async () => {
    it("should revert if called", async () => {
      await expect(avoAdmin.connect(proxyAdmin).renounceOwnership()).to.be.revertedWith("AvoAdmin__Unsupported()");
    });
  });
});
