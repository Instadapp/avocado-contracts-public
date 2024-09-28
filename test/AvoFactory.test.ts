import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { constants, Event } from "ethers";
import { hexlify, hexZeroPad } from "ethers/lib/utils";
import { deployments, ethers, getNamedAccounts } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import {
  IAvoFactory,
  AvoFactory,
  AvoRegistry,
  AvoForwarder,
  AvocadoMultisig,
  IAvocadoMultisigV1__factory,
  AvoSignersList,
  AvoFactory__factory,
  MockContractWith_dataMethod__factory,
  AvoConfigV1,
  AvocadoMultisigSecondary,
} from "../typechain-types";
import { expect, setupContract, setupSigners } from "./util";
import { TestHelpers } from "./TestHelpers";

describe("AvoFactory", () => {
  let avoFactory: IAvoFactory & AvoFactory;
  let avoRegistry: AvoRegistry;
  let avoMultisigLogicContract: AvocadoMultisig;
  let avoSecondary: AvocadoMultisigSecondary;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    ({ owner, user1, user2 } = await setupSigners());

    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);

    avoRegistry = await setupContract<AvoRegistry>("AvoRegistryProxy", owner);

    avoMultisigLogicContract = await setupContract<AvocadoMultisig>("AvocadoMultisig", user1);

    avoSecondary = await setupContract<AvocadoMultisigSecondary>("AvocadoMultisigSecondary", owner);
  });

  afterEach(async () => {
    // ensure transient storage slots are reset (slots 102 and 103)
    let transientStorageSlot = await avoFactory.provider?.getStorageAt(avoFactory.address, 102);
    expect(transientStorageSlot).to.equal(hexZeroPad(hexlify(1), 32));
    transientStorageSlot = await avoFactory.provider?.getStorageAt(avoFactory.address, 103);
    expect(transientStorageSlot).to.equal(hexZeroPad(hexlify(1), 32));
  });

  describe("deployment", async () => {
    it("should deploy AvoFactory", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const avoFactoryDeployment = await deployments.get("AvoFactory");
      const deployedCode = await ethers.provider.getCode(avoFactoryDeployment.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should revert if avoRegistry is set to zero address at deployment", async () => {
      const { deployer } = await getNamedAccounts();

      await expect(
        deployments.deploy("AvoFactory", {
          from: deployer,
          args: [constants.AddressZero],
        })
      ).to.be.revertedWith("");
    });

    it("should have avoRegistry address set", async () => {
      expect(await avoFactory.avoRegistry()).to.equal(avoRegistry.address);
    });

    it("should have avoImpl address set", async () => {
      expect(await avoFactory.avoImpl()).to.equal(avoMultisigLogicContract.address);
    });

    it("should have avocadoBytecode set same as in prior versions", async () => {
      expect(await avoFactory.avocadoBytecode()).to.equal(
        "0x6b106ae0e3afae21508569f62d81c7d826b900a2e9ccc973ba97abfae026fc54"
      );
    });

    it("should have initializer disabled on logic contract", async () => {
      const logicContractAddress = (await deployments.fixture(["AvoFactory"]))["AvoFactory"]?.address as string;

      const logicContract = (await ethers.getContractAt("AvoFactory", logicContractAddress)) as AvoFactory;

      // try to initialize, should fail because disabled
      await expect(logicContract.initialize()).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("initialize", async () => {
    it("should revert if already initialized", async () => {
      await expect(avoFactory.initialize()).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("computeAvocado", async () => {
    const subject = (owner: string, index = 0) => {
      return avoFactory.computeAvocado(owner, index);
    };

    it("should return zero address if owner is not EOA", async () => {
      const avoImplAddress = await avoFactory.avoImpl();
      const result = await subject(avoImplAddress);
      expect(result).to.equal(constants.AddressZero);
    });

    it("should computeAvocado", async () => {
      const result = await subject(owner.address);
      expect(result).to.not.equal(constants.AddressZero);
    });

    it("should computeAvocado with index > 1", async () => {
      const result = await subject(owner.address, 2);
      expect(result).to.not.equal(constants.AddressZero);
    });

    it("should be deterministic based on owner", async () => {
      const resultOwner1 = await subject(owner.address);
      const resultUser1 = await subject(user1.address);

      await time.increase(1000); // simulate time passing to simulate a changing environment

      const resultOwner2 = await subject(owner.address);
      const resultUser2 = await subject(user1.address);

      expect(resultOwner1).to.equal(resultOwner2);
      expect(resultUser1).to.equal(resultUser2);
      expect(resultOwner1).to.not.equal(resultUser1);
    });
  });

  describe("isAvocado", async () => {
    const subject = (address: string) => {
      return avoFactory.isAvocado(address);
    };

    it("should isAvocado (when already deployed)", async () => {
      // avocadoMultisig for user 1 is already deployed through hardhat-deploy script local
      const avocadoMultisig = await avoFactory.computeAvocado(user1.address, 0);
      expect(await subject(avocadoMultisig)).to.equal(true);
    });

    it("should isAvocado (when already deployed) for index > 0", async () => {
      const index = 2;
      await avoFactory.deploy(user1.address, index);
      // avocadoMultisig for user 1 is already deployed through hardhat-deploy script local
      const avocadoMultisig = await avoFactory.computeAvocado(user1.address, index);
      expect(await subject(avocadoMultisig)).to.equal(true);
    });

    it("should return false for non Avo smart wallet contract", async () => {
      expect(await subject(avoFactory.address)).to.equal(false);
    });

    it("should return false for non Avo smart wallet contract with _data() method", async () => {
      // deploy mock contract with _data method
      const mockContractFactory = (await ethers.getContractFactory(
        "MockContractWith_dataMethod",
        owner
      )) as MockContractWith_dataMethod__factory;
      const mockContract = await mockContractFactory.deploy();
      await mockContract.deployed();

      expect(await subject(mockContract.address)).to.equal(false);
    });

    it("should return false when not yet deployed", async () => {
      const avoWallet = await avoFactory.computeAvocado(user2.address, 0);
      // can not recognize for not yet deployed avo smart wallet...
      expect(await subject(avoWallet)).to.equal(false);
    });

    it("should return false when not yet deployed with index > 0", async () => {
      const avoWallet = await avoFactory.computeAvocado(user2.address, 2);
      // can not recognize for not yet deployed avo smart wallet...
      expect(await subject(avoWallet)).to.equal(false);
    });

    it("should return false for an EOA", async () => {
      expect(await subject(user1.address)).to.equal(false);
    });

    it("should return false if address is zero address", async () => {
      expect(await subject(ethers.constants.AddressZero)).to.equal(false);
    });
  });

  describe("setAvoImpl", async () => {
    it("should setAvoImpl through registry", async () => {
      await avoRegistry.setAvoVersion(avoFactory.address, true, true);
      expect(await avoFactory.avoImpl()).to.equal(avoFactory.address);
    });

    it("should revert if not called by registry", async () => {
      await expect(avoFactory.setAvoImpl(avoFactory.address)).to.be.revertedWith("AvoFactory__Unauthorized");
    });
  });

  //#region deploy AvocadoMultisig
  context("Multisig", async () => {
    const testHelpers = new TestHelpers();

    describe("deploy", async () => {
      const subject = (owner: string, index = 0) => {
        return avoFactory.deploy(owner, index);
      };

      it("should revert if owner is not EOA", async () => {
        const avoImplAddress = await avoFactory.avoImpl();

        await expect(subject(avoImplAddress)).to.be.revertedWith("AvoFactory__NotEOA");
      });

      it("should revert if owner is address zero", async () => {
        await expect(subject(ethers.constants.AddressZero)).to.be.revertedWith("AvoFactory__NotEOA");
      });

      it("should deploy Avocado", async () => {
        const result = await avoFactory.callStatic.deploy(owner.address, 0);
        expect(result).to.not.equal(constants.AddressZero);
      });

      it("should deploy with expected bytecode", async () => {
        await avoFactory.deploy(owner.address, 0);
        const expectedAddress = await avoFactory.computeAvocado(owner.address, 0);
        const code = await owner.provider?.getCode(expectedAddress);
        // expected bytecode can be hardcoded because we use hardcoded creationCode
        expect(code).to.equal(
          "0x60806040527f000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922666000357f4d42058500000000000000000000000000000000000000000000000000000000810161006f5773ffffffffffffffffffffffffffffffffffffffff821660005260206000f35b7f68beab3f0000000000000000000000000000000000000000000000000000000081036100a0578160005260206000f35b73ffffffffffffffffffffffffffffffffffffffff600054167f874095c60000000000000000000000000000000000000000000000000000000082036100ea578060005260206000f35b3660008037600080366000845af49150503d6000803e80801561010c573d6000f35b3d6000fdfea2646970667358221220bf171834b0948ebffd196d6a4208dbd5d0a71f76dfac9d90499de318c59558fc64736f6c63430008120033"
        );
      });

      it("should deploy Avocado with index > 0", async () => {
        await avoFactory.deploy(owner.address, 0);
        const result = await avoFactory.callStatic.deploy(owner.address, 4);
        expect(result).to.not.equal(constants.AddressZero);
      });

      it("should deploy Avocado with index > 20", async () => {
        // must deploy at index 20 for that, from 20 on must be sequential
        await avoFactory.deploy(owner.address, 20);
        const result = await avoFactory.callStatic.deploy(owner.address, 6);
        expect(result).to.not.equal(constants.AddressZero);
      });

      it("should revert on deploy Avocado with index > 20 when index-1 not deployed yet", async () => {
        await avoFactory.deploy(owner.address, 19);
        await expect(avoFactory.deploy(owner.address, 21)).to.be.revertedWith("AvoFactory__IndexNonSequential");
      });

      it("should emit AvocadoDeployed event with expected matching address", async () => {
        await avoFactory.deploy(owner.address, 0);

        const result = await subject(owner.address, 1);
        const events = (await result.wait())?.events as Event[];
        const expectedAddress = await avoFactory.computeAvocado(owner.address, 1);
        expect(expectedAddress).to.not.equal(constants.AddressZero);

        expect(events?.length).to.be.greaterThanOrEqual(1);
        expect(events[events?.length - 1]?.event).to.equal("AvocadoDeployed");
        expect(events[events?.length - 1]?.args?.owner).to.equal(owner.address);
        expect(events[events?.length - 1]?.args?.index).to.equal(1);
        expect(events[events?.length - 1]?.args?.avoType).to.equal(0);
        expect(events[events?.length - 1]?.args?.avocado).to.equal(expectedAddress);
      });

      it("should revert if AvocadoMultisig is already deployed for owner", async () => {
        await subject(owner.address);
        await expect(subject(owner.address)).to.be.revertedWith("");
      });

      it("should initialize the deployed AvocadoMultisig", async () => {
        // ensure event was emitted
        const res = await (await subject(owner.address)).wait();
        // event at pos 0 is SignerAdded, pos 1 is RequiredSignersSet, pos 2 is from AvoSignersList owner sync
        const event = (res.events as Event[])[3];
        expect(event?.event).to.equal("Initialized");

        // ensure not initializable anymore because already initialized
        const expectedAddress = await avoFactory.computeAvocado(owner.address, 0);
        const newAvocadoMultisig = IAvocadoMultisigV1__factory.connect(expectedAddress, owner);
        await expect(newAvocadoMultisig.initialize()).to.be.revertedWith(
          "Initializable: contract is already initialized"
        );
      });

      it("should revert if avoImpl is not set", async () => {
        const { deployer } = await getNamedAccounts();

        const newFactoryDeployment = await deployments.deploy("AvoFactory", {
          from: deployer,
          args: [avoRegistry.address],
        });

        const newFactory = AvoFactory__factory.connect(newFactoryDeployment.address, owner);

        await expect(newFactory.deploy(owner.address, 0)).to.be.revertedWith("AvoFactory__ImplementationNotDefined");
      });
    });

    describe("deployWithVersion", async () => {
      let newAvocadoMultisigVersion: string;

      beforeEach(async () => {
        const avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", owner);
        const avoSignersList = await setupContract<AvoSignersList>("AvoSignersListProxy", owner);

        // deploy a new version of AvocadoMultisig logic contract
        newAvocadoMultisigVersion = (
          await testHelpers.deployAvocadoMultisigContract(
            owner.address,
            avoRegistry.address,
            avoForwarder.address,
            await setupContract<AvoConfigV1>("AvoConfigV1", owner),
            avoSignersList.address,
            avoSecondary.address
          )
        ).address;

        // register new version at registry
        await avoRegistry.setAvoVersion(newAvocadoMultisigVersion, true, false);
      });

      const subject = (owner: string, version: string, index = 0) => {
        return avoFactory.deployWithVersion(owner, index, version);
      };

      it("should revert if owner is not EOA", async () => {
        await expect(subject(newAvocadoMultisigVersion, newAvocadoMultisigVersion)).to.be.revertedWith(
          "AvoFactory__NotEOA"
        );
      });

      it("should revert if owner is address zero", async () => {
        await expect(subject(ethers.constants.AddressZero, newAvocadoMultisigVersion)).to.be.revertedWith(
          "AvoFactory__NotEOA"
        );
      });

      it("should deploy Avocado", async () => {
        const result = await avoFactory.callStatic.deployWithVersion(owner.address, 0, newAvocadoMultisigVersion);
        expect(result).to.not.equal(constants.AddressZero);
      });

      it("should deploy with expected bytecode", async () => {
        await avoFactory.deployWithVersion(owner.address, 0, newAvocadoMultisigVersion);
        const expectedAddress = await avoFactory.computeAvocado(owner.address, 0);
        const code = await owner.provider?.getCode(expectedAddress);
        // expected bytecode can be hardcoded because we use hardcoded creationCode
        expect(code).to.equal(
          "0x60806040527f000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922666000357f4d42058500000000000000000000000000000000000000000000000000000000810161006f5773ffffffffffffffffffffffffffffffffffffffff821660005260206000f35b7f68beab3f0000000000000000000000000000000000000000000000000000000081036100a0578160005260206000f35b73ffffffffffffffffffffffffffffffffffffffff600054167f874095c60000000000000000000000000000000000000000000000000000000082036100ea578060005260206000f35b3660008037600080366000845af49150503d6000803e80801561010c573d6000f35b3d6000fdfea2646970667358221220bf171834b0948ebffd196d6a4208dbd5d0a71f76dfac9d90499de318c59558fc64736f6c63430008120033"
        );
      });

      it("should deploy Avocado with index > 0", async () => {
        await avoFactory.deployWithVersion(owner.address, 0, newAvocadoMultisigVersion);
        const result = await avoFactory.callStatic.deployWithVersion(owner.address, 4, newAvocadoMultisigVersion);
        expect(result).to.not.equal(constants.AddressZero);
      });

      it("should deploy Avocado with index > 20", async () => {
        // must deploy at index 20 for that, from 20 on must be sequential
        await avoFactory.deployWithVersion(owner.address, 20, newAvocadoMultisigVersion);
        const result = await avoFactory.callStatic.deployWithVersion(owner.address, 6, newAvocadoMultisigVersion);
        expect(result).to.not.equal(constants.AddressZero);
      });

      it("should revert on deploy Avocado with index > 20 when index-1 not deployed yet", async () => {
        await avoFactory.deployWithVersion(owner.address, 19, newAvocadoMultisigVersion);
        await expect(avoFactory.deployWithVersion(owner.address, 21, newAvocadoMultisigVersion)).to.be.revertedWith(
          "AvoFactory__InvalidParams"
        );
      });

      it("should emit AvocadoDeployedWithVersion event with expected matching address", async () => {
        await avoFactory.deploy(owner.address, 0);

        const result = await subject(owner.address, newAvocadoMultisigVersion, 1);
        const events = (await result.wait())?.events as Event[];
        const expectedAddress = await avoFactory.computeAvocado(owner.address, 1);
        expect(expectedAddress).to.not.equal(constants.AddressZero);

        expect(events?.length).to.be.greaterThanOrEqual(1);
        expect(events[events?.length - 1]?.event).to.equal("AvocadoDeployedWithVersion");
        expect(events[events?.length - 1]?.args?.owner).to.equal(owner.address);
        expect(events[events?.length - 1]?.args?.index).to.equal(1);
        expect(events[events?.length - 1]?.args?.avoType).to.equal(0);
        expect(events[events?.length - 1]?.args?.avocado).to.equal(expectedAddress);
        expect(events[events?.length - 1]?.args?.version).to.equal(newAvocadoMultisigVersion);
      });

      it("should revert if AvocadoMultisig is already deployed for owner", async () => {
        await subject(owner.address, newAvocadoMultisigVersion);
        await expect(subject(owner.address, newAvocadoMultisigVersion)).to.be.revertedWith("");
      });

      it("should revert if version is not allowed through registry", async () => {
        const avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", owner);
        const avoSignersList = await setupContract<AvoSignersList>("AvoSignersListProxy", owner);

        // deploy a new version of AvocadoMultisig logic contract
        const unregisteredAvocadoMultisigVersion = (
          await testHelpers.deployAvocadoMultisigContract(
            owner.address,
            avoRegistry.address,
            avoForwarder.address,
            await setupContract<AvoConfigV1>("AvoConfigV1", owner),
            avoSignersList.address,
            avoSecondary.address
          )
        ).address;

        await expect(subject(owner.address, unregisteredAvocadoMultisigVersion)).to.be.revertedWith(
          "AvoRegistry__InvalidVersion"
        );
      });

      it("should initialize the deployed AvocadoMultisig", async () => {
        // ensure event was emitted
        const res = await (await subject(owner.address, newAvocadoMultisigVersion)).wait();
        // event at pos 0 is SignerAdded, pos 1 is RequiredSignersSet, pos 2 is from AvoSignersList owner sync
        const event = (res.events as Event[])[3];
        expect(event?.event).to.equal("Initialized");

        // ensure not initializable anymore because already initialized
        const expectedAddress = await avoFactory.computeAvocado(owner.address, 0);
        const newAvocadoMultisig = IAvocadoMultisigV1__factory.connect(expectedAddress, owner);
        await expect(newAvocadoMultisig.initialize()).to.be.revertedWith(
          "Initializable: contract is already initialized"
        );
      });

      it("should set expected AvoImpl version", async () => {
        expect(await avoFactory.avoImpl()).to.equal(avoMultisigLogicContract.address);
        expect(newAvocadoMultisigVersion).to.not.equal(avoMultisigLogicContract.address);

        await subject(user2.address, newAvocadoMultisigVersion);

        const expectedAddress = await avoFactory.computeAvocado(user2.address, 0);

        const avoImpl = await testHelpers.readAvoImplAddress(expectedAddress);

        expect(avoImpl.toLowerCase()).to.equal(newAvocadoMultisigVersion.toLowerCase());

        expect(await avoFactory.avoImpl()).to.equal(avoMultisigLogicContract.address);
      });
    });
  });
  //#endregion
});
