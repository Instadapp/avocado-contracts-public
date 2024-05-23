import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments, ethers } from "hardhat";
import { Event } from "ethers";

import { AvoForwarder, AvoForwarderProxy } from "../typechain-types";
import { expect, setupContract, setupSigners } from "./util";

describe("AvoForwarderProxy", () => {
  let avoForwarderProxy: AvoForwarderProxy;
  let avoForwarder: AvoForwarder;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  beforeEach(async () => {
    ({ owner, user1, proxyAdmin } = await setupSigners());
    // setup contracts
    avoForwarder = await setupContract<AvoForwarder>("AvoForwarder", owner);

    avoForwarderProxy = await setupContract<AvoForwarderProxy>("AvoForwarderProxy", proxyAdmin, true);
  });

  describe("deployment", async () => {
    it("should deploy AvoForwarderProxy", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const deployedCode = await ethers.provider.getCode(avoForwarderProxy.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should have AvoForwarder logic contract address set", async () => {
      expect(await avoForwarderProxy.callStatic.implementation()).to.equal(avoForwarder.address);
    });
  });

  describe("upgradability", async () => {
    it("should be upgradeable by proxyAdmin", async () => {
      // deploy a new AvoForwarder logic contract
      const newAvoForwarder = await deployments.deploy("AvoForwarder", {
        from: owner.address,
        args: [avoForwarder.address], // args value doesn't really matter
        log: true,
        deterministicDeployment: false,
      });

      const result = await (await avoForwarderProxy.connect(proxyAdmin).upgradeTo(newAvoForwarder.address)).wait();

      const events = result.events as Event[];
      expect(events.length).to.be.greaterThanOrEqual(1);

      const event = events[events.length - 1];

      expect(event.event).to.equal("Upgraded");
      expect(event.args?.implementation).to.equal(newAvoForwarder.address);
    });

    it("should revert if upgraded by NOT proxyAdmin", async () => {
      // deploy a new AvoForwarder logic contract
      const newAvoForwarder = await deployments.deploy("AvoForwarder", {
        from: owner.address,
        args: [avoForwarder.address], // args value doesn't really matter
        log: true,
        deterministicDeployment: false,
      });

      await expect(avoForwarderProxy.connect(user1).upgradeTo(newAvoForwarder.address)).to.be.revertedWith("");
    });
  });
});
