import { BigNumber, constants, Event } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments, ethers, getNamedAccounts } from "hardhat";

import { expect, setupContract, setupSigners, sortAddressesAscending } from "./util";
import {
  AvocadoMultisig,
  AvocadoMultisig__factory,
  AvoFactory,
  IAvocadoMultisigV1,
  AvoSignersList,
  IAvoFactory,
  AvoSignersList__factory,
  AvoSignersListProxy,
  MockSelfDestruct__factory,
  AvoConfigV1,
} from "../typechain-types";
import { TestHelpers } from "./TestHelpers";
import { AvocadoMultisigStructs } from "../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";

describe("AvoSignersList", () => {
  let avocadoMultisig: AvocadoMultisig & IAvocadoMultisigV1;
  let avocadoMultisigUser2: AvocadoMultisig & IAvocadoMultisigV1;
  let avoFactory: IAvoFactory & AvoFactory;
  let avoSignersList: AvoSignersList;
  let avoSignersListProxy: AvoSignersListProxy;
  let avoConfigV1: AvoConfigV1;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  let testHelpers: TestHelpers;

  let gasCostWithTrackingAdd: BigNumber;
  let gasCostWithTrackingAddMultiple: BigNumber;

  beforeEach(async () => {
    ({ owner, user1, user2, user3, proxyAdmin } = await setupSigners());
    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
    avoSignersList = await setupContract<AvoSignersList>("AvoSignersListProxy", owner);
    avoSignersListProxy = await setupContract<AvoSignersListProxy>("AvoSignersListProxy", proxyAdmin, true);
    avoConfigV1 = await setupContract<AvoConfigV1>("AvoConfigV1", owner);

    // avocadoMultisig for user1 is already deployed through hardhat-deploy script local
    avocadoMultisig = AvocadoMultisig__factory.connect(
      await avoFactory.computeAvocado(user1.address, 0),
      user1
    ) as AvocadoMultisig & IAvocadoMultisigV1;

    // deploy avocadoMultisig for user2
    await avoFactory.deploy(user2.address, 0);
    avocadoMultisigUser2 = AvocadoMultisig__factory.connect(
      await avoFactory.computeAvocado(user2.address, 0),
      user2
    ) as AvocadoMultisig & IAvocadoMultisigV1;

    testHelpers = new TestHelpers();
  });

  describe("deployment", async () => {
    it("should deploy AvoSignersList", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const avoSignersListDeployment = await deployments.get("AvoSignersList");
      const deployedCode = await ethers.provider.getCode(avoSignersListDeployment.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should revert if avoFactory is set to zero address at deployment", async () => {
      const { deployer } = await getNamedAccounts();

      await expect(
        deployments.deploy("AvoSignersList", {
          from: deployer,
          args: [constants.AddressZero, avoConfigV1.address],
        })
      ).to.be.revertedWith("");
    });

    it("should have avoFactory address set", async () => {
      expect(await avoSignersList.avoFactory()).to.equal(avoFactory.address);
    });

    it("should have trackInStorage flag set", async () => {
      expect(await avoSignersList.trackInStorage()).to.equal(true);
    });
  });

  describe("initial state", async () => {
    it("should start with owner of an Avocado as synced signer", async () => {
      const signersAvocadoMultisig = await avoSignersList.signers(avocadoMultisig.address);
      expect(signersAvocadoMultisig[0]).to.equal(user1.address);

      const signersAvocadoMultisigUser2 = await avoSignersList.signers(avocadoMultisigUser2.address);
      expect(signersAvocadoMultisigUser2[0]).to.equal(user2.address);

      const unusedAddressMultisig = await avoSignersList.signers(user2.address);
      expect(unusedAddressMultisig.length).to.equal(0);
    });

    it("should start with signersCount 1 for an Avocado because of owner", async () => {
      const signersAvocadoMultisig = await avoSignersList.signersCount(avocadoMultisig.address);
      expect(signersAvocadoMultisig.toNumber()).to.equal(1);

      const signersAvocadoMultisigUser2 = await avoSignersList.signersCount(avocadoMultisigUser2.address);
      expect(signersAvocadoMultisigUser2.toNumber()).to.equal(1);

      const unusedAddressMultisig = await avoSignersList.signersCount(user2.address);
      expect(unusedAddressMultisig.toNumber()).to.equal(0);
    });
  });

  describe("view methods", async () => {
    let user1ContractSigners: string[];
    let user2ContractSigners: string[];

    beforeEach(async () => {
      // includes owner because that one is also automatically a signer
      user1ContractSigners = sortAddressesAscending([user2.address, user3.address, user1.address]);
      user2ContractSigners = sortAddressesAscending([user3.address, user2.address]);

      // add multiple signer mappings for user1 multisig
      await testHelpers.executeActions(
        avocadoMultisig,
        user1,
        [
          (
            await avocadoMultisig.populateTransaction.addSigners(
              sortAddressesAscending([user2.address, user3.address]),
              1
            )
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      // add multiple signer mappings for user2 multisig
      await testHelpers.executeActions(
        avocadoMultisigUser2,
        user2,
        [(await avocadoMultisigUser2.populateTransaction.addSigners([user3.address], 1)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );
    });

    describe("isSignerOf", async () => {
      it("should return is signer of a multisig (when signer)", async () => {
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user1.address)).to.equal(true);
      });

      it("should return is signer of a multisig (when not a signer)", async () => {
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, owner.address)).to.equal(false);
      });

      it("should return default value if address is an EOA", async () => {
        expect(await avoSignersList.isSignerOf(user1.address, user1.address)).to.equal(false);
      });

      it("should return default value if address is not an Avocado", async () => {
        expect(await avoSignersList.isSignerOf(avoFactory.address, user1.address)).to.equal(false);
      });
    });

    describe("signers", async () => {
      it("should return all signers for an Avocado", async () => {
        const signersAvocadoMultisig = await avoSignersList.signers(avocadoMultisig.address);
        expect(signersAvocadoMultisig).to.contain(user1ContractSigners[0]);
        expect(signersAvocadoMultisig).to.contain(user1ContractSigners[1]);
        expect(signersAvocadoMultisig).to.contain(user1ContractSigners[2]);

        const signersAvocadoMultisigUser2 = await avoSignersList.signers(avocadoMultisigUser2.address);
        expect(signersAvocadoMultisigUser2).to.contain(user2ContractSigners[0]);
        expect(signersAvocadoMultisigUser2).to.contain(user2ContractSigners[1]);

        const unusedAddressMultisig = await avoSignersList.signers(user2.address);
        expect(unusedAddressMultisig.length).to.equal(0);
      });

      it("should return default value if address is an EOA", async () => {
        expect(await avoSignersList.signers(user1.address)).to.deep.equal([]);
      });

      it("should return default value if address is not an Avocado", async () => {
        expect(await avoSignersList.signers(avoFactory.address)).to.deep.equal([]);
      });
    });

    describe("avocados", async () => {
      it("should return all avocados for a signer", async () => {
        const avocadosUser1 = await avoSignersList.avocados(user1.address);
        expect(avocadosUser1[0]).to.equal(avocadoMultisig.address);

        const avocadosUser2 = await avoSignersList.avocados(user2.address);
        expect(avocadosUser2).to.contain(avocadoMultisig.address);
        expect(avocadosUser2).to.contain(avocadoMultisigUser2.address);

        const avocadosUser3 = await avoSignersList.avocados(user3.address);
        expect(avocadosUser3).to.contain(avocadoMultisig.address);
        expect(avocadosUser3).to.contain(avocadoMultisigUser2.address);

        const unusedAddressMultisig = await avoSignersList.avocados(avocadoMultisig.address);
        expect(unusedAddressMultisig.length).to.equal(0);
      });
    });

    describe("signersCount", async () => {
      it("should return number of signers for an Avocado", async () => {
        const signersAvocadoMultisig = await avoSignersList.signersCount(avocadoMultisig.address);
        expect(signersAvocadoMultisig.toNumber()).to.equal(3);

        const signersAvocadoMultisigUser2 = await avoSignersList.signersCount(avocadoMultisigUser2.address);
        expect(signersAvocadoMultisigUser2.toNumber()).to.equal(2);

        const unusedAddressMultisig = await avoSignersList.signersCount(user2.address);
        expect(unusedAddressMultisig.toNumber()).to.equal(0);
      });

      it("should return default value if address is an EOA", async () => {
        expect(await avoSignersList.signersCount(user1.address)).to.equal(0);
      });

      it("should return default value if address is not an Avocado", async () => {
        expect(await avoSignersList.signersCount(avoFactory.address)).to.equal(0);
      });
    });

    describe("avocadosCount", async () => {
      it("should return number of avocados for a signer", async () => {
        const avocadosUser1 = await avoSignersList.avocadosCount(user1.address);
        expect(avocadosUser1.toNumber()).to.equal(1);

        const avocadosUser2 = await avoSignersList.avocadosCount(user2.address);
        expect(avocadosUser2.toNumber()).to.equal(2);

        const avocadosUser3 = await avoSignersList.avocadosCount(user3.address);
        expect(avocadosUser3.toNumber()).to.equal(2);

        const unusedAddressMultisig = await avoSignersList.avocadosCount(avocadoMultisig.address);
        expect(unusedAddressMultisig.toNumber()).to.equal(0);
      });
    });
  });

  describe("syncAddAvoSignerMappings", async () => {
    it("should syncAddAvoSignerMappings", async () => {
      // syncAvoSignerMapping must be executed through Avocado to have matching data

      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(false);

      // execute addSigners(), must be executed through self-called
      const result = await testHelpers.executeActions(
        avocadoMultisig,
        user1,
        [(await avocadoMultisig.populateTransaction.addSigners([user2.address], 1)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );
      // take gas snapshot to compare gas cost with vs without tracking in storage
      gasCostWithTrackingAdd = (await result.wait()).gasUsed;

      // ensure user2 is now a signer
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(true);
      expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(true);
      expect((await avoSignersList.avocados(user2.address)).includes(avocadoMultisig.address)).to.equal(true);
    });

    it("should syncAddAvoSignerMappings multiple", async () => {
      // syncAvoSignerMapping must be executed through Avocado to have matching data

      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(false);
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user3.address)).to.equal(false);

      // execute addSigners(), must be executed through self-called
      const result = await testHelpers.executeActions(
        avocadoMultisig,
        user1,
        [
          (
            await avocadoMultisig.populateTransaction.addSigners(
              sortAddressesAscending([user2.address, user3.address]),
              1
            )
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );
      // take gas snapshot to compare gas cost with vs without tracking in storage
      gasCostWithTrackingAddMultiple = (await result.wait()).gasUsed;

      // ensure user2 is now a signer
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(true);
      expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(true);
      expect((await avoSignersList.avocados(user2.address)).includes(avocadoMultisig.address)).to.equal(true);
      // ensure user3 is now a signer
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user3.address)).to.equal(true);
      expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user3.address)).to.equal(true);
      expect((await avoSignersList.avocados(user3.address)).includes(avocadoMultisig.address)).to.equal(true);
    });

    it("should emit SignerMappingAdded", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          [(await avocadoMultisig.populateTransaction.addSigners([user2.address], 1)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(5);

      const log = AvoSignersList__factory.createInterface().parseLog(events[2] as any);
      expect(log.name).to.equal("SignerMappingAdded");
      expect(log.args?.signer).to.equal(user2.address);
      expect(log.args?.avocado).to.equal(avocadoMultisig.address);
    });

    it("should revert if avocado is not an Avocado", async () => {
      await expect(avoSignersList.syncAddAvoSignerMappings(user1.address, [user2.address])).to.be.revertedWith(
        "AvoSignersList__InvalidParams()"
      );
    });

    it("should revert if trying to add a signer mapping that is not present at AvocadoMultisig", async () => {
      await expect(
        avoSignersList.syncAddAvoSignerMappings(avocadoMultisig.address, [owner.address])
      ).to.be.revertedWith("AvoSignersList__InvalidParams()");
    });

    it("should revert if trying to add a signer mapping that is not present at AvocadoMultisig (multiple)", async () => {
      await expect(
        avoSignersList.syncAddAvoSignerMappings(avocadoMultisig.address, [owner.address, user1.address])
      ).to.be.revertedWith("AvoSignersList__InvalidParams()");
    });
  });

  describe("syncRemoveAvoSignerMappings", async () => {
    beforeEach(async () => {
      // add mapping
      await testHelpers.executeActions(
        avocadoMultisig,
        user1,
        [
          (
            await avocadoMultisig.populateTransaction.addSigners(
              sortAddressesAscending([user2.address, user3.address]),
              1
            )
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );
    });

    it("should start with user2 mapping present", async () => {
      // ensure user2 is a signer
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(true);
      expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(true);
      expect((await avoSignersList.avocados(user2.address)).includes(avocadoMultisig.address)).to.equal(true);
    });

    it("should start with user3 mapping present", async () => {
      // ensure user3 is a signer
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user3.address)).to.equal(true);
      expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user3.address)).to.equal(true);
      expect((await avoSignersList.avocados(user3.address)).includes(avocadoMultisig.address)).to.equal(true);
    });

    it("should removeSignerMapping", async () => {
      // syncRemoveAvoSignerMappings must be executed through Avocado to have matching data

      // execute removeSigners(), must be executed through self-called
      await testHelpers.executeActions(
        avocadoMultisig,
        user1,
        [(await avocadoMultisig.populateTransaction.removeSigners([user2.address], 1)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      // ensure user2 is now not a signer
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(false);
      expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(false);
      expect((await avoSignersList.avocados(user2.address)).includes(avocadoMultisig.address)).to.equal(false);
    });

    it("should removeSignerMapping multiple", async () => {
      // syncRemoveAvoSignerMappings must be executed through Avocado to have matching data

      // execute removeSigners(), must be executed through self-called
      await testHelpers.executeActions(
        avocadoMultisig,
        user1,
        [
          (
            await avocadoMultisig.populateTransaction.removeSigners(
              sortAddressesAscending([user2.address, user3.address]),
              1
            )
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      // ensure user2 is now not a signer
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(false);
      expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(false);
      expect((await avoSignersList.avocados(user2.address)).includes(avocadoMultisig.address)).to.equal(false);
      // ensure user3 is now not a signer
      expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user3.address)).to.equal(false);
      expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user3.address)).to.equal(false);
      expect((await avoSignersList.avocados(user3.address)).includes(avocadoMultisig.address)).to.equal(false);
    });

    it("should emit SignerMappingRemoved", async () => {
      // execute removeSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          [(await avocadoMultisig.populateTransaction.removeSigners([user2.address], 1)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(4);

      const log = AvoSignersList__factory.createInterface().parseLog(events[1] as any);
      expect(log.name).to.equal("SignerMappingRemoved");
      expect(log.args?.signer).to.equal(user2.address);
      expect(log.args?.avocado).to.equal(avocadoMultisig.address);
    });

    it("should revert if avocado is not an Avocado", async () => {
      await expect(avoSignersList.syncRemoveAvoSignerMappings(user1.address, [user2.address])).to.be.revertedWith(
        "AvoSignersList__InvalidParams()"
      );
    });

    it("should revert if trying to remove a signer mapping that is still present at AvocadoMultisig", async () => {
      await expect(
        avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address])
      ).to.be.revertedWith("AvoSignersList__InvalidParams()");
    });

    it("should revert if trying to remove a signer mapping that is still present at AvocadoMultisig (multiple)", async () => {
      await expect(
        avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address, owner.address])
      ).to.be.revertedWith("AvoSignersList__InvalidParams()");
    });

    context("when Avocado not exist anymore (self-destructed) with previously added mappings", async () => {
      // if Avocado is self-destructed, signers would still be in mappings when contract doesn't actually exist anymore
      // because self-destruct does not trigger the sync
      beforeEach(async () => {
        // deploy MockSelfDestruct contract
        const mockSelfDestructFactory = (await ethers.getContractFactory(
          "MockSelfDestruct",
          user3
        )) as MockSelfDestruct__factory;
        const mockSelfDestruct = await mockSelfDestructFactory.deploy();
        await mockSelfDestruct.deployed();

        const actions: AvocadoMultisigStructs.ActionStruct[] = [
          {
            target: mockSelfDestruct.address,
            data: (await mockSelfDestruct.populateTransaction.selfDestruct(user1.address)).data as any,
            value: 0,
            operation: 1,
          },
        ];

        await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          actions,
          {
            ...TestHelpers.testParams.params,
            actions,
            id: 1,
          },
          undefined,
          undefined,
          undefined,
          undefined,
          ["all"]
        );
      });

      it("should start with avo smart wallet self-destructed", async () => {
        expect(await user1.provider?.getCode(avocadoMultisig.address)).to.equal("0x");
      });

      it("should remove mappings when no code at address", async () => {
        // check user2 is a signer even though avocadoMultisig does not exist anymore
        expect((await avoSignersList.avocados(user2.address)).includes(avocadoMultisig.address)).to.equal(true);
        // check user3 is a signer even though avocadoMultisig does not exist anymore
        expect((await avoSignersList.avocados(user3.address)).includes(avocadoMultisig.address)).to.equal(true);

        await avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address, user3.address]);

        // ensure user2 is now not a signer
        expect((await avoSignersList.avocados(user2.address)).includes(avocadoMultisig.address)).to.equal(false);
        // ensure user3 is now not a signer
        expect((await avoSignersList.avocados(user3.address)).includes(avocadoMultisig.address)).to.equal(false);
      });

      it("should emit SignerMappingRemoved when remove mappings with no code at address", async () => {
        // execute removeSigners(), must be executed through self-called
        const result = await (
          await avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address, user3.address])
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(2);

        const log1 = AvoSignersList__factory.createInterface().parseLog(events[0] as any);
        expect(log1.name).to.equal("SignerMappingRemoved");
        expect(log1.args?.signer).to.equal(user2.address);
        expect(log1.args?.avocado).to.equal(avocadoMultisig.address);

        const log2 = AvoSignersList__factory.createInterface().parseLog(events[1] as any);
        expect(log2.name).to.equal("SignerMappingRemoved");
        expect(log2.args?.signer).to.equal(user3.address);
        expect(log2.args?.avocado).to.equal(avocadoMultisig.address);
      });

      it("should not emit SignerMappingRemoved when remove mappings with no code at address for signer not present", async () => {
        // execute removeSigners(), must be executed through self-called
        const result = await (
          await avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address, owner.address])
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(1);

        const log1 = AvoSignersList__factory.createInterface().parseLog(events[0] as any);
        expect(log1.name).to.equal("SignerMappingRemoved");
        expect(log1.args?.signer).to.equal(user2.address);
        expect(log1.args?.avocado).to.equal(avocadoMultisig.address);
      });

      it("should revert if no mappings are present", async () => {
        // remove mappings
        await avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address, user3.address]);
        // execute removeSigners(), must be executed through self-called
        await expect(
          avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address, user3.address])
        ).to.be.revertedWith("AvoSignersList__InvalidParams");
      });
    });
  });

  context("when trackInStorage=false", async () => {
    beforeEach(async () => {
      await avoConfigV1.setConfig(
        await avoConfigV1.avocadoMultisigConfig(),
        { depositToken: await avoConfigV1.avoDepositManagerConfig() },
        { trackInStorage: false }
      );

      // deploy AvoSignersList with trackInStorage = false
      const avoSignersListNoTracking = await deployments.deploy("AvoSignersList", {
        from: user1.address,
        args: [avoFactory.address, avoConfigV1.address],
      });
      // set this new AvoSignersList contract at proxy
      await avoSignersListProxy.upgradeTo(avoSignersListNoTracking.address);
    });

    it("should start with trackInStorage=false", async () => {
      expect(await avoSignersList.trackInStorage()).to.equal(false);
    });

    describe("view methods", async () => {
      let user1ContractSigners: string[];
      let user2ContractSigners: string[];

      beforeEach(async () => {
        // includes owner because that one is also automatically a signer
        user1ContractSigners = sortAddressesAscending([user2.address, user3.address, user1.address]);
        user2ContractSigners = sortAddressesAscending([user3.address, user2.address]);

        // add multiple signer mappings for user1 multisig
        await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          [
            (
              await avocadoMultisig.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                1
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        );

        // add multiple signer mappings for user2 multisig
        await testHelpers.executeActions(
          avocadoMultisigUser2,
          user2,
          [(await avocadoMultisigUser2.populateTransaction.addSigners([user3.address], 1)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        );
      });

      describe("isSignerOf", async () => {
        it("should return is signer of a multisig (when signer)", async () => {
          expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user1.address)).to.equal(true);
        });

        it("should return is signer of a multisig (when not a signer)", async () => {
          expect(await avoSignersList.isSignerOf(avocadoMultisig.address, owner.address)).to.equal(false);
        });

        it("should return default value if address is an EOA", async () => {
          expect(await avoSignersList.isSignerOf(user1.address, user1.address)).to.equal(false);
        });

        it("should return default value if address is not an Avocado", async () => {
          expect(await avoSignersList.isSignerOf(avoFactory.address, user1.address)).to.equal(false);
        });
      });

      describe("signers", async () => {
        it("should return all signers for an Avocado", async () => {
          const signersAvocadoMultisig = await avoSignersList.signers(avocadoMultisig.address);
          expect(signersAvocadoMultisig).to.contain(user1ContractSigners[0]);
          expect(signersAvocadoMultisig).to.contain(user1ContractSigners[1]);
          expect(signersAvocadoMultisig).to.contain(user1ContractSigners[2]);

          const signersAvocadoMultisigUser2 = await avoSignersList.signers(avocadoMultisigUser2.address);
          expect(signersAvocadoMultisigUser2).to.contain(user2ContractSigners[0]);
          expect(signersAvocadoMultisigUser2).to.contain(user2ContractSigners[1]);

          const unusedAddressMultisig = await avoSignersList.signers(user2.address);
          expect(unusedAddressMultisig.length).to.equal(0);
        });

        it("should return default value if address is an EOA", async () => {
          expect(await avoSignersList.signers(user1.address)).to.deep.equal([]);
        });

        it("should return default value if address is not an Avocado", async () => {
          expect(await avoSignersList.signers(avoFactory.address)).to.deep.equal([]);
        });
      });

      describe("avocados", async () => {
        it("should revert with AvoSignersList__NotTracked()", async () => {
          await expect(avoSignersList.avocados(user1.address)).to.be.revertedWith("AvoSignersList__NotTracked()");
          await expect(avoSignersList.avocados(user2.address)).to.be.revertedWith("AvoSignersList__NotTracked()");
          await expect(avoSignersList.avocados(avocadoMultisig.address)).to.be.revertedWith(
            "AvoSignersList__NotTracked()"
          );
        });
      });

      describe("signersCount", async () => {
        it("should return number of signers for an Avocado", async () => {
          const signersAvocadoMultisig = await avoSignersList.signersCount(avocadoMultisig.address);
          expect(signersAvocadoMultisig.toNumber()).to.equal(3);

          const signersAvocadoMultisigUser2 = await avoSignersList.signersCount(avocadoMultisigUser2.address);
          expect(signersAvocadoMultisigUser2.toNumber()).to.equal(2);

          const unusedAddressMultisig = await avoSignersList.signersCount(user2.address);
          expect(unusedAddressMultisig.toNumber()).to.equal(0);
        });

        it("should return default value if address is an EOA", async () => {
          expect(await avoSignersList.signersCount(user1.address)).to.equal(0);
        });

        it("should return default value if address is not an Avocado", async () => {
          expect(await avoSignersList.signersCount(avoFactory.address)).to.equal(0);
        });
      });

      describe("avocadosCount", async () => {
        it("should revert with AvoSignersList__NotTracked()", async () => {
          await expect(avoSignersList.avocadosCount(user1.address)).to.be.revertedWith("AvoSignersList__NotTracked()");
          await expect(avoSignersList.avocadosCount(user2.address)).to.be.revertedWith("AvoSignersList__NotTracked()");
          await expect(avoSignersList.avocadosCount(avocadoMultisig.address)).to.be.revertedWith(
            "AvoSignersList__NotTracked()"
          );
        });
      });
    });

    describe("syncAddAvoSignerMappings", async () => {
      it("should syncAddAvoSignerMappings: should not track in storage", async () => {
        // syncAvoSignerMapping must be executed through Avocado to have matching data

        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(false);

        // execute addSigners(), must be executed through self-called
        const result = await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          [(await avocadoMultisig.populateTransaction.addSigners([user2.address], 1)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        );
        // take gas snapshot to compare gas cost with vs without tracking in storage
        const gasCost = (await result.wait()).gasUsed;
        // not the ideal test to make sure storage is not updated but simple and should suffice
        // EnumerableSet.add should cost at least 45k gas: depends on array length value being set
        // (67k if no values yet, 50k for first update in a tx, 45k for all subsequent updates)
        // 67k if a signer address did not have any Multisigs assigned yet (0 -> value)
        expect(gasCostWithTrackingAdd.sub(gasCost).toNumber()).to.be.greaterThan(45000);

        // ensure user2 is now a signer (tx worked)
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(true);
        expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(true);
      });

      it("should syncAddAvoSignerMappings multiple: should not track in storage", async () => {
        // syncAvoSignerMapping must be executed through Avocado to have matching data

        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(false);
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user3.address)).to.equal(false);

        // execute addSigners(), must be executed through self-called
        const result = await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          [
            (
              await avocadoMultisig.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                1
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        );
        // take gas snapshot to compare gas cost with vs without tracking in storage
        const gasCost = (await result.wait()).gasUsed;
        // not the ideal test to make sure storage is not updated but simple and should suffice
        // EnumerableSet.add should cost at least 45k gas: depends on array length value being set
        // (67k if no values yet, 50k for first update in a tx, 45k for all subsequent updates)
        // 67k if a signer address did not have any Multisigs assigned yet (0 -> value)
        expect(gasCostWithTrackingAddMultiple.sub(gasCost).toNumber()).to.be.greaterThan(90000);

        // ensure user2 is now a signer
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(true);
        expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(true);
        // ensure user3 is now a signer
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user3.address)).to.equal(true);
        expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user3.address)).to.equal(true);
      });

      it("should emit SignerMappingAdded", async () => {
        // execute addSigners(), must be executed through self-called
        const result = await (
          await testHelpers.executeActions(
            avocadoMultisig,
            user1,
            [(await avocadoMultisig.populateTransaction.addSigners([user2.address], 1)).data as string],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            ["signersCount", "_signersPointer"]
          )
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(5);

        const log = AvoSignersList__factory.createInterface().parseLog(events[2] as any);
        expect(log.name).to.equal("SignerMappingAdded");
        expect(log.args?.signer).to.equal(user2.address);
        expect(log.args?.avocado).to.equal(avocadoMultisig.address);
      });

      it("should revert if avocado is not an Avocado (EOA)", async () => {
        await expect(avoSignersList.syncAddAvoSignerMappings(user1.address, [user2.address])).to.be.revertedWith(
          "AvoSignersList__InvalidParams()"
        );
      });

      it("should revert if avocado is not an Avocado (contract)", async () => {
        await expect(avoSignersList.syncAddAvoSignerMappings(avoFactory.address, [user2.address])).to.be.revertedWith(
          "AvoSignersList__InvalidParams()"
        );
      });

      it("should revert if trying to add a signer mapping that is not present at AvocadoMultisig", async () => {
        await expect(
          avoSignersList.syncAddAvoSignerMappings(avocadoMultisig.address, [owner.address])
        ).to.be.revertedWith("AvoSignersList__InvalidParams()");
      });

      it("should revert if trying to add a signer mapping that is not present at AvocadoMultisig (multiple)", async () => {
        await expect(
          avoSignersList.syncAddAvoSignerMappings(avocadoMultisig.address, [owner.address, user1.address])
        ).to.be.revertedWith("AvoSignersList__InvalidParams()");
      });
    });

    describe("syncRemoveAvoSignerMappings", async () => {
      beforeEach(async () => {
        // add mapping
        await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          [
            (
              await avocadoMultisig.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                1
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        );
      });

      it("should start with user2 mapping present", async () => {
        // ensure user2 is a signer
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(true);
        expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(true);
      });

      it("should start with user3 mapping present", async () => {
        // ensure user3 is a signer
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user3.address)).to.equal(true);
        expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user3.address)).to.equal(true);
      });

      it("should removeSignerMapping", async () => {
        // syncRemoveAvoSignerMappings must be executed through Avocado to have matching data

        // execute removeSigners(), must be executed through self-called
        await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          [(await avocadoMultisig.populateTransaction.removeSigners([user2.address], 1)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        );

        // testing that storage has not been tried to be updated is not easily possible but is confirmed somewhat
        // implicitly via the event SignerMappingRemoved being emitted below. EnumerableSet.remove would return false
        // and the event would not be emitted

        // ensure user2 is now not a signer
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(false);
        expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(false);
      });

      it("should removeSignerMapping multiple", async () => {
        // syncRemoveAvoSignerMappings must be executed through Avocado to have matching data

        // execute removeSigners(), must be executed through self-called
        await testHelpers.executeActions(
          avocadoMultisig,
          user1,
          [
            (
              await avocadoMultisig.populateTransaction.removeSigners(
                sortAddressesAscending([user2.address, user3.address]),
                1
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        );

        // testing that storage has not been tried to be updated is not easily possible but is confirmed somewhat
        // implicitly via the event SignerMappingRemoved being emitted below. EnumerableSet.remove would return false
        // and the event would not be emitted

        // ensure user2 is now not a signer
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user2.address)).to.equal(false);
        expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user2.address)).to.equal(false);
        // ensure user3 is now not a signer
        expect(await avoSignersList.isSignerOf(avocadoMultisig.address, user3.address)).to.equal(false);
        expect((await avoSignersList.signers(avocadoMultisig.address)).includes(user3.address)).to.equal(false);
      });

      it("should emit SignerMappingRemoved", async () => {
        // execute removeSigners(), must be executed through self-called
        const result = await (
          await testHelpers.executeActions(
            avocadoMultisig,
            user1,
            [(await avocadoMultisig.populateTransaction.removeSigners([user2.address], 1)).data as string],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            ["signersCount", "_signersPointer"]
          )
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(4);

        const log = AvoSignersList__factory.createInterface().parseLog(events[1] as any);
        expect(log.name).to.equal("SignerMappingRemoved");
        expect(log.args?.signer).to.equal(user2.address);
        expect(log.args?.avocado).to.equal(avocadoMultisig.address);
      });

      it("should revert if avocado is not an Avocado (EOA)", async () => {
        await expect(avoSignersList.syncRemoveAvoSignerMappings(user1.address, [user2.address])).to.be.revertedWith(
          "AvoSignersList__InvalidParams()"
        );
      });

      it("should revert if avocado is not an Avocado (contract)", async () => {
        await expect(
          avoSignersList.syncRemoveAvoSignerMappings(avoFactory.address, [user2.address])
        ).to.be.revertedWith("AvoSignersList__InvalidParams()");
      });

      it("should revert if trying to remove a signer mapping that is still present at AvocadoMultisig", async () => {
        await expect(
          avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address])
        ).to.be.revertedWith("AvoSignersList__InvalidParams()");
      });

      it("should revert if trying to remove a signer mapping that is still present at AvocadoMultisig (multiple)", async () => {
        await expect(
          avoSignersList.syncRemoveAvoSignerMappings(avocadoMultisig.address, [user2.address, owner.address])
        ).to.be.revertedWith("AvoSignersList__InvalidParams()");
      });
    });
  });
});
