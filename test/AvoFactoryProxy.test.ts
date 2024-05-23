import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments, ethers } from "hardhat";
import { Event } from "ethers";

import { AvoFactory, AvoFactoryProxy } from "../typechain-types";
import { expect, setupContract, setupSigners } from "./util";

describe("AvoFactoryProxy", () => {
  let avoFactoryProxy: AvoFactoryProxy;
  let avoFactory: AvoFactory;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  beforeEach(async () => {
    ({ owner, user1, proxyAdmin } = await setupSigners());
    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactory", owner);

    avoFactoryProxy = await setupContract<AvoFactoryProxy>("AvoFactoryProxy", proxyAdmin, true);
  });

  describe("deployment", async () => {
    it("should deploy AvoFactoryProxy", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const deployedCode = await ethers.provider.getCode(avoFactoryProxy.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should have AvoFactory logic contract address set", async () => {
      expect(await avoFactoryProxy.callStatic.implementation()).to.equal(avoFactory.address);
    });
  });

  describe("upgradability", async () => {
    it("should be upgradeable by proxyAdmin", async () => {
      // deploy a new AvoFactory logic contract
      const newAvoFactory = await deployments.deploy("AvoFactory", {
        from: owner.address,
        args: [(await deployments.get("AvoRegistryProxy")).address],
        log: true,
        deterministicDeployment: false,
      });

      const result = await (await avoFactoryProxy.connect(proxyAdmin).upgradeTo(newAvoFactory.address)).wait();

      const events = result.events as Event[];
      expect(events.length).to.be.greaterThanOrEqual(1);

      const event = events[events.length - 1];

      expect(event.event).to.equal("Upgraded");
      expect(event.args?.implementation).to.equal(newAvoFactory.address);
    });

    it("should revert if upgraded by NOT proxyAdmin", async () => {
      // deploy a new AvoFactory logic contract
      const newAvoFactory = await deployments.deploy("AvoFactory", {
        from: owner.address,
        args: [avoFactory.address], // args value doesn't really matter
        log: true,
        deterministicDeployment: false,
      });

      await expect(avoFactoryProxy.connect(user1).upgradeTo(newAvoFactory.address)).to.be.revertedWith("");
    });
  });
});
