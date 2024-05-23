import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { constants, ContractReceipt, Event } from "ethers";
import { parseEther, toUtf8Bytes } from "ethers/lib/utils";
import { deployments, ethers, getNamedAccounts } from "hardhat";

import { AvoFactory, AvoRegistry, AvoRegistry__factory } from "../typechain-types";
import { expect, setupContract, setupSigners } from "./util";

describe("AvoRegistry", () => {
  let avoFactory: AvoFactory;
  let avoRegistry: AvoRegistry;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  beforeEach(async () => {
    ({ owner, user1, proxyAdmin } = await setupSigners());
    // setup contracts
    avoRegistry = await setupContract<AvoRegistry>("AvoRegistryProxy", owner);

    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
  });

  describe("deployment", async () => {
    it("should deploy AvoRegistry", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const avoRegistryDeployment = await deployments.get("AvoRegistry");
      const deployedCode = await ethers.provider.getCode(avoRegistryDeployment.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should have avoFactory address set", async () => {
      expect(await avoRegistry.avoFactory()).to.equal(avoFactory.address);
    });

    it("should have initializer disabled on logic contract", async () => {
      const logicContractAddress = (await deployments.fixture(["AvoRegistry"]))["AvoRegistry"]?.address as string;

      const logicContract = (await ethers.getContractAt("AvoRegistry", logicContractAddress)) as AvoRegistry;

      // try to initialize, should fail because disabled
      await expect(logicContract.initialize(owner.address)).to.be.revertedWith(
        "Initializable: contract is already initialized"
      );
    });
  });

  describe("initialize", async () => {
    it("should revert if already initialized", async () => {
      await expect(avoRegistry.initialize(owner.address)).to.be.revertedWith(
        "Initializable: contract is already initialized"
      );
    });

    it("should set owner at initialize", async () => {
      expect(await avoRegistry.owner()).to.equal(owner.address);
    });

    it("should revert if initialized with owner set to 0x000... address", async () => {
      // custom deployment with proxy
      const { deployer } = await getNamedAccounts();

      const logicContractAddress = (await deployments.fixture(["AvoRegistry"]))["AvoRegistry"]?.address as string;

      // deploy proxy uninitialized
      const newProxyDeployment = await deployments.deploy("AvoRegistryProxy", {
        from: deployer,
        args: [logicContractAddress, proxyAdmin.address, toUtf8Bytes("")],
      });

      const newContract = AvoRegistry__factory.connect(newProxyDeployment.address, owner);

      await expect(newContract.initialize(constants.AddressZero)).to.be.revertedWith("AvoRegistry__InvalidParams");
    });
  });

  context("owner only actions", async () => {
    describe("renounceOwnerhsip", async () => {
      it("should revert if called", async () => {
        await expect(avoRegistry.connect(owner).renounceOwnership()).to.be.revertedWith("AvoRegistry__Unsupported()");
      });
    });

    describe("setAvoForwarderVersion", async () => {
      it("should setAvoForwarderVersion -> add an address", async () => {
        await avoRegistry.setAvoForwarderVersion(avoFactory.address, true);
        expect(await avoRegistry.avoForwarderVersions(avoFactory.address)).to.equal(true);
      });

      it("should setAvoForwarderVersion -> remove an address", async () => {
        // set
        await avoRegistry.setAvoForwarderVersion(avoFactory.address, true);
        expect(await avoRegistry.avoForwarderVersions(avoFactory.address)).to.equal(true);

        // unset
        await avoRegistry.setAvoForwarderVersion(avoFactory.address, false);
        expect(await avoRegistry.avoForwarderVersions(avoFactory.address)).to.equal(false);
      });

      it("should emit SetAvoForwarderVersion event", async () => {
        const result = (await (
          await avoRegistry.setAvoForwarderVersion(avoFactory.address, true)
        ).wait()) as ContractReceipt;

        const events = result.events as Event[];
        expect(events.length).to.be.greaterThanOrEqual(1);

        const event = events[events.length - 1];

        expect(event.event).to.equal("SetAvoForwarderVersion");
        expect(event.args?.avoForwarderVersion).to.equal(avoFactory.address);
        expect(event.args?.allowed).to.equal(true);
      });

      it("should revert if called by NOT owner", async () => {
        await expect(avoRegistry.connect(user1).setAvoForwarderVersion(avoFactory.address, true)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("should revert if set to invalid address (zero address)", async () => {
        await expect(avoRegistry.setAvoForwarderVersion(constants.AddressZero, true)).to.be.revertedWith(
          "AvoRegistry__InvalidParams"
        );
      });

      it("should revert if setting an EOA", async () => {
        await expect(avoRegistry.setAvoForwarderVersion(user1.address, true)).to.be.revertedWith(
          "AvoRegistry__InvalidParams"
        );
      });
    });

    describe("setAvoVersion", async () => {
      it("should setAvoVersion -> add an address", async () => {
        await avoRegistry.setAvoVersion(avoFactory.address, true, false);
        expect(await avoRegistry.avoVersions(avoFactory.address)).to.equal(true);
      });

      it("should setAvoVersion -> add an address as default in factory", async () => {
        await avoRegistry.setAvoVersion(avoFactory.address, true, true);
        expect(await avoFactory.avoImpl()).to.equal(avoFactory.address);
      });

      it("should setAvoVersion -> remove an address", async () => {
        // set
        await avoRegistry.setAvoVersion(avoFactory.address, true, false);
        expect(await avoRegistry.avoVersions(avoFactory.address)).to.equal(true);

        // unset
        await avoRegistry.setAvoVersion(avoFactory.address, false, false);
        expect(await avoRegistry.avoVersions(avoFactory.address)).to.equal(false);
      });

      it("should emit SetAvoVersion event", async () => {
        const result = (await (
          await avoRegistry.setAvoVersion(avoFactory.address, true, false)
        ).wait()) as ContractReceipt;

        const events = result.events as Event[];
        expect(events.length).to.be.greaterThanOrEqual(1);

        const event = events[events.length - 1];

        expect(event.event).to.equal("SetAvoVersion");
        expect(event.args?.avoVersion).to.equal(avoFactory.address);
        expect(event.args?.allowed).to.equal(true);
        expect(event.args?.setDefault).to.equal(false);
      });

      it("should revert if called by NOT owner", async () => {
        await expect(avoRegistry.connect(user1).setAvoVersion(avoFactory.address, true, false)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });

      it("should revert if set to invalid address (zero address)", async () => {
        await expect(avoRegistry.setAvoVersion(constants.AddressZero, true, false)).to.be.revertedWith(
          "AvoRegistry__InvalidParams"
        );
      });

      it("should revert if allowed = false but trying to set as default", async () => {
        await expect(avoRegistry.setAvoVersion(avoFactory.address, false, true)).to.be.revertedWith(
          "AvoRegistry__InvalidParams"
        );
      });

      it("should revert if setting an EOA", async () => {
        await expect(avoRegistry.setAvoVersion(user1.address, true, true)).to.be.revertedWith(
          "AvoRegistry__InvalidParams"
        );
      });
    });

    describe("requireValidAvoForwarderVersion", async () => {
      it("should requireValidAvoForwarderVersion if set to true", async () => {
        await avoRegistry.setAvoForwarderVersion(avoFactory.address, true);
        // this would revert if it is not a valid version and the test would fail
        await avoRegistry.requireValidAvoForwarderVersion(avoFactory.address);
      });

      it("should requireValidAvoForwarderVersion revert if set to false", async () => {
        await expect(avoRegistry.requireValidAvoForwarderVersion(avoFactory.address)).to.be.revertedWith(
          "AvoRegistry__InvalidVersion"
        );
      });
    });

    describe("requireValidAvoVersion", async () => {
      it("should requireValidAvoVersion if set to true", async () => {
        await avoRegistry.setAvoVersion(avoFactory.address, true, false);
        // this would revert if it is not a valid version and the test would fail
        await avoRegistry.requireValidAvoVersion(avoFactory.address);
      });

      it("should requireValidAvoVersion revert if set to false", async () => {
        await expect(avoRegistry.requireValidAvoVersion(avoFactory.address)).to.be.revertedWith(
          "AvoRegistry__InvalidVersion"
        );
      });
    });

    describe("updateFeeConfig", async () => {
      it("should updateFeeConfig", async () => {
        const feeConfigBefore = await avoRegistry.feeConfig();
        expect(feeConfigBefore.feeCollector).to.equal(constants.AddressZero);
        expect(feeConfigBefore.fee).to.equal(0);
        expect(feeConfigBefore.mode).to.equal(0);

        await avoRegistry.updateFeeConfig({ fee: 100, feeCollector: owner.address, mode: 1 });

        const feeConfigAfter = await avoRegistry.feeConfig();
        expect(feeConfigAfter.feeCollector).to.equal(owner.address);
        expect(feeConfigAfter.fee).to.equal(100);
        expect(feeConfigAfter.mode).to.equal(1);
      });

      it("should emit FeeConfigUpdated for updateFeeConfig", async () => {
        const result = await (
          await avoRegistry.updateFeeConfig({ fee: 100, feeCollector: owner.address, mode: 1 })
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.be.greaterThanOrEqual(1);

        const event = events[events.length - 1];

        expect(event.event).to.equal("FeeConfigUpdated");
        expect(event.args?.feeCollector).to.equal(owner.address);
        expect(event.args?.fee).to.equal(100);
        expect(event.args?.mode).to.equal(1);
      });

      it("should revert if setting percentage fee > 100%", async () => {
        await expect(
          avoRegistry.updateFeeConfig({ fee: 1000000001, feeCollector: owner.address, mode: 0 })
        ).to.be.revertedWith("AvoRegistry__InvalidParams");
      });

      it("should revert if called by NOT owner", async () => {
        await expect(
          avoRegistry.connect(user1).updateFeeConfig({ fee: 0, feeCollector: owner.address, mode: 1 })
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("should revert if feeCollector is set to invalid address (zero address)", async () => {
        await expect(
          avoRegistry.updateFeeConfig({ fee: 0, feeCollector: constants.AddressZero, mode: 1 })
        ).to.be.revertedWith("AvoRegistry__InvalidParams");
      });

      it("should revert if fee config mode is not implemented", async () => {
        await expect(avoRegistry.updateFeeConfig({ fee: 0, feeCollector: owner.address, mode: 2 })).to.be.revertedWith(
          "AvoRegistry__FeeModeNotImplemented(2)"
        );
      });
    });
  });

  describe("calcFee", async () => {
    it("should calcFee return correct feeCollector", async () => {
      // set fee collector owner.address
      await avoRegistry.updateFeeConfig({ fee: 1e7, feeCollector: owner.address, mode: 0 });

      expect((await avoRegistry.calcFee(8_000))[1]).to.equal(owner.address);
    });

    it("should calcFee for mode percentage (0)", async () => {
      // set percentage fee (mode 0) with 10% (1e7)
      await avoRegistry.updateFeeConfig({ fee: 1e7, feeCollector: owner.address, mode: 0 });

      expect((await avoRegistry.calcFee(8_000, { gasPrice: 2000 }))[0]).to.equal(800 * 2000);
      expect((await avoRegistry.calcFee(770, { gasPrice: 2000 }))[0]).to.equal(77 * 2000);
    });

    it("should calcFee for mode absolute (1)", async () => {
      // set absolute fee (mode 1) with 0.1 ether as fee
      await avoRegistry.updateFeeConfig({ fee: parseEther("0.1"), feeCollector: owner.address, mode: 1 });

      expect((await avoRegistry.calcFee(8_000, { gasPrice: 2000 }))[0]).to.equal(parseEther("0.1"));
      expect((await avoRegistry.calcFee(770, { gasPrice: 2000 }))[0]).to.equal(parseEther("0.1"));
    });

    it("should revert if fee config mode is percentage (0) and gasUsed input is 0", async () => {
      // set percentage fee (mode 0) with 10% (1e7)
      await avoRegistry.updateFeeConfig({ fee: 1e7, feeCollector: owner.address, mode: 0 });

      await expect(avoRegistry.calcFee(0)).to.be.revertedWith("AvoRegistry__InvalidParams()");
    });
  });
});
