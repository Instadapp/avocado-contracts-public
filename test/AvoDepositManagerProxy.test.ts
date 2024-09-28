import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments, ethers } from "hardhat";
import { Event } from "ethers";

import { AvoConfigV1, AvoDepositManager, AvoDepositManagerProxy } from "../typechain-types";
import { expect, setupContract, setupSigners } from "./util";

describe("AvoDepositManagerProxy", () => {
  let avoDepositManagerProxy: AvoDepositManagerProxy;
  let avoDepositManager: AvoDepositManager;
  let avoConfigV1: AvoConfigV1;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  beforeEach(async () => {
    ({ owner, user1, proxyAdmin } = await setupSigners());
    // setup contracts
    avoDepositManager = await setupContract<AvoDepositManager>("AvoDepositManager", owner);
    avoConfigV1 = await setupContract<AvoConfigV1>("AvoConfigV1", owner);

    avoDepositManagerProxy = await setupContract<AvoDepositManagerProxy>("AvoDepositManagerProxy", proxyAdmin, true);
  });

  describe("deployment", async () => {
    it("should deploy AvoDepositManagerProxy", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const deployedCode = await ethers.provider.getCode(avoDepositManagerProxy.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should have AvoDepositManager logic contract address set", async () => {
      expect(await avoDepositManagerProxy.callStatic.implementation()).to.equal(avoDepositManager.address);
    });
  });

  describe("upgradability", async () => {
    it("should be upgradeable by proxyAdmin", async () => {
      // deploy a new AvoDepositManager logic contract
      const newAvoDepositManager = await deployments.deploy("AvoDepositManager", {
        from: owner.address,
        args: ["0x0000000000000000000000000000000000000001", avoConfigV1.address],
        log: true,
        deterministicDeployment: false,
      });

      const result = await (
        await avoDepositManagerProxy.connect(proxyAdmin).upgradeTo(newAvoDepositManager.address)
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.be.greaterThanOrEqual(1);

      const event = events[events.length - 1];

      expect(event.event).to.equal("Upgraded");
      expect(event.args?.implementation).to.equal(newAvoDepositManager.address);
    });

    it("should revert if upgraded by NOT proxyAdmin", async () => {
      // deploy a new AvoDepositManager logic contract
      const newAvoDepositManager = await deployments.deploy("AvoDepositManager", {
        from: owner.address,
        args: ["0x0000000000000000000000000000000000000001", avoConfigV1.address],
        log: true,
        deterministicDeployment: false,
      });

      await expect(avoDepositManagerProxy.connect(user1).upgradeTo(newAvoDepositManager.address)).to.be.revertedWith(
        ""
      );
    });
  });
});
