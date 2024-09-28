import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments, ethers } from "hardhat";
import { Event } from "ethers";

import { AvoRegistry, AvoRegistryProxy } from "../typechain-types";
import { expect, setupContract, setupSigners } from "./util";

describe("AvoRegistryProxy", () => {
  let avoRegistryProxy: AvoRegistryProxy;
  let avoRegistry: AvoRegistry;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  beforeEach(async () => {
    ({ owner, user1, proxyAdmin } = await setupSigners());
    // setup contracts
    avoRegistry = await setupContract<AvoRegistry>("AvoRegistry", owner);

    avoRegistryProxy = await setupContract<AvoRegistryProxy>("AvoRegistryProxy", proxyAdmin, true);
  });

  describe("deployment", async () => {
    it("should deploy AvoRegistryProxy", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const deployedCode = await ethers.provider.getCode(avoRegistryProxy.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should have AvoRegistry logic contract address set", async () => {
      expect(await avoRegistryProxy.callStatic.implementation()).to.equal(avoRegistry.address);
    });
  });

  describe("upgradability", async () => {
    it("should be upgradeable by proxyAdmin", async () => {
      // deploy a new AvoRegistry logic contract
      const newAvoRegistry = await deployments.deploy("AvoRegistry", {
        from: owner.address,
        args: [proxyAdmin.address], // address for avoFactory does not really matter for the test
        log: true,
        deterministicDeployment: false,
      });

      const result = await (await avoRegistryProxy.connect(proxyAdmin).upgradeTo(newAvoRegistry.address)).wait();

      const events = result.events as Event[];
      expect(events.length).to.be.greaterThanOrEqual(1);

      const event = events[events.length - 1];

      expect(event.event).to.equal("Upgraded");
      expect(event.args?.implementation).to.equal(newAvoRegistry.address);
    });

    it("should revert if upgraded by NOT proxyAdmin", async () => {
      // deploy a new AvoRegistry logic contract
      const newAvoRegistry = await deployments.deploy("AvoRegistry", {
        from: owner.address,
        args: [proxyAdmin.address], // address for avoFactory does not really matter for the test
        log: true,
        deterministicDeployment: false,
      });

      await expect(avoRegistryProxy.connect(user1).upgradeTo(newAvoRegistry.address)).to.be.revertedWith("");
    });
  });
});
