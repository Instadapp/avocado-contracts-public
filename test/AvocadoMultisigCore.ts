import { deployments, ethers, getNamedAccounts, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, constants, ContractReceipt, Event } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  hexlify,
  parseEther,
  solidityKeccak256,
  toUtf8Bytes,
  BytesLike,
  formatBytes32String,
  hexConcat,
} from "ethers/lib/utils";

import {
  AvoFactory,
  AvoFactory__factory,
  AvoForwarder,
  AvoRegistry,
  IAvoFactory,
  MockDeposit__factory,
  MockERC20Token__factory,
  MockWETH,
  MockWETH__factory,
  MockERC721Token__factory,
  MockSigner__factory,
  MockSigner,
  IAvocadoMultisigV1,
  AvocadoMultisig,
  AvocadoMultisig__factory,
  AvoSignersList,
  MockFailingFeeCollector__factory,
  MockSignerArbitrarySigLength__factory,
  MockDelegateCallTargetMultisig,
  MockDelegateCallTargetMultisig__factory,
  MockInvalidRegistryCalcFeeInvalidAddress__factory,
  MockInvalidRegistryCalcFeeTooLong__factory,
  MockInvalidRegistryCalcFeeTooShort__factory,
  MockInvalidRegistryCalcFeeAbuseGas__factory,
  MockErrorThrower,
  MockErrorThrower__factory,
  MockAvocadoMultisigWithUpgradeHook,
  MockAvocadoMultisigWithUpgradeHook__factory,
  AvoConfigV1,
  AvocadoMultisigSecondary,
  AvoConfigV1__factory,
} from "../typechain-types";
import { expect, sortAddressesAscending } from "./util";
import {
  castEventPosFromLastForAuthorized,
  castEventPosFromLastForSigned,
  defaultAuthorizedMaxFee,
  defaultAuthorizedMinFee,
  EIP1271MagicValue,
  SkipAfterChecks,
  SkipBeforeChecks,
  TestHelpers,
} from "./TestHelpers";
import { AvocadoMultisigStructs } from "../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";

export function avoWalletMultisigSharedTests(
  testSetup: () => Promise<{
    testHelpers: TestHelpers;
    avoContract: AvocadoMultisig & IAvocadoMultisigV1;
    avoFactory: IAvoFactory & AvoFactory;
    avoForwarder: AvoForwarder;
    avoRegistry: AvoRegistry;
    avoLogicContract: AvocadoMultisig;
    avoSecondary: AvocadoMultisigSecondary;
    avoSignersList: AvoSignersList;
    avoConfigV1: AvoConfigV1;
    owner: SignerWithAddress;
    user1: SignerWithAddress;
    user2: SignerWithAddress;
    user3: SignerWithAddress;
    broadcaster: SignerWithAddress;
    dEaDSigner: SignerWithAddress;
    backupFeeCollector: SignerWithAddress;
    defaultTestSignature: string;
  }>
) {
  let avoContract: AvocadoMultisig & IAvocadoMultisigV1;
  let avoFactory: IAvoFactory & AvoFactory;
  let avoForwarder: AvoForwarder;
  let avoRegistry: AvoRegistry;
  let avoLogicContract: AvocadoMultisig;
  let avoSecondary: AvocadoMultisigSecondary;
  let avoSignersList: AvoSignersList;
  let avoConfigV1: AvoConfigV1;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let broadcaster: SignerWithAddress;
  let dEaDSigner: SignerWithAddress;
  let backupFeeCollector: SignerWithAddress;
  let defaultTestSignature: string;

  let testHelpers: TestHelpers;

  beforeEach(async () => {
    ({
      avoContract,
      avoFactory,
      avoForwarder,
      avoRegistry,
      avoLogicContract,
      avoSecondary,
      avoSignersList,
      avoConfigV1,
      owner,
      user1,
      user2,
      user3,
      broadcaster,
      dEaDSigner,
      backupFeeCollector,
      defaultTestSignature,
      testHelpers,
    } = await testSetup());
  });

  context(`____________TESTS for AvocadoMultisig_____________`, async () => {
    describe("deployment", async () => {
      it("should deploy avocado", async () => {
        // already deployed for user1 through hardhat-deploy script, just look if it worked
        const deployedCode = await ethers.provider.getCode(avoContract.address);
        expect(deployedCode).to.not.equal("");
        expect(deployedCode).to.not.equal("0x");
      });

      it("should have constants set", async () => {
        expect(await avoContract.DOMAIN_SEPARATOR_NAME()).to.equal(testHelpers.domainSeparatorName);
        expect(await avoContract.DOMAIN_SEPARATOR_VERSION()).to.equal(testHelpers.domainSeparatorVersion);
        expect(await avoContract.DEFAULT_CHAIN_ID()).to.equal(TestHelpers.defaultChainId);
        expect(await avoContract.TYPE_HASH()).to.equal(
          "0xd87cd6ef79d4e2b95e15ce8abf732db51ec771f1ca2edccf22a46c729ac56472"
        );
        expect(await avoContract.CAST_TYPE_HASH()).to.equal(
          "0xe74ed9f75082a9594f22af0e866100073e626e818daffa7c892b007cd81bdf3b"
        );
        expect(await avoContract.ACTION_TYPE_HASH()).to.equal(
          "0x5c1c53221914feac61859607db2bf67fc5d2d108016fd0bab7ceb23e65e90f65"
        );
        expect(await avoContract.CAST_PARAMS_TYPE_HASH()).to.equal(
          "0xdc7eeb8956fa99ee1655bf2f897041e2392df70038b7ac74190fa437c58cfc47"
        );
        expect(await avoContract.CAST_FORWARD_PARAMS_TYPE_HASH()).to.equal(
          "0x222df8c7761e6301d3e65134b6db7ac2b975814601340cc8d4c6bd6bc4742f9e"
        );
        expect(await avoContract.CAST_AUTHORIZED_TYPE_HASH()).to.equal(
          "0x1a7f20cd17edb78769659fdd929cc47ea75b683f7b24e7933f7fa66c44ad88c0"
        );
        expect(await avoContract.CAST_AUTHORIZED_PARAMS_TYPE_HASH()).to.equal(
          "0x195ee08d2ba047c23da55fd07e3530ac91de13e8b3f1a46d6e18d4ab2f4177eb"
        );
        expect(await avoContract.CAST_CHAIN_AGNOSTIC_TYPE_HASH()).to.equal(
          "0xb7c77dbcd01eff35f637803daf7abe3f0e3b86b5102459be5665dc7d9a85ac5e"
        );
        expect(await avoContract.CAST_CHAIN_AGNOSTIC_PARAMS_TYPE_HASH()).to.equal(
          "0xc84a2c176321157bd55b70feb5871c4304d99c870656d2fc420998eff645e207"
        );
        expect((await avoContract.AUTHORIZED_MIN_FEE()).eq(defaultAuthorizedMinFee)).to.equal(true);
        expect((await avoContract.AUTHORIZED_MAX_FEE()).eq(defaultAuthorizedMaxFee)).to.equal(true);
        expect(await avoContract.AUTHORIZED_FEE_COLLECTOR()).to.equal(backupFeeCollector.address);
      });

      it("should revert if avoRegistry is set to zero address at deployment", async () => {
        const { deployer } = await getNamedAccounts();

        await expect(
          testHelpers.deployAvocadoMultisigContract(
            deployer,
            constants.AddressZero,
            avoForwarder.address,
            avoConfigV1,
            avoSignersList.address,
            avoSecondary.address
          )
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoForwarder is set to zero address at deployment", async () => {
        const { deployer } = await getNamedAccounts();

        await expect(
          testHelpers.deployAvocadoMultisigContract(
            deployer,
            avoRegistry.address,
            constants.AddressZero,
            avoConfigV1,
            avoSignersList.address,
            avoSecondary.address
          )
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoConfig is set to zero address at deployment", async () => {
        const { deployer } = await getNamedAccounts();

        avoConfigV1 = AvoConfigV1__factory.connect(constants.AddressZero, user1);

        await expect(
          testHelpers.deployAvocadoMultisigContract(
            deployer,
            avoRegistry.address,
            avoForwarder.address,
            avoConfigV1,
            avoSignersList.address,
            avoSecondary.address
          )
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoSignersList is set to zero address at deployment", async () => {
        const { deployer } = await getNamedAccounts();

        await expect(
          testHelpers.deployAvocadoMultisigContract(
            deployer,
            avoRegistry.address,
            avoForwarder.address,
            avoConfigV1,
            constants.AddressZero,
            avoSecondary.address
          )
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoSecondary is set to zero address at deployment", async () => {
        const { deployer } = await getNamedAccounts();

        await expect(
          testHelpers.deployAvocadoMultisigContract(
            deployer,
            avoRegistry.address,
            avoForwarder.address,
            avoConfigV1,
            avoSignersList.address,
            constants.AddressZero
          )
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should have avoRegistry address set", async () => {
        expect(await avoContract.avoRegistry()).to.equal(avoRegistry.address);
      });

      it("should have avoForwarder address set", async () => {
        expect(await avoContract.avoForwarder()).to.equal(avoForwarder.address);
      });

      it("should have avoSignersList address set", async () => {
        expect(await avoContract.avoSignersList()).to.equal(avoSignersList.address);
      });

      it("should have avoSecondary address set", async () => {
        expect(await avoContract.avoSecondary()).to.equal(avoSecondary.address);
      });

      it("should have initializer disabled on logic contract", async () => {
        // try to initialize, should fail because disabled
        await expect((avoLogicContract as AvocadoMultisig).initialize()).to.be.revertedWith(
          "Initializable: contract is already initialized"
        );
      });

      it("should revert if avoSecondary immutable avoRegistry differs", async () => {
        const { deployer } = await getNamedAccounts();

        const newAvoSecondary = await testHelpers.deployAvocadoMultisigSecondaryContract(
          deployer,
          avoForwarder.address,
          avoForwarder.address,
          avoConfigV1,
          avoSignersList.address
        );

        await expect(
          testHelpers.deployAvocadoMultisigContract(
            deployer,
            avoRegistry.address,
            avoForwarder.address,
            avoConfigV1,
            avoSignersList.address,
            newAvoSecondary.address
          )
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoSecondary immutable avoForwarder differs", async () => {
        const { deployer } = await getNamedAccounts();

        const newAvoSecondary = await testHelpers.deployAvocadoMultisigSecondaryContract(
          deployer,
          avoRegistry.address,
          avoRegistry.address,
          avoConfigV1,
          avoSignersList.address
        );

        await expect(
          testHelpers.deployAvocadoMultisigContract(
            deployer,
            avoRegistry.address,
            avoForwarder.address,
            avoConfigV1,
            avoSignersList.address,
            newAvoSecondary.address
          )
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoSecondary immutable avoSignersList differs", async () => {
        const { deployer } = await getNamedAccounts();

        const newAvoSecondary = await testHelpers.deployAvocadoMultisigSecondaryContract(
          deployer,
          avoRegistry.address,
          avoForwarder.address,
          avoConfigV1,
          avoForwarder.address
        );

        await expect(
          testHelpers.deployAvocadoMultisigContract(
            deployer,
            avoRegistry.address,
            avoForwarder.address,
            avoConfigV1,
            avoSignersList.address,
            newAvoSecondary.address
          )
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoSecondary immutable AUTHORIZED_MIN_FEE differs", async () => {
        const { deployer } = await getNamedAccounts();

        // change config after avoSecondary was deployed already
        await avoConfigV1.setConfig(
          {
            authorizedMinFee: 4237856,
            authorizedMaxFee: defaultAuthorizedMaxFee,
            authorizedFeeCollector: backupFeeCollector.address,
          },
          { depositToken: await avoConfigV1.avoDepositManagerConfig() },
          { trackInStorage: await avoConfigV1.avoSignersListConfig() }
        );

        await expect(
          deployments.deploy("AvocadoMultisig", {
            from: deployer,
            args: [
              avoRegistry.address,
              avoForwarder.address,
              avoSignersList.address,
              avoConfigV1.address,
              avoSecondary.address,
            ],
          })
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoSecondary immutable AUTHORIZED_MAX_FEE differs", async () => {
        const { deployer } = await getNamedAccounts();

        // change config after avoSecondary was deployed already
        await avoConfigV1.setConfig(
          {
            authorizedMinFee: defaultAuthorizedMinFee,
            authorizedMaxFee: 4237856,
            authorizedFeeCollector: backupFeeCollector.address,
          },
          { depositToken: await avoConfigV1.avoDepositManagerConfig() },
          { trackInStorage: await avoConfigV1.avoSignersListConfig() }
        );

        await expect(
          deployments.deploy("AvocadoMultisig", {
            from: deployer,
            args: [
              avoRegistry.address,
              avoForwarder.address,
              avoSignersList.address,
              avoConfigV1.address,
              avoSecondary.address,
            ],
          })
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if avoSecondary immutable AUTHORIZED_FEE_COLLECTOR differs", async () => {
        const { deployer } = await getNamedAccounts();

        // change config after avoSecondary was deployed already
        await avoConfigV1.setConfig(
          {
            authorizedMinFee: defaultAuthorizedMinFee,
            authorizedMaxFee: defaultAuthorizedMaxFee,
            authorizedFeeCollector: avoForwarder.address,
          },
          { depositToken: await avoConfigV1.avoDepositManagerConfig() },
          { trackInStorage: await avoConfigV1.avoSignersListConfig() }
        );

        await expect(
          deployments.deploy("AvocadoMultisig", {
            from: deployer,
            args: [
              avoRegistry.address,
              avoForwarder.address,
              avoSignersList.address,
              avoConfigV1.address,
              avoSecondary.address,
            ],
          })
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });
    });

    describe("initialize", async () => {
      it("should revert if already initialized", async () => {
        await expect((avoLogicContract as AvocadoMultisig).initialize()).to.be.revertedWith(
          "Initializable: contract is already initialized"
        );
      });

      it("should set owner at proxy as immutable)", async () => {
        expect(await avoContract.owner()).to.equal(user1.address);
      });

      it("should set index at proxy as immutable", async () => {
        // deploy another multisig with index != 0 to test properly
        await avoFactory.deploy(owner.address, 3);
        const expectedAddress = await avoFactory.computeAvocado(owner.address, 3);

        // connect to AvocadoMultisig with user1, already deployed locally through hardhat-deploy script
        const avocadoMultisigWithIndex = AvocadoMultisig__factory.connect(expectedAddress, owner) as AvocadoMultisig &
          IAvocadoMultisigV1;

        expect(await avocadoMultisigWithIndex.index()).to.equal(3);
      });

      it("should set initial transient storage slot value to set up refund behavior", async () => {
        // transient storage is in slot 54
        const transientStorageSlot = (await owner.provider?.getStorageAt(avoContract.address, "0x36")) as string;
        expect(transientStorageSlot).to.equal(ethers.constants.HashZero.slice(0, -1) + "1");
      });
    });

    describe("onERC721Received", async () => {
      it("should be able to receive NFT via safeTransferFrom", async () => {
        // deploy mock NFT token
        const mockERC721TokenFactory = (await ethers.getContractFactory(
          "MockERC721Token",
          owner
        )) as MockERC721Token__factory;
        const mockERC721Token = await mockERC721TokenFactory.deploy("MockERC721Token", "MOCK");
        await mockERC721Token.deployed();

        // deposit from owner into Avo contract
        const result = await (
          await mockERC721Token["safeTransferFrom(address,address,uint256)"].call(
            mockERC721Token.address,
            owner.address,
            avoContract.address,
            1
          )
        ).wait();

        const events = result.events as Event[];
        expect(events[0].event).to.equal("Transfer");
        expect(events[0].args?.from).to.equal(owner.address);
        expect(events[0].args?.to).to.equal(avoContract.address);
        expect((events[0].args?.tokenId).toNumber()).to.equal(1);

        expect(await mockERC721Token.ownerOf(1)).to.equal(avoContract.address);
      });
    });

    describe("_callTargets", async () => {
      it("should revert if not called through cast when status is verified (or by 0x0000...dEaD)", async () => {
        await expect(avoContract._callTargets([], 0)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
      });

      it("should execute if called by address 0x0000...dEaD", async () => {
        const result = await (await avoContract.connect(dEaDSigner)._callTargets([], 0)).wait();

        expect(result.transactionHash).to.not.equal("");
        expect(result.transactionHash).to.not.equal("0x");
      });

      // other functionality is tested through broad `cast()` and `castAuthorized()` tests below
    });

    describe("executeOperation", async () => {
      it("should revert if called directly", async () => {
        await expect(
          avoContract.executeOperation([], [], [], ethers.constants.AddressZero, toUtf8Bytes(""))
        ).to.be.revertedWith("AvocadoMultisig__Unauthorized");
      });

      it("should revert if called directly #2", async () => {
        await expect(
          avoContract.executeOperation([], [], [], user1.address, toUtf8Bytes("someTestData"))
        ).to.be.revertedWith("AvocadoMultisig__Unauthorized");
      });

      it("should correctly authorize", async () => {
        await time.setNextBlockTimestamp(2685794545);
        // set _transientAllowHash to the correct value of data encoded with
        // bytes31(keccak256(abi.encode(data_, block.timestamp, EXECUTE_OPERATION_SELECTOR));
        // _transientAllowHash is first 31 bytes in slot 54.

        // result of encoding for this test data with input as in executeOperation call below:
        // 0x9ff700f84a3961a38f62e21eeba21054657961df9c548cb462821769d50913

        await network.provider.send("hardhat_setStorageAt", [
          avoContract.address,
          "0x36", // = storage slot 54 in hex
          "0x009ff700f84a3961a38f62e21eeba21054657961df9c548cb462821769d50913",
        ]);

        await time.setNextBlockTimestamp(2685794545);
        // correct transientAllowHash, BUT INCORRECT initiator -> should revert
        await expect(
          avoContract.executeOperation([], [], [], user1.address, toUtf8Bytes("someTestData"))
        ).to.be.revertedWith("AvocadoMultisig__Unauthorized");

        await time.setNextBlockTimestamp(2685794546);
        // wrong transientAllowHash (changed timestamp), correct initiator -> should revert
        await expect(
          avoContract.executeOperation([], [], [], avoContract.address, toUtf8Bytes("someTestData"))
        ).to.be.revertedWith("AvocadoMultisig__Unauthorized");

        await time.setNextBlockTimestamp(2685794546);
        // wrong transientAllowHash (changed timestamp), wrong initiator -> should revert
        await expect(
          avoContract.executeOperation([], [], [], user1.address, toUtf8Bytes("someTestData"))
        ).to.be.revertedWith("AvocadoMultisig__Unauthorized");

        await time.setNextBlockTimestamp(2685794545);
        // correct transientAllowHash, correct initiator -> should NOT revert
        await expect(
          avoContract.executeOperation([], [], [], avoContract.address, toUtf8Bytes("someTestData"))
        ).to.not.be.revertedWith("AvocadoMultisig__Unauthorized");
      });

      // other functionality is tested through `[...].flashloan.test` tests
    });

    describe("getSigDigest", async () => {
      it("should build correct sig digest hash", async () => {
        const contractDigest = await avoContract.getSigDigest(
          TestHelpers.testParams.params,
          TestHelpers.testParams.forwardParams
        );

        const digest = await testHelpers.getSigDigest(avoContract, user1);

        expect(contractDigest).to.equal(digest);
      });

      it("should build correct sig digest hash for non-sequential nonce", async () => {
        const contractDigest = await avoContract.getSigDigest(
          TestHelpers.nonSequentialTestParams.params,
          TestHelpers.nonSequentialTestParams.forwardParams
        );

        const digest = await testHelpers.getSigDigest(
          avoContract,
          user1,
          TestHelpers.nonSequentialTestParams.params,
          TestHelpers.nonSequentialTestParams.forwardParams
        );

        expect(contractDigest).to.equal(digest);
      });
    });

    describe("upgradability", async () => {
      let newLogicContract: string;

      beforeEach(async () => {
        const registry = await deployments.get("AvoRegistryProxy");
        const forwarder = await deployments.get("AvoForwarderProxy");

        // deploy another logic contract
        newLogicContract = (
          await testHelpers.deployAvocadoMultisigContract(
            owner.address,
            registry.address,
            forwarder.address,
            avoConfigV1,
            avoSignersList.address,
            avoSecondary.address
          )
        ).address;

        // set it as valid version in registry
        await avoRegistry.setAvoVersion(newLogicContract, true, true);
      });

      describe("upgradeTo", async () => {
        it("should upgradeTo by self-called contract", async () => {
          const nonceBefore = await avoContract.avoNonce();

          const avoImplBefore = await testHelpers.readAvoImplAddress(avoContract.address);

          expect(avoImplBefore).to.equal(avoLogicContract.address.toLowerCase());

          // execute upgradeTo(), must be executed through self-called
          await testHelpers.executeActions(
            avoContract,
            user1,
            [(await avoContract.populateTransaction.upgradeTo(newLogicContract, toUtf8Bytes(""))).data as string],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            ["_avoImpl"]
          );

          const avoImplAfter = await testHelpers.readAvoImplAddress(avoContract.address);

          // make sure the avoWalletImpl address has changed
          expect(avoImplBefore).to.not.equal(avoImplAfter);
          expect(avoImplAfter).to.equal(newLogicContract.toLowerCase());
          // make sure other values have not changed (to ensure storage slots were not messed up)
          expect((await avoContract.avoNonce()).eq(nonceBefore.add(1))).to.equal(true);
        });

        it("should emit event Upgraded", async () => {
          // execute upgradeTo(), must be executed through self-called
          const result = await (
            await testHelpers.executeActions(
              avoContract,
              user1,
              [(await avoContract.populateTransaction.upgradeTo(newLogicContract, toUtf8Bytes(""))).data as string],
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              ["_avoImpl"]
            )
          ).wait();

          const events = result.events as Event[];
          expect(events.length).to.be.greaterThanOrEqual(2);

          expect(events[0].event).to.equal("Upgraded");
          expect(events[0].args?.newImplementation).to.equal(newLogicContract);
        });

        it("should directly return if being upgraded to already set implementation", async () => {
          // execute upgradeTo(), must be executed through self-called
          const result = await (
            await testHelpers.executeActions(avoContract, user1, [
              (
                await avoContract.populateTransaction.upgradeTo(avoLogicContract.address, toUtf8Bytes(""))
              ).data as string,
            ])
          ).wait();

          const events = result.events as Event[];
          // CastExecuted and FeePaid, no other events
          expect(events.length).to.equal(2);

          expect(events[0].event).to.not.equal("Upgraded");
        });

        it("should revert if not self-called", async () => {
          await expect(avoContract.upgradeTo(avoFactory.address, toUtf8Bytes(""))).to.be.revertedWith(
            "AvocadoMultisig__Unauthorized"
          );
        });
      });

      it("should revert if upgrade is not self-called", async () => {
        await expect(avoContract.upgradeTo(avoFactory.address, toUtf8Bytes(""))).to.be.revertedWith(
          "AvocadoMultisig__Unauthorized"
        );
      });

      describe("_afterUpgradeHook", async () => {
        let mockAvoContractWithUpgradeHook: MockAvocadoMultisigWithUpgradeHook;

        const deployMockWithUpgradeHook = async (modeRevert: boolean) => {
          // deploy Mock contract with event in afterUpgradeHook
          const mockAvoContractWithUpgradeHookFactory = (await ethers.getContractFactory(
            "MockAvocadoMultisigWithUpgradeHook",
            user3
          )) as MockAvocadoMultisigWithUpgradeHook__factory;
          mockAvoContractWithUpgradeHook = (await mockAvoContractWithUpgradeHookFactory.deploy(
            avoRegistry.address,
            avoForwarder.address,
            avoSignersList.address,
            avoConfigV1.address,
            modeRevert,
            avoSecondary.address
          )) as MockAvocadoMultisigWithUpgradeHook;

          await mockAvoContractWithUpgradeHook.deployed();

          // set it as valid version in registry

          await avoRegistry.setAvoVersion(mockAvoContractWithUpgradeHook.address, true, true);
        };

        it("should call _afterUpgradeHook", async () => {
          await deployMockWithUpgradeHook(false);

          const avoImplBefore = await testHelpers.readAvoImplAddress(avoContract.address);
          expect(avoImplBefore).to.equal(avoLogicContract.address.toLowerCase());

          const testDataBytes_ = toUtf8Bytes("testBytes");

          // execute upgradeTo(), must be executed through self-called
          const result = await (
            await testHelpers.executeActions(
              avoContract,
              user1,
              [
                (
                  await avoContract.populateTransaction.upgradeTo(
                    mockAvoContractWithUpgradeHook.address,
                    testDataBytes_
                  )
                ).data as string,
              ],
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              ["_avoImpl"]
            )
          ).wait();

          const events = result.events as Event[];
          expect(events.length).to.equal(4);

          expect(events[0].event).to.equal("Upgraded");
          expect(events[0].args?.newImplementation).to.equal(mockAvoContractWithUpgradeHook.address);

          let mockDelegateCallTargetIface = new ethers.utils.Interface(MockAvocadoMultisigWithUpgradeHook__factory.abi);
          const mockEvent = mockDelegateCallTargetIface.parseLog(events[1]);

          expect(mockEvent.name).to.equal("MockAfterUpgradeHook");
          expect(mockEvent.args?.fromImplementation.toLowerCase()).to.equal(avoLogicContract.address.toLowerCase());
          expect(mockEvent.args?.data).to.equal(hexlify(testDataBytes_));

          const avoImplAfter = await testHelpers.readAvoImplAddress(avoContract.address);
          expect(avoImplAfter.toLowerCase()).to.equal(mockAvoContractWithUpgradeHook.address.toLowerCase());
        });

        it("should revert upgrade if afterUpgradeHook reverts", async () => {
          await deployMockWithUpgradeHook(true);

          const avoImplBefore = await testHelpers.readAvoImplAddress(avoContract.address);
          expect(avoImplBefore).to.equal(avoLogicContract.address.toLowerCase());

          // execute upgradeTo(), must be executed through self-called
          const result = await (
            await testHelpers.executeActions(avoContract, user1, [
              (
                await avoContract.populateTransaction.upgradeTo(mockAvoContractWithUpgradeHook.address, toUtf8Bytes(""))
              ).data as string,
            ])
          ).wait();

          const events = result.events as Event[];
          expect(events.length).to.equal(2);

          expect(events[0].event).to.equal("CastFailed");

          const avoImplAfter = await testHelpers.readAvoImplAddress(avoContract.address);
          expect(avoImplAfter.toLowerCase()).to.equal(avoImplBefore.toLowerCase());
        });

        it("should revert if not self-called", async () => {
          await expect(avoContract._afterUpgradeHook(avoFactory.address, toUtf8Bytes(""))).to.be.revertedWith(
            "AvocadoMultisig__Unauthorized"
          );
        });
      });
    });

    //#region occupy nonces
    describe("occupyAvoNonces", async () => {
      it("should occupyAvoNonces", async () => {
        const currentNonce = (await avoContract.avoNonce()).toNumber();
        const occupyAvoNonces = [currentNonce, currentNonce + 1, currentNonce + 2, currentNonce + 3];

        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.occupyAvoNonces(occupyAvoNonces)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["avoNonce"]
        );
        const avoNonceAfter = (await avoContract.avoNonce()).toNumber();

        expect(avoNonceAfter).to.equal(currentNonce + 4);
      });

      it("should occupyAvoNonces just one nonce through tx itself", async () => {
        const currentNonce = (await avoContract.avoNonce()).toNumber();

        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.occupyAvoNonces(
              [] // set to empty array to occupy a nonce via the tx itself
            )
          ).data as string,
        ]);
        const avoNonceAfter = (await avoContract.avoNonce()).toNumber();

        expect(avoNonceAfter).to.equal(currentNonce + 1);
      });

      it("should emit AvoNonceOccupied", async () => {
        const currentNonce = (await avoContract.avoNonce()).toNumber();
        const occupyAvoNonces = [currentNonce + 1, currentNonce + 2, currentNonce + 3, currentNonce + 4];

        const result = await (
          await testHelpers.executeActions(
            avoContract,
            user1,
            [(await avoContract.populateTransaction.occupyAvoNonces(occupyAvoNonces)).data as string],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            ["avoNonce"]
          )
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(6);

        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
        expect(events[0].event).to.equal("AvoNonceOccupied");
        expect(events[0].args?.occupiedAvoNonce).to.equal(occupyAvoNonces[0]);
        expect(events[1].event).to.equal("AvoNonceOccupied");
        expect(events[1].args?.occupiedAvoNonce).to.equal(occupyAvoNonces[1]);
        expect(events[2].event).to.equal("AvoNonceOccupied");
        expect(events[2].args?.occupiedAvoNonce).to.equal(occupyAvoNonces[2]);
        expect(events[3].event).to.equal("AvoNonceOccupied");
        expect(events[3].args?.occupiedAvoNonce).to.equal(occupyAvoNonces[3]);
      });

      it("should skip occupyNonces that are < current nonce", async () => {
        // increase once to get nonce up in value
        let currentNonce = (await avoContract.avoNonce()).toNumber();
        let occupyAvoNonces = [currentNonce, currentNonce + 1, currentNonce + 2, currentNonce + 3, currentNonce + 4];
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.occupyAvoNonces(occupyAvoNonces)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["avoNonce"]
        );

        currentNonce = (await avoContract.avoNonce()).toNumber();
        occupyAvoNonces = [currentNonce - 1, currentNonce, currentNonce + 1, currentNonce + 2, currentNonce + 3];

        const result = await (
          await testHelpers.executeActions(
            avoContract,
            user1,
            [(await avoContract.populateTransaction.occupyAvoNonces(occupyAvoNonces)).data as string],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            ["avoNonce"]
          )
        ).wait();

        const avoNonceAfter = (await avoContract.avoNonce()).toNumber();

        expect(avoNonceAfter).to.equal(currentNonce + 4);

        const events = result.events as Event[];
        expect(events.length).to.equal(5);

        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
        expect(events[0].event).to.equal("AvoNonceOccupied");
        expect(events[0].args?.occupiedAvoNonce).to.equal(occupyAvoNonces[2]);
        expect(events[1].event).to.equal("AvoNonceOccupied");
        expect(events[1].args?.occupiedAvoNonce).to.equal(occupyAvoNonces[3]);
        expect(events[2].event).to.equal("AvoNonceOccupied");
        expect(events[2].args?.occupiedAvoNonce).to.equal(occupyAvoNonces[4]);
      });

      it("should revert if occupyNonces are not ordered ascending", async () => {
        const currentNonce = (await avoContract.avoNonce()).toNumber();
        const occupyAvoNonces = [currentNonce, currentNonce + 2, currentNonce + 1, currentNonce + 3];

        // unordered -> should fail
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (await avoContract.populateTransaction.occupyAvoNonces(occupyAvoNonces)).data as string,
          ])
        ).wait();
        const events = result.events as Event[];
        expect(events.length).to.equal(2);
        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
        // 0xec925985 = keccak256 selector for custom error AvocadoMultisig__InvalidParams()
        expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal(
          "0_CUSTOM_ERROR: 0xec925985. PARAMS_RAW: "
        );
      });

      it("should revert if occupyNonces are skipping sequential nonces", async () => {
        const currentNonce = (await avoContract.avoNonce()).toNumber();
        const occupyAvoNonces = [currentNonce + 2, currentNonce + 3, currentNonce + 4];

        // first nonce is already too big -> should fail
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (await avoContract.populateTransaction.occupyAvoNonces(occupyAvoNonces)).data as string,
          ])
        ).wait();
        const events = result.events as Event[];
        expect(events.length).to.equal(2);
        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
        // 0xec925985 = keccak256 selector for custom error AvocadoMultisig__InvalidParams()
        expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal(
          "0_CUSTOM_ERROR: 0xec925985. PARAMS_RAW: "
        );
      });

      it("should revert if trying to occupy more than 5", async () => {
        const currentNonce = (await avoContract.avoNonce()).toNumber();
        const occupyAvoNonces = [
          currentNonce,
          currentNonce + 2,
          currentNonce + 1,
          currentNonce + 3,
          currentNonce + 4,
          currentNonce + 5,
        ];

        let result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (await avoContract.populateTransaction.occupyAvoNonces(occupyAvoNonces)).data as string,
          ])
        ).wait();
        const events = result.events as Event[];
        expect(events.length).to.equal(2);
        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
        // 0xec925985 = keccak256 selector for custom error AvocadoMultisig__InvalidParams()
        expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal(
          "0_CUSTOM_ERROR: 0xec925985. PARAMS_RAW: "
        );
      });
    });

    describe("occupyNonSequentialNonces", async () => {
      const nonSequentialTestNonces = [
        formatBytes32String("test1"),
        formatBytes32String("test2"),
        formatBytes32String("test3"),
        formatBytes32String("test4"),
        formatBytes32String("test5"),
      ];

      it("should occupyNonSequentialNonces", async () => {
        // make sure not occupied before
        for (const nonSequentialTestNonce of nonSequentialTestNonces) {
          expect(await avoContract.nonSequentialNonces(nonSequentialTestNonce)).to.equal(0);
        }

        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.occupyNonSequentialNonces(nonSequentialTestNonces)).data as string,
        ]);

        for (const nonSequentialTestNonce of nonSequentialTestNonces) {
          expect(await avoContract.nonSequentialNonces(nonSequentialTestNonce)).to.equal(1);
        }
      });

      it("should emit NonSequentialNonceOccupied", async () => {
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (await avoContract.populateTransaction.occupyNonSequentialNonces(nonSequentialTestNonces)).data as string,
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(7);

        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
        expect(events[0].event).to.equal("NonSequentialNonceOccupied");
        expect(events[0].args?.occupiedNonSequentialNonce).to.equal(nonSequentialTestNonces[0]);
        expect(events[1].event).to.equal("NonSequentialNonceOccupied");
        expect(events[1].args?.occupiedNonSequentialNonce).to.equal(nonSequentialTestNonces[1]);
        expect(events[2].event).to.equal("NonSequentialNonceOccupied");
        expect(events[2].args?.occupiedNonSequentialNonce).to.equal(nonSequentialTestNonces[2]);
        expect(events[3].event).to.equal("NonSequentialNonceOccupied");
        expect(events[3].args?.occupiedNonSequentialNonce).to.equal(nonSequentialTestNonces[3]);
        expect(events[4].event).to.equal("NonSequentialNonceOccupied");
        expect(events[4].args?.occupiedNonSequentialNonce).to.equal(nonSequentialTestNonces[4]);
      });

      it("should not revert if trying to occupy more than 5", async () => {
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (
              await avoContract.populateTransaction.occupyNonSequentialNonces([
                ...nonSequentialTestNonces,
                formatBytes32String("another one"),
              ])
            ).data as string,
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
      });
    });
    //#endregion

    //#region EIP1271
    describe("signMessage", async () => {
      const digest = solidityKeccak256(["string"], ["someHash"]);

      it("should signMessage", async () => {
        // execute signMessage(), must be executed through self-called
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (await avoContract.populateTransaction.signMessage(digest)).data as string,
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(3);

        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");

        // make sure added digest is now a valid signature
        expect(await avoContract.isValidSignature(digest, toUtf8Bytes(""))).to.equal("0x1626ba7e");
      });

      it("should revert if not self-called", async () => {
        await expect(avoContract.signMessage(digest)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
      });

      it("should emit SignedMessage", async () => {
        // execute signMessage(), must be executed through self-called
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (await avoContract.populateTransaction.signMessage(digest)).data as string,
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(3);

        // sign message is hashed according to https://eips.ethereum.org/EIPS/eip-191 with domain separator
        const messageHash = await testHelpers.getEIP1271SigDigest(avoContract, digest);

        expect(events[0].event).to.equal("SignedMessage");
        expect(events[0].args?.messageHash).to.equal(messageHash);
      });
    });

    describe("removeSignedMessage", async () => {
      const digest = solidityKeccak256(["string"], ["someHash"]);
      // sign message is hashed according to https://eips.ethereum.org/EIPS/eip-191 with domain separator
      let messageHash: string;

      beforeEach(async () => {
        // execute signMessage() to add the signedMessage, must be executed through self-called
        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.signMessage(digest)).data as string,
        ]);

        // sign message is hashed according to https://eips.ethereum.org/EIPS/eip-191 with domain separator
        messageHash = await testHelpers.getEIP1271SigDigest(avoContract, digest);
      });

      it("should start with a signedMessage", async () => {
        // make sure added digest is now a valid signature
        expect(await avoContract.isValidSignature(digest, toUtf8Bytes(""))).to.equal("0x1626ba7e");
      });

      it("should removeSignedMessage", async () => {
        // remove signedMessage
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (await avoContract.populateTransaction.removeSignedMessage(messageHash)).data as string,
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(3);

        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");

        // make sure removed digest is now not a valid signature anymore
        await expect(avoContract.isValidSignature(digest, toUtf8Bytes(""))).to.be.revertedWith(
          "AvocadoMultisig__InvalidEIP1271Signature"
        );
      });

      it("should revert if not self-called", async () => {
        await expect(avoContract.removeSignedMessage(messageHash)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
      });

      it("should emit RemoveSignedMessage", async () => {
        // remove signedMessage
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            (await avoContract.populateTransaction.removeSignedMessage(messageHash)).data as string,
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(3);

        expect(events[0].event).to.equal("RemoveSignedMessage");
        expect(events[0].args?.messageHash).to.equal(messageHash);
      });
    });

    describe("isValidSignature", async () => {
      it("should return 0x1626ba7e for valid signature ", async () => {
        const digest = await testHelpers.getSigDigest(avoContract, user1);
        const signature = await testHelpers.signEIP1271(avoContract, user1, digest);

        const result = await avoContract.isValidSignature(
          digest,
          hexConcat(["0xDEC0DE6520", signature, user1.address])
        );
        expect(result).to.equal(EIP1271MagicValue);
      });

      it("should return 0x1626ba7e for valid signature for arbitrary signed hash", async () => {
        const digest = solidityKeccak256(["string"], ["someHash"]);
        const signature = await testHelpers.signEIP1271(avoContract, user1, digest);

        const result = await avoContract.isValidSignature(digest, signature);
        expect(result).to.equal(EIP1271MagicValue);
      });

      it("should revert for invalid signature", async () => {
        const validSignature = await testHelpers.testSignature(avoContract, user1);
        const invalidSignature =
          validSignature.charAt(validSignature.length - 1) === "a"
            ? validSignature.slice(0, -1).concat("b")
            : validSignature.slice(0, -1).concat("a");

        const digest = await testHelpers.getSigDigest(avoContract, user1);

        await expect(
          avoContract.isValidSignature(
            digest,
            ethers.utils.defaultAbiCoder.encode(
              ["tuple(bytes signature,address signer)[]"],
              [
                [
                  {
                    signature: invalidSignature,
                    signer: user1.address,
                  },
                ],
              ]
            )
          )
        ).to.be.revertedWith("ECDSA: invalid signature");
      });

      it("should revert if signature is not set and hash not allowed", async () => {
        const digest = solidityKeccak256(["string"], ["someHash"]);

        await expect(avoContract.isValidSignature(digest, toUtf8Bytes(""))).to.be.revertedWith(
          "AvocadoMultisig__InvalidEIP1271Signature"
        );
      });

      it("should verify if signature is not set and hash is allowed via signMessage before", async () => {
        const digest = solidityKeccak256(["string"], ["someHash"]);

        // execute signMessage(), must be executed through self-called
        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.signMessage(digest)).data as string,
        ]);

        const result = await avoContract.isValidSignature(digest, toUtf8Bytes(""));
        expect(result).to.equal(EIP1271MagicValue);
      });

      it("should revert for invalid signature nonce", async () => {
        const invalidSignature = await testHelpers.invalidNonceTestSignature(avoContract, user1);

        const digest = await testHelpers.getSigDigest(avoContract, user1);

        await expect(
          avoContract.isValidSignature(digest, hexConcat(["0xDEC0DE6520", invalidSignature, user1.address]))
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if non-sequential nonce has already been used", async () => {
        // execute and use nonce first
        await testHelpers.cast(
          user1,
          await testHelpers.nonSequentialNonceTestSignature(avoContract, user1),
          TestHelpers.nonSequentialTestParams.params,
          TestHelpers.nonSequentialTestParams.forwardParams
        );

        const signature = await testHelpers.nonSequentialNonceTestSignature(avoContract, user1);

        const digest = await testHelpers.getSigDigest(
          avoContract,
          user1,
          TestHelpers.nonSequentialTestParams.params,
          TestHelpers.nonSequentialTestParams.forwardParams
        );

        await expect(
          avoContract.isValidSignature(digest, hexConcat(["0xDEC0DE6520", signature, user1.address]))
        ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
      });

      it("should return 0x1626ba7e for valid signature with 65 bytes of owner", async () => {
        const digest = await testHelpers.getSigDigest(avoContract, user1);
        const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);

        const result = await avoContract.isValidSignature(digest, signatureUser1);
        expect(result).to.equal(EIP1271MagicValue);
      });

      it("should revert for invalid signature with 65 bytes of not owner", async () => {
        const digest = await testHelpers.getSigDigest(avoContract, user1);
        const signatureUser2 = await testHelpers.signEIP1271(avoContract, user2, digest);

        await expect(avoContract.isValidSignature(digest, signatureUser2)).to.be.revertedWith(
          testHelpers.avoError("InvalidParams")
        );
      });

      it("should return 0x1626ba7e for valid signature with 85 bytes (65 signature + 20 signer)", async () => {
        const digest = await testHelpers.getSigDigest(avoContract, user1);
        const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);

        const signatureBytes = hexConcat(["0xDEC0DE6520", signatureUser1, user1.address]);

        const result = await avoContract.isValidSignature(digest, signatureBytes);
        expect(result).to.equal(EIP1271MagicValue);
      });

      it("should revert for signer is zero address with 85 bytes (65 signature + 20 signer)", async () => {
        const digest = await testHelpers.getSigDigest(avoContract, user1);
        const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);

        const signatureBytes = hexConcat(["0xDEC0DE6520", signatureUser1, ethers.constants.AddressZero]);

        await expect(avoContract.isValidSignature(digest, signatureBytes)).to.be.revertedWith(
          testHelpers.avoError("InvalidParams")
        );
      });

      it("should return 0x1626ba7e for valid signature via abi.encode / decode", async () => {
        const digest = await testHelpers.getSigDigest(avoContract, user1);
        const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);

        const signatureParams_: AvocadoMultisigStructs.SignatureParamsStruct = {
          signature: signatureUser1,
          signer: user1.address,
        };

        const signatureBytes = ethers.utils.defaultAbiCoder.encode(
          ["tuple(bytes signature,address signer)[]"],
          [[signatureParams_]]
        );

        const result = await avoContract.isValidSignature(digest, signatureBytes);
        expect(result).to.equal(EIP1271MagicValue);
      });

      it("should revert for signer is zero address via abi.encode / decode", async () => {
        const digest = await testHelpers.getSigDigest(avoContract, user1);
        const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);

        const signatureParams_: AvocadoMultisigStructs.SignatureParamsStruct = {
          signature: signatureUser1,
          signer: ethers.constants.AddressZero,
        };

        const signatureBytes = ethers.utils.defaultAbiCoder.encode(
          ["tuple(bytes signature,address signer)[]"],
          [[signatureParams_]]
        );

        await expect(avoContract.isValidSignature(digest, signatureBytes)).to.be.revertedWith(
          testHelpers.avoError("InvalidParams")
        );
      });

      context("with smart contract signer", () => {
        //#region beforeEach test setup
        let mockSigner: MockSigner;
        beforeEach(async () => {
          // deploy MockSigner contract
          const mockSignerFactory = (await ethers.getContractFactory("MockSigner", user3)) as MockSigner__factory;
          mockSigner = await mockSignerFactory.deploy();
          await mockSigner.deployed();

          await testHelpers.executeActions(
            avoContract,
            user1,
            [
              // execute addSigners() to add MockSigner as signers
              (
                await (avoContract as IAvocadoMultisigV1 & AvocadoMultisig).populateTransaction.addSigners(
                  [mockSigner.address],
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

        it("should start with mockSigner as a signer", async () => {
          expect(await (avoContract as IAvocadoMultisigV1).isSigner(mockSigner.address)).to.equal(true);
        });
        //#endregion

        it("should return 0x1626ba7e for valid smart contract signature via abi.encode / decode", async () => {
          // deployer of mockSigner contract (user3) is allowed as smart contract signer
          const digest = await testHelpers.getSigDigest(avoContract, user3);
          const signatureUser3 = await testHelpers.signEIP1271(avoContract, user3, digest);

          const signatureParams_: AvocadoMultisigStructs.SignatureParamsStruct = {
            signature: signatureUser3,
            signer: mockSigner.address,
          };

          const signatureBytes = ethers.utils.defaultAbiCoder.encode(
            ["tuple(bytes signature,address signer)[]"],
            [[signatureParams_]]
          );

          const result = await avoContract.isValidSignature(digest, signatureBytes);
          expect(result).to.equal(EIP1271MagicValue);
        });

        it("should revert for invalid smart contract signature via abi.encode / decode", async () => {
          // deployer of mockSigner contract (user3) is allowed as smart contract signer
          const digest = await testHelpers.getSigDigest(avoContract, user2);
          const signatureUser2 = await testHelpers.signEIP1271(avoContract, user2, digest);

          const signatureParams_: AvocadoMultisigStructs.SignatureParamsStruct = {
            signature: signatureUser2,
            signer: mockSigner.address,
          };

          const signatureBytes = ethers.utils.defaultAbiCoder.encode(
            ["tuple(bytes signature,address signer)[]"],
            [[signatureParams_]]
          );

          await expect(avoContract.isValidSignature(digest, signatureBytes)).to.be.revertedWith(
            "AvocadoMultisig__InvalidEIP1271Signature()"
          );
        });
      });

      context("with arbitrary sig length smart contract signer", () => {
        //#region beforeEach test setup
        let mockSignerArbitrarySigLength: MockSigner;
        beforeEach(async () => {
          // deploy MockSigner contract
          const mockSignerFactory = (await ethers.getContractFactory(
            "MockSignerArbitrarySigLength",
            user3
          )) as MockSignerArbitrarySigLength__factory;
          mockSignerArbitrarySigLength = await mockSignerFactory.deploy();
          await mockSignerArbitrarySigLength.deployed();

          await testHelpers.executeActions(
            avoContract,
            user1,
            [
              // execute addSigners() to add MockSigner as signers
              (
                await (avoContract as IAvocadoMultisigV1 & AvocadoMultisig).populateTransaction.addSigners(
                  [mockSignerArbitrarySigLength.address],
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

        it("should start with mockSignerArbitrarySigLength as a signer", async () => {
          expect(await (avoContract as IAvocadoMultisigV1).isSigner(mockSignerArbitrarySigLength.address)).to.equal(
            true
          );
        });
        //#endregion

        it("should support arbitrary signature length smart contract signers", async () => {
          // deployer of mockSignerArbitrarySigLength contract (user3) is allowed as smart contract signer
          const digest = await testHelpers.getSigDigest(avoContract, user3);
          const signatureUser3 = await testHelpers.signEIP1271(avoContract, user3, digest);

          const signatureParams_: AvocadoMultisigStructs.SignatureParamsStruct = {
            // adding some random noise that will be cut off in mock signer but properly simulates arbitrary length
            signature: signatureUser3 + "435643564356435643564356435643564356",
            signer: mockSignerArbitrarySigLength.address,
          };

          const signatureBytes = ethers.utils.defaultAbiCoder.encode(
            ["tuple(bytes signature,address signer)[]"],
            [[signatureParams_]]
          );

          const result = await avoContract.isValidSignature(digest, signatureBytes);
          expect(result).to.equal(EIP1271MagicValue);
        });

        it("should support arbitrary signature length smart contract signers with % 85 == 0", async () => {
          // deployer of mockSignerArbitrarySigLength contract (user3) is allowed as smart contract signer
          const digest = await testHelpers.getSigDigest(avoContract, user3);
          let signatureUser3 = await testHelpers.signEIP1271(avoContract, user3, digest);

          let signatureBytes = "";

          // find a case where signature bytes will be divisble by 85
          do {
            signatureUser3 += "4356";

            const signatureParams_: AvocadoMultisigStructs.SignatureParamsStruct = {
              // adding some random noise that will be cut off in mock signer but properly simulates arbitrary length
              signature: signatureUser3,
              signer: mockSignerArbitrarySigLength.address,
            };

            signatureBytes = ethers.utils.defaultAbiCoder.encode(
              ["tuple(bytes signature,address signer)[]"],
              [[signatureParams_]]
            );
          } while (ethers.utils.arrayify(signatureBytes).length % 85 != 0);

          const result = await avoContract.isValidSignature(digest, signatureBytes);
          expect(result).to.equal(EIP1271MagicValue);
        });
      });
    });
    //#endregion

    for (const currMethod of ["verify", "verifyAuthorized", "verifyChainAgnostic"]) {
      describe(`${currMethod}:`, async () => {
        //#region local test helpers

        // helper method to execute actions based on `currMethod`
        const executeVerify = async (
          signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [],
          params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
          forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams,
          authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams
        ) => {
          if (!signaturesParams.length) {
            signaturesParams = [
              {
                signature: await buildCurrMethodSignature(user1, params, forwardParams, authorizedParams),
                signer: user1.address,
              },
            ];
          }

          if (currMethod === "verify") {
            return testHelpers.verify(avoContract, user1, signaturesParams, params, forwardParams);
          } else if (currMethod === "verifyAuthorized") {
            return testHelpers.verifyAuthorized(
              avoContract as IAvocadoMultisigV1,
              user1,
              signaturesParams,
              params,
              authorizedParams
            );
          } else if (currMethod === "verifyChainAgnostic") {
            let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
              {
                ...TestHelpers.testParams.chainAgnosticParams(3),
              },
              {
                params,
                forwardParams,
                chainId: -1, // will be set to current network chain id
              },
            ];

            chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
              .params;

            return testHelpers.verifyChainAgnostic(avoContract, user1, chainAgnosticParams, 1, signaturesParams);
          } else {
            throw new Error("NOT_IMPLEMENTED");
          }
        };

        const buildCurrMethodSignature = async (
          signer: SignerWithAddress,
          params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
          forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams,
          authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams,
          chainId?: number
        ) => {
          if (currMethod === "verify") {
            return testHelpers.testSignature(avoContract, signer, params, forwardParams, chainId);
          } else if (currMethod === "verifyAuthorized") {
            return testHelpers.testSignatureAuthorized(
              avoContract as IAvocadoMultisigV1,
              signer,
              params,
              authorizedParams,
              chainId
            );
          } else if (currMethod === "verifyChainAgnostic") {
            let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
              {
                ...TestHelpers.testParams.chainAgnosticParams(3),
              },
              {
                params,
                forwardParams,
                chainId: chainId || -1, // -1 will be set to current network chain id
              },
            ];

            chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, signer, chainAgnosticParams))
              .params;

            return testHelpers.testSignatureChainAgnostic(avoContract, signer, chainAgnosticParams);
          } else {
            throw new Error("NOT_IMPLEMENTED");
          }
        };

        it("should build correct domain separator", async () => {
          const contractDomainSeparator = await avoContract.domainSeparatorV4();

          const domainSeparator = ethers.utils._TypedDataEncoder.hashDomain(
            await testHelpers.typedDataDomain(avoContract)
          );

          expect(domainSeparator).to.equal(contractDomainSeparator);
        });

        it("should verify valid signature correctly ", async () => {
          expect(await executeVerify()).to.equal(true);
        });

        it("should revert for verify invalid signature correctly ", async () => {
          const validSignature = await buildCurrMethodSignature(user1);
          const invalidSignature =
            validSignature.charAt(validSignature.length - 1) === "a"
              ? validSignature.slice(0, -1).concat("b")
              : validSignature.slice(0, -1).concat("a");

          await expect(executeVerify([{ signature: invalidSignature, signer: user1.address }])).to.be.revertedWith(
            "ECDSA: invalid signature"
          );
        });

        it("should revert for verify wrong avoNonce signature correctly", async () => {
          const invalidSignature = await buildCurrMethodSignature(user1, {
            ...TestHelpers.testParams.params,
            avoNonce: 2777, // random avoNonce
          });

          // params are sent with the actually correct nonce, just the signature uses a wrong nonce
          // to simulate malicious use. With signer, the recovered signer will mismatch the sent signer
          await expect(executeVerify([{ signature: invalidSignature, signer: user1.address }])).to.be.revertedWith(
            testHelpers.avoError("InvalidParams")
          );
        });

        it("should revert for verify signature with chainId other than default chain id as invalid", async () => {
          const invalidSignature = await buildCurrMethodSignature(
            user1,
            undefined,
            undefined,
            undefined,
            419 // use 419 as chainId, which should make the signature invalid
          );

          await expect(executeVerify([{ signature: invalidSignature, signer: user1.address }])).to.be.revertedWith(
            testHelpers.avoError("InvalidParams")
          );
        });

        it("should revert if no actions are defined ", async () => {
          await expect(executeVerify(undefined, { ...TestHelpers.testParams.params, actions: [] })).to.be.revertedWith(
            "AvocadoMultisig__InvalidParams"
          );
        });

        it("should revert if signer_ does not match actual signature signer", async () => {
          await expect(
            executeVerify([{ signature: await buildCurrMethodSignature(user1), signer: user2.address }])
          ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
        });

        it("should revert if signer_ is address zero (param is required)", async () => {
          await expect(
            executeVerify([{ signature: await buildCurrMethodSignature(user1), signer: constants.AddressZero }])
          ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
        });

        it("should revert if not valid anymore", async () => {
          const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

          await expect(
            executeVerify(
              undefined,
              undefined,
              {
                ...TestHelpers.testParams.forwardParams,
                validUntil: (currentBlock as any).timestamp - 10, // set validUntil already expired
              },
              {
                ...TestHelpers.testParams.authorizedParams,
                validUntil: (currentBlock as any).timestamp - 10, // set validUntil already expired
              }
            )
          ).to.be.revertedWith("AvocadoMultisig__InvalidTiming");
        });

        it("should revert if not valid yet", async () => {
          const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

          await expect(
            executeVerify(
              undefined,
              undefined,
              {
                ...TestHelpers.testParams.forwardParams,
                validAfter: (currentBlock as any).timestamp + 100, // set validAfter to after next block timestamp
              },
              {
                ...TestHelpers.testParams.authorizedParams,
                validAfter: (currentBlock as any).timestamp + 100, // set validAfter to after next block timestamp
              }
            )
          ).to.be.revertedWith("AvocadoMultisig__InvalidTiming");
        });

        context("with non-sequential nonce", async () => {
          it("should verify valid signature correctly ", async () => {
            const signature = await buildCurrMethodSignature(
              user1,
              TestHelpers.nonSequentialTestParams.params,
              TestHelpers.nonSequentialTestParams.forwardParams,
              TestHelpers.nonSequentialTestParams.authorizedParams
            );

            expect(
              await executeVerify(
                [{ signature, signer: user1.address }],
                TestHelpers.nonSequentialTestParams.params,
                TestHelpers.nonSequentialTestParams.forwardParams,
                TestHelpers.nonSequentialTestParams.authorizedParams
              )
            ).to.equal(true);
          });

          it("should verify valid signature with salt correctly ", async () => {
            const paramsWithSalt: AvocadoMultisigStructs.CastParamsStruct = {
              ...TestHelpers.nonSequentialTestParams.params,
              salt: formatBytes32String("0x2"),
            };

            const signature = await buildCurrMethodSignature(
              user1,
              paramsWithSalt,
              TestHelpers.nonSequentialTestParams.forwardParams,
              TestHelpers.nonSequentialTestParams.authorizedParams
            );

            expect(
              await executeVerify(
                [{ signature, signer: user1.address }],
                paramsWithSalt,
                TestHelpers.nonSequentialTestParams.forwardParams,
                TestHelpers.nonSequentialTestParams.authorizedParams
              )
            ).to.equal(true);
          });

          it("should have different signature when salt changes", async () => {
            const paramsWithSalt: AvocadoMultisigStructs.CastParamsStruct = {
              ...TestHelpers.nonSequentialTestParams.params,
              salt: formatBytes32String("0x02"),
            };

            const signature = await buildCurrMethodSignature(
              user1,
              TestHelpers.nonSequentialTestParams.params,
              TestHelpers.nonSequentialTestParams.forwardParams,
              TestHelpers.nonSequentialTestParams.authorizedParams
            );
            const signatureWithSalt = await buildCurrMethodSignature(
              user1,
              paramsWithSalt,
              TestHelpers.nonSequentialTestParams.forwardParams,
              TestHelpers.nonSequentialTestParams.authorizedParams
            );

            expect(signature).to.not.equal(signatureWithSalt);
          });

          it("should revert if non-sequential nonce has already been used", async () => {
            // occupy nonce first
            let occupyNonce: string;

            if (currMethod === "verify") {
              occupyNonce = await avoContract.getSigDigest(
                TestHelpers.nonSequentialTestParams.params,
                TestHelpers.nonSequentialTestParams.forwardParams
              );
            } else if (currMethod === "verifyChainAgnostic") {
              let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
                {
                  ...TestHelpers.testParams.chainAgnosticParams(3),
                },
                {
                  params: TestHelpers.nonSequentialTestParams.params,
                  forwardParams: TestHelpers.nonSequentialTestParams.forwardParams,
                  chainId: -1, // -1 will be set to current network chain id
                },
              ];

              chainAgnosticParams = (
                await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams)
              ).params;
              chainAgnosticParams[0].params.avoNonce = 1;

              occupyNonce = await (avoContract as AvocadoMultisig).getSigDigestChainAgnostic(chainAgnosticParams);
            } else {
              occupyNonce = await avoContract.getSigDigestAuthorized(
                TestHelpers.nonSequentialTestParams.params,
                TestHelpers.nonSequentialTestParams.authorizedParams
              );
            }

            await testHelpers.executeActions(avoContract, user1, [
              (await avoContract.populateTransaction.occupyNonSequentialNonces([occupyNonce])).data as string,
            ]);

            // make sure nonce is occupied
            expect(await avoContract.nonSequentialNonces(occupyNonce)).to.equal(1);

            await expect(
              executeVerify(
                [
                  {
                    signature: await buildCurrMethodSignature(
                      user1,
                      TestHelpers.nonSequentialTestParams.params,
                      TestHelpers.nonSequentialTestParams.forwardParams,
                      TestHelpers.nonSequentialTestParams.authorizedParams
                    ),
                    signer: user1.address,
                  },
                ],
                TestHelpers.nonSequentialTestParams.params,
                TestHelpers.nonSequentialTestParams.forwardParams,
                TestHelpers.nonSequentialTestParams.authorizedParams
              )
            ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
          });
        });
      });
    }

    // describe("castAuthorized", async () => {
    // });

    describe("execute actions", async () => {
      //#region beforeEach test setup
      let mockSigner: MockSigner;
      beforeEach(async () => {
        // deploy MockSigner contract
        const mockSignerFactory = (await ethers.getContractFactory("MockSigner", user3)) as MockSigner__factory;
        mockSigner = await mockSignerFactory.deploy();
        await mockSigner.deployed();

        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            // execute addSigners() to add user2 & MockSigner as signers
            (
              await (avoContract as IAvocadoMultisigV1 & AvocadoMultisig).populateTransaction.addSigners(
                sortAddressesAscending([user2.address, mockSigner.address]),
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

      it("should start with user1 (owner) as a signer", async () => {
        expect(await (avoContract as IAvocadoMultisigV1).isSigner(user1.address)).to.equal(true);
      });

      it("should start with user2 as a signer", async () => {
        expect(await (avoContract as IAvocadoMultisigV1).isSigner(user2.address)).to.equal(true);
      });

      it("should start with mockSigner as a signer", async () => {
        expect(await (avoContract as IAvocadoMultisigV1).isSigner(mockSigner.address)).to.equal(true);
      });
      //#endregion

      // tests here are executed the same way for multiple cast and castAuthorized methods to have the broadest test coverage possible
      // cast is executed through owner signature, through an authority / multiple signers signature,
      // and a smart contract authority / signer
      for (const currMethod of [
        "cast",
        "castAuthorized",
        "castNotOwnerSignature",
        "castContractSignature",
        "castChainAgnostic",
      ]) {
        context(`for ${currMethod}:`, async () => {
          //#region local test helpers

          beforeEach(async () => {
            if (["castNotOwnerSignature", "castContractSignature"].includes(currMethod))
              await testHelpers.executeActions(
                avoContract,
                user1,
                [
                  // set required signers to 2 (can be owner + user2 or mockSigner then)
                  (
                    await (avoContract as IAvocadoMultisigV1 & AvocadoMultisig).populateTransaction.setRequiredSigners(
                      2
                    )
                  ).data as string,
                ],
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                ["requiredSigners"]
              );
          });

          // helper method to execute actions based on `currMethod`
          const executeActions = async (
            params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
            forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams,
            authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams
              .authorizedParams,
            value = BigNumber.from(0),
            skipBeforeChecks: SkipBeforeChecks[] = [],
            skipAfterChecks: SkipAfterChecks[] = []
          ) => {
            if (currMethod === "cast") {
              // build signature for user 1
              const signature = await testHelpers.testSignature(avoContract, user1, params, forwardParams);

              // call must go through avoForwarder, only the forwarder is allowed to call .cast
              return testHelpers.cast(
                user1,
                signature,
                params,
                forwardParams,
                undefined,
                undefined,
                value,
                skipBeforeChecks,
                skipAfterChecks
              );
            } else if (currMethod === "castNotOwnerSignature") {
              // authority for wallet, multiple signers for AvocadoMultisig

              // build signature for authority / signer (user2)
              const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [
                {
                  signature: await testHelpers.testSignature(avoContract, user2, params, forwardParams),
                  signer: user2.address,
                },
              ];

              signaturesParams.push(
                // add owner signature to reach quorum
                {
                  signature: await testHelpers.testSignature(avoContract, user1, params, forwardParams),
                  signer: user1.address,
                }
              );

              // call must go through avoForwarder, only the forwarder is allowed to call .cast
              return testHelpers.cast(
                user1,
                "",
                params,
                forwardParams,
                signaturesParams,
                undefined,
                value,
                skipBeforeChecks,
                skipAfterChecks
              );
            } else if (currMethod === "castContractSignature") {
              // authority contract for wallet, multiple signers with a smart contract signer for AvocadoMultisig

              const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [
                {
                  // build signature for smart contract authority / signer (user3)
                  // mockSigner allows signatures from original owner (deployer), which is user3
                  signature: await testHelpers.testSignature(avoContract, user3, params, forwardParams),
                  // smart contract address here
                  signer: mockSigner.address,
                },
              ];

              signaturesParams.push(
                // add owner signature to reach quorum
                {
                  signature: await testHelpers.testSignature(avoContract, user1, params, forwardParams),
                  signer: user1.address,
                }
              );

              // call must go through avoForwarder, only the forwarder is allowed to call .cast
              return testHelpers.cast(
                user1,
                "",
                params,
                forwardParams,
                signaturesParams,
                undefined,
                value,
                skipBeforeChecks,
                skipAfterChecks
              );
            } else if (currMethod === "castAuthorized") {
              return testHelpers.executeActions(
                avoContract,
                user1,
                params.actions,
                params,
                authorizedParams,
                undefined,
                value,
                skipBeforeChecks,
                skipAfterChecks
              );
            } else if (currMethod === "castChainAgnostic") {
              // add in some other params simulating a signing a tx on another chain at once
              let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
                {
                  ...TestHelpers.testParams.chainAgnosticParams(3),
                },
                {
                  params,
                  forwardParams,
                  chainId: -1, // will be set to current network chain id
                },
              ];
              chainAgnosticParams = (
                await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams)
              ).params;

              // console.log("sig digest from contract", await avoContract.getSigDigestChainAgnostic(chainAgnosticParams));
              // console.log(
              //   "sig digest from test helpers",
              //   await testHelpers.getSigDigestChainAgnostic(avoContract, user1, chainAgnosticParams)
              // );

              // build signature for user 1
              const signature = await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams);

              // call must go through avoForwarder, only the forwarder is allowed to call .castChainAgnostic
              return testHelpers.castChainAgnostic(
                user1,
                signature,
                chainAgnosticParams,
                1, // send actual to be executed tx on current chain position 1
                undefined,
                undefined,
                value,
                skipBeforeChecks,
                skipAfterChecks
              );
            } else {
              throw new Error("NOT_IMPLEMENTED");
            }
          };

          // decodes events from logs if necessary etc. so events can be handled the same way for all tests
          const parseEvents = (result: ContractReceipt) => {
            let events = result.events as Event[];
            if (events[events.length - 1].event === "Executed" || events[events.length - 1].event === "ExecuteFailed") {
              return events.map((event) => {
                try {
                  // event must be decoded because tx was executed through forwarder
                  const log = AvocadoMultisig__factory.createInterface().parseLog(event);
                  return {
                    ...event,
                    event: log.name,
                    args: log.args,
                  };
                } catch (ex) {
                  try {
                    // event must be decoded because tx was executed through forwarder
                    const log = AvocadoMultisig__factory.createInterface().parseLog(event);
                    return {
                      ...event,
                      event: log.name,
                      args: log.args,
                    };
                  } catch (ex) {
                    return event;
                  }
                }
              }) as Event[];
            }

            return events;
          };

          const getCastEvent = (events: Event[]) =>
            events[
              events.length -
                (["cast", "castNotOwnerSignature", "castContractSignature"].includes(currMethod)
                  ? castEventPosFromLastForSigned
                  : castEventPosFromLastForAuthorized)
            ];

          const checkEventSigners = (args: { signer: string; signers: string[] }) => {
            if (currMethod === "castNotOwnerSignature") {
              // signers are sorted ascending
              if (BigNumber.from(user1.address).gt(BigNumber.from(user2.address))) {
                expect(args?.signers[0]).to.equal(user2.address);
                expect(args?.signers[1]).to.equal(user1.address);
              } else {
                expect(args?.signers[0]).to.equal(user1.address);
                expect(args?.signers[1]).to.equal(user2.address);
              }
            } else if (currMethod === "castContractSignature") {
              // signers are sorted ascending
              if (BigNumber.from(mockSigner.address).gt(BigNumber.from(user1.address))) {
                expect(args?.signers[0]).to.equal(user1.address);
                expect(args?.signers[1]).to.equal(mockSigner.address);
              } else {
                expect(args?.signers[0]).to.equal(mockSigner.address);
                expect(args?.signers[1]).to.equal(user1.address);
              }
            } else {
              expect(args?.signers[0]).to.equal(user1.address);
            }
          };
          //#endregion

          it("should revert if no actions are defined", async () => {
            await expect(executeActions({ ...TestHelpers.testParams.params, actions: [] })).to.be.revertedWith(
              "AvocadoMultisig__InvalidParams"
            );
          });

          it("should increase avoNonce on execute", async () => {
            const nonceBefore = await avoContract.avoNonce();

            await executeActions();

            const nonceAfter = await avoContract.avoNonce();

            expect(nonceAfter).to.equal(nonceBefore.add(1));
          });

          it("should use non-sequential nonce if avoNonce == -1", async () => {
            let expectedNonSequentialNonce: string;

            if (currMethod === "castAuthorized") {
              expectedNonSequentialNonce = await (avoContract as AvocadoMultisig).getSigDigestAuthorized(
                TestHelpers.nonSequentialTestParams.params,
                TestHelpers.nonSequentialTestParams.authorizedParams
              );
            } else if (currMethod === "castChainAgnostic") {
              let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
                {
                  ...TestHelpers.testParams.chainAgnosticParams(3),
                },
                {
                  params: TestHelpers.nonSequentialTestParams.params,
                  forwardParams: TestHelpers.nonSequentialTestParams.forwardParams,
                  chainId: -1, // will be set to current network chain id
                },
              ];

              expectedNonSequentialNonce = await testHelpers.getSigDigestChainAgnostic(
                avoContract,
                user1,
                chainAgnosticParams
              );
            } else {
              expectedNonSequentialNonce = await avoContract.getSigDigest(
                TestHelpers.nonSequentialTestParams.params,
                TestHelpers.nonSequentialTestParams.forwardParams
              );
            }

            expect(await avoContract.nonSequentialNonces(expectedNonSequentialNonce)).to.equal(0);

            await executeActions(
              TestHelpers.nonSequentialTestParams.params,
              TestHelpers.nonSequentialTestParams.forwardParams
            );

            expect(await avoContract.nonSequentialNonces(expectedNonSequentialNonce)).to.equal(1);
          });

          it("should not increase avoNonce when using non-sequential nonce", async () => {
            const nonceBefore = await avoContract.avoNonce();

            await executeActions(
              TestHelpers.nonSequentialTestParams.params,
              TestHelpers.nonSequentialTestParams.forwardParams
            );

            const nonceAfter = await avoContract.avoNonce();

            expect(nonceAfter).to.equal(nonceBefore);
          });

          it("should revert if non-sequential nonce has already been used", async () => {
            await executeActions(
              TestHelpers.nonSequentialTestParams.params,
              TestHelpers.nonSequentialTestParams.forwardParams
            );

            await expect(
              executeActions(
                TestHelpers.nonSequentialTestParams.params,
                TestHelpers.nonSequentialTestParams.forwardParams,
                undefined,
                undefined,
                ["nonSequentialNonce"]
              )
            ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
          });

          it("should execute cast when id is set to mixed (1)", async () => {
            const result = await (
              await executeActions({
                ...TestHelpers.testParams.params,
                id: 1,
              })
            ).wait();

            const events = parseEvents(result);

            expect(events.length).to.equal(2);
            expect(getCastEvent(events).event).to.equal("CastExecuted");
          });

          it("should revert cast when id is set to > 1", async () => {
            const result = await (
              await executeActions({
                ...TestHelpers.testParams.params,
                id: 2,
              })
            ).wait();

            const events = parseEvents(result);
            expect(events.length).to.equal(2);
            expect(getCastEvent(events).event).to.equal("CastFailed");
          });

          it("should increase avoNonce on execute when cast fails", async () => {
            const nonceBefore = await avoContract.avoNonce();

            // deploy wallets through AvoFactory as test calls
            const iface = new ethers.utils.Interface(AvoFactory__factory.abi);

            const actions: AvocadoMultisigStructs.ActionStruct[] = [
              {
                target: avoFactory.address,
                data: iface.encodeFunctionData("deploy", [user2.address, 0]),
                value: 0,
                operation: 0,
              },
              {
                target: avoFactory.address,
                // contract can not be owner of a AvoWallet -> should Fail
                data: iface.encodeFunctionData("deploy", [avoContract.address, 0]),
                value: 0,
                operation: 0,
              },
            ];

            await executeActions({ ...TestHelpers.testParams.params, actions });

            const nonceAfter = await avoContract.avoNonce();

            expect(nonceAfter).to.equal(nonceBefore.add(1));
          });

          it("should emit CastExecuted event", async () => {
            const result = await (await executeActions()).wait();

            const events = parseEvents(result);
            expect(events.length).to.equal(2);

            expect(getCastEvent(events).event).to.equal("CastExecuted");
            expect(getCastEvent(events).args?.source).to.equal(TestHelpers.testParams.params.source);
            expect(getCastEvent(events).args?.metadata).to.equal(
              hexlify(TestHelpers.testParams.params.metadata as string)
            );
            expect(getCastEvent(events).args?.caller).to.equal(
              currMethod === "castAuthorized" ? user1.address : avoForwarder.address
            );

            checkEventSigners(getCastEvent(events).args as any);
          });

          it("should execute call on each target with data (I: through mocks)", async () => {
            // deploy mock token
            const mockERC20TokenFactory = (await ethers.getContractFactory(
              "MockERC20Token",
              owner
            )) as MockERC20Token__factory;
            const mockERC20Token = await mockERC20TokenFactory.deploy("MockERC20Token", "MOCK");
            await mockERC20Token.deployed();

            // deploy mock deposit contract
            const mockDepositFactory = (await ethers.getContractFactory("MockDeposit", owner)) as MockDeposit__factory;
            const mockDeposit = await mockDepositFactory.deploy(mockERC20Token.address);
            await mockDeposit.deployed();

            // deposit from owner into AvoWallet
            await mockERC20Token.connect(owner).transfer(avoContract.address, parseEther("1000"));

            // create actions: approve 100 tokens to depositContract and try to deposit 99 tokens
            // both actions should succeed.
            const actions: AvocadoMultisigStructs.ActionStruct[] = [
              {
                target: mockERC20Token.address,
                data: (await mockERC20Token.populateTransaction.approve(mockDeposit.address, parseEther("100")))
                  .data as any,
                value: 0,
                operation: 0,
              },
              {
                target: mockDeposit.address,
                data: (await mockDeposit.populateTransaction.deposit(parseEther("99"))).data as any,
                value: 0,
                operation: 0,
              },
            ];

            const result = await (await executeActions({ ...TestHelpers.testParams.params, actions })).wait();

            const events = parseEvents(result);
            expect(getCastEvent(events).event).to.equal("CastExecuted");

            // check mockDeposit contract now has 99 tokens
            expect((await mockERC20Token.balanceOf(mockDeposit.address)).eq(parseEther("99"))).to.equal(true);

            // ensure avoWallet allowance to mockDeposit is now at 1 (100 approved, 99 transferred)
            const allowance = await mockERC20Token.allowance(avoContract.address, mockDeposit.address);
            expect(allowance).to.equal(parseEther("1"));
          });

          it("should execute call on each target with data (II: through factory)", async () => {
            // deploy wallets through AvoFactory as test calls
            const iface = new ethers.utils.Interface(AvoFactory__factory.abi);

            const actions: AvocadoMultisigStructs.ActionStruct[] = [
              {
                target: avoFactory.address,
                data: iface.encodeFunctionData("deploy", [owner.address, 0]),
                value: 0,
                operation: 0,
              },
              {
                target: avoFactory.address,
                data: iface.encodeFunctionData("deploy", [user2.address, 0]),
                value: 0,
                operation: 0,
              },
            ];

            const result = await (await executeActions({ ...TestHelpers.testParams.params, actions })).wait();

            const events = parseEvents(result);
            // various events: signerAdded, RequiredSignersSet, SignerMappingAdded, deployed, initialized -> x2
            // plus once CastExecuted + FeePaid or Executed
            expect(events.length).to.equal(12);
            expect(events[3].event).to.equal("Initialized");
            expect(events[8].event).to.equal("Initialized");
            expect(
              iface.parseLog({
                topics: events[4].topics,
                data: events[4].data,
              }).name
            ).to.equal("AvocadoDeployed");

            expect(
              iface.parseLog({
                topics: events[9].topics,
                data: events[9].data,
              }).name
            ).to.equal("AvocadoDeployed");

            expect(events[10].event).to.equal("CastExecuted");

            // ensure wallets have been deployed
            const expectedAddress1 = await avoFactory.computeAvocado(owner.address, 0);
            const getCode1 = await owner.provider?.getCode(expectedAddress1);
            expect(getCode1).to.not.equal("0x");
            const expectedAddress2 = await avoFactory.computeAvocado(user2.address, 0);
            const getCode2 = await owner.provider?.getCode(expectedAddress2);
            expect(getCode2).to.not.equal("0x");
          });

          it("should emit CastFailed event if one of the calls fails", async () => {
            // deploy wallets through AvoFactory as test calls
            const iface = new ethers.utils.Interface(AvoFactory__factory.abi);

            const actions: AvocadoMultisigStructs.ActionStruct[] = [
              {
                target: avoFactory.address,
                data: iface.encodeFunctionData("deploy", [user2.address, 0]),
                value: 0,
                operation: 0,
              },
              {
                target: avoFactory.address,
                // contract can not be owner -> should Fail
                data: iface.encodeFunctionData("deploy", [avoContract.address, 0]),
                value: 0,
                operation: 0,
              },
            ];

            const result = await (await executeActions({ ...TestHelpers.testParams.params, actions })).wait();

            const events = parseEvents(result);

            expect(events.length).to.equal(2);
            expect(getCastEvent(events).event).to.equal("CastFailed");
            // 0x6e31ab6d = keccak256 selector for custom error AvoFactory__NotEOA()
            expect(getCastEvent(events).args?.reason).to.equal("1_CUSTOM_ERROR: 0x6e31ab6d. PARAMS_RAW: ");
            expect(getCastEvent(events).args?.source).to.equal(TestHelpers.testParams.params.source);
            expect(getCastEvent(events).args?.metadata).to.equal(
              hexlify(TestHelpers.testParams.params.metadata as string)
            );
            expect(getCastEvent(events).args?.caller).to.equal(
              currMethod === "castAuthorized" ? user1.address : avoForwarder.address
            );

            checkEventSigners(getCastEvent(events).args as any);
          });

          it("should revert previous actions if one of the calls fails (I: through mocks)", async () => {
            // deploy mock token
            const mockERC20TokenFactory = (await ethers.getContractFactory(
              "MockERC20Token",
              owner
            )) as MockERC20Token__factory;
            const mockERC20Token = await mockERC20TokenFactory.deploy("MockERC20Token", "MOCK");
            await mockERC20Token.deployed();

            // deploy mock deposit contract
            const mockDepositFactory = (await ethers.getContractFactory("MockDeposit", owner)) as MockDeposit__factory;
            const mockDeposit = await mockDepositFactory.deploy(mockERC20Token.address);
            await mockDeposit.deployed();

            // deposit from owner into AvoWallet
            await mockERC20Token.connect(owner).transfer(avoContract.address, parseEther("1000"));

            // create actions: approve 100 tokens to depositContract but try to deposit 100.01 tokens
            // second action should fail.
            const actions: AvocadoMultisigStructs.ActionStruct[] = [
              {
                target: mockERC20Token.address,
                data: (await mockERC20Token.populateTransaction.approve(mockDeposit.address, parseEther("100")))
                  .data as any,
                value: 0,
                operation: 0,
              },
              {
                target: mockDeposit.address,
                data: (await mockDeposit.populateTransaction.deposit(parseEther("100.01"))).data as any,
                value: 0,
                operation: 0,
              },
            ];

            const result = await (await executeActions({ ...TestHelpers.testParams.params, actions })).wait();

            // expect event CastFailed to be emitted
            const events = parseEvents(result);

            expect(events.length).to.equal(2);
            expect(getCastEvent(events).event).to.equal("CastFailed");
            expect(getCastEvent(events).args?.reason).to.equal("1_ERC20: insufficient allowance");

            // expect approve amount (allowance) from AvoWallet to MockDeposit to be 0 because it was reverted
            const allowance = await mockERC20Token.allowance(avoContract.address, mockDeposit.address);
            expect(allowance).to.equal(0);
          });

          it("should revert previous actions if one of the calls fails (II: through factory)", async () => {
            // deploy wallets through AvoFactory as test calls
            const iface = new ethers.utils.Interface(AvoFactory__factory.abi);

            const actions: AvocadoMultisigStructs.ActionStruct[] = [
              {
                target: avoFactory.address,
                data: iface.encodeFunctionData("deploy", [user2.address, 0]),
                value: 0,
                operation: 0,
              },
              {
                target: avoFactory.address,
                // contract can not be owner -> should Fail
                data: iface.encodeFunctionData("deploy", [avoContract.address, 0]),
                value: 0,
                operation: 0,
              },
            ];

            await executeActions({ ...TestHelpers.testParams.params, actions });

            // ensure wallets have not been deployed, for avoWallet should have failed and for user2 should have reverted
            const expectedAddress2 = await avoFactory.computeAvocado(user2.address, 0);
            const getCode2 = await owner.provider?.getCode(expectedAddress2);
            expect(getCode2).to.equal("0x");
          });

          it("should revert if operation does not exist (> 2)", async () => {
            // deploy wallets through AvoFactory as test calls
            const iface = new ethers.utils.Interface(AvoFactory__factory.abi);

            const actions: AvocadoMultisigStructs.ActionStruct[] = [
              {
                target: avoFactory.address,
                data: iface.encodeFunctionData("deploy", [user2.address, 0]),
                value: 0,
                operation: 3,
              },
            ];

            const result = await (await executeActions({ ...TestHelpers.testParams.params, actions })).wait();

            const events = parseEvents(result);
            expect(events.length).to.equal(2);
            expect(getCastEvent(events).event).to.equal("CastFailed");
            expect(getCastEvent(events).args?.reason).to.equal("0_AVO__INVALID_ID_OR_OPERATION");
          });

          context("with msg.value", async () => {
            let wethErc20: MockWETH;
            let actions: AvocadoMultisigStructs.ActionStruct[];

            beforeEach(async () => {
              const mockWeth = await deployments.deploy("MockWETH", {
                from: owner.address,
                args: [],
                log: true,
                deterministicDeployment: false,
              });

              wethErc20 = MockWETH__factory.connect(mockWeth.address, owner);

              actions = [
                {
                  target: wethErc20.address,
                  data: wethErc20.interface.encodeFunctionData("deposit"),
                  value: parseEther("2.5"),
                  operation: 0,
                },
                {
                  target: wethErc20.address,
                  data: wethErc20.interface.encodeFunctionData("deposit"),
                  value: parseEther("10"),
                  operation: 0,
                },
                {
                  target: wethErc20.address,
                  data: wethErc20.interface.encodeFunctionData("transfer", [owner.address, parseEther("12.5")]),
                  value: BigNumber.from(0),
                  operation: 0,
                },
              ];
            });

            const subject = async (value: number) => {
              // sending msg.value to WETH deposit and then transfer to owner
              const balanceBefore = await wethErc20.balanceOf(owner.address);
              expect(balanceBefore).to.equal(0);

              // send enough eth to be available on avo smart wallet before
              await owner.sendTransaction({ to: avoContract.address, value: parseEther(value.toString()) });
              expect(
                ((await owner.provider?.getBalance(avoContract.address)) as BigNumber).eq(parseEther(value.toString()))
              ).to.equal(true);

              return executeActions({ ...TestHelpers.testParams.params, actions });
            };

            if (currMethod === "castAuthorized") {
              it("should be possible to send msg.value in tx itself for castAuthorized", async () => {
                // sending msg.value to WETH deposit and then transfer to owner
                const balanceBefore = await wethErc20.balanceOf(owner.address);
                expect(balanceBefore).to.equal(0);

                // no eth should be present on wallet, will be sent as msg.value
                expect(((await owner.provider?.getBalance(avoContract.address)) as BigNumber).eq(0)).to.equal(true);

                // sending msg.value to WETH deposit and then transfer to owner
                const result = await (
                  await executeActions(
                    { ...TestHelpers.testParams.params, actions },
                    undefined,
                    undefined,
                    parseEther("12.5")
                  )
                ).wait();

                const events = parseEvents(result);
                expect(getCastEvent(events).event).to.equal("CastExecuted");

                const balanceAfter = await wethErc20.balanceOf(owner.address);
                expect(balanceAfter).to.equal(parseEther("12.5"));
              });
            } else {
              it("should forwarder pass through msg.value as in forwardParams_.value", async () => {
                // sending msg.value to WETH deposit and then transfer to owner
                const balanceBefore = await wethErc20.balanceOf(owner.address);
                expect(balanceBefore).to.equal(0);

                // no eth should be present on wallet, will be sent as msg.value
                expect(((await owner.provider?.getBalance(avoContract.address)) as BigNumber).eq(0)).to.equal(true);

                // sending msg.value to WETH deposit and then transfer to owner
                const result = await (
                  await executeActions(
                    { ...TestHelpers.testParams.params, actions },
                    { ...TestHelpers.testParams.forwardParams, value: parseEther("12.5") },
                    undefined,
                    parseEther("12.5")
                  )
                ).wait();

                const events = parseEvents(result);
                expect(getCastEvent(events).event).to.equal("CastExecuted");

                const balanceAfter = await wethErc20.balanceOf(owner.address);
                expect(balanceAfter).to.equal(parseEther("12.5"));
              });
            }

            it("should execute call on each target and send along correct msg.value", async () => {
              // sending msg.value to WETH deposit and then transfer to owner
              const result = await (await subject(12.5)).wait();

              const events = parseEvents(result);
              expect(events.length).to.equal(5);
              expect(
                wethErc20.interface.parseLog({
                  topics: events[0].topics,
                  data: events[0].data,
                }).name
              ).to.equal("Deposit");
              expect(
                wethErc20.interface.parseLog({
                  topics: events[1].topics,
                  data: events[1].data,
                }).name
              ).to.equal("Deposit");
              expect(
                wethErc20.interface.parseLog({
                  topics: events[2].topics,
                  data: events[2].data,
                }).name
              ).to.equal("Transfer");

              expect(getCastEvent(events).event).to.equal("CastExecuted");

              const balanceAfter = await wethErc20.balanceOf(owner.address);
              expect(balanceAfter).to.equal(parseEther("12.5"));
            });

            it("should emit CastFailed if not enough msg.value is present in contract", async () => {
              const result = await (await subject(5.5)).wait();
              const events = parseEvents(result);

              expect(getCastEvent(events).event).to.equal("CastFailed");
              expect(getCastEvent(events).args?.reason).to.equal("1_REASON_NOT_DEFINED");
            });

            it("should revert initial actions if not enough msg.value is present in contract", async () => {
              await (await subject(5.5)).wait();

              // should revert the first initially successful transfer call
              // so no WETH should be in the avoWallet contract
              const balanceAfter = await wethErc20.balanceOf(avoContract.address);
              expect(balanceAfter).to.equal(parseEther("0"));
            });
          });

          describe("delegatecall actions", async () => {
            let mockDelegateCallTarget: MockDelegateCallTargetMultisig;

            beforeEach(async () => {
              // deploy mock delegate call contract

              const mockDelegateCallTargetFactory = (await ethers.getContractFactory(
                "MockDelegateCallTargetMultisig",
                owner
              )) as MockDelegateCallTargetMultisig__factory;
              mockDelegateCallTarget = await mockDelegateCallTargetFactory.deploy();

              await mockDelegateCallTarget.deployed();
            });

            it("should execute with delegatecall actions (id = mixed, 1)", async () => {
              // actions ->
              const actions: AvocadoMultisigStructs.ActionStruct[] = [
                {
                  target: mockDelegateCallTarget.address,
                  data: (await mockDelegateCallTarget.populateTransaction.emitCalled()).data as any,
                  value: 0,
                  operation: 1,
                },
                {
                  target: mockDelegateCallTarget.address,
                  data: (await mockDelegateCallTarget.populateTransaction.emitCalled()).data as any,
                  value: 0,
                  operation: 1,
                },
              ];

              const result = await (await executeActions({ ...TestHelpers.testParams.params, actions, id: 1 })).wait();

              const events = parseEvents(result);

              expect(events.length).to.equal(4);

              let mockDelegateCallTargetIface = new ethers.utils.Interface(MockDelegateCallTargetMultisig__factory.abi);

              expect(mockDelegateCallTargetIface.parseLog(events[0]).name).to.equal("Called");

              const calledEvent = mockDelegateCallTargetIface.parseLog(events[1]);
              expect(calledEvent.name).to.equal("Called");
              // because callTarget is called via a .delegatecall, msg.sender is original caller to AvoWallet cast / castAuthorized
              expect(calledEvent.args.sender).to.equal(
                currMethod === "castAuthorized" ? user1.address : avoForwarder.address
              );
              expect(calledEvent.args.data).to.equal(
                (await mockDelegateCallTarget.populateTransaction.emitCalled()).data as any
              );
              expect(calledEvent.args.usedBalance.toNumber()).to.equal(0);
              expect(calledEvent.args.callCount.toNumber()).to.equal(2);

              expect(getCastEvent(events).event).to.equal("CastExecuted");
            });

            it("should revert if trying to do a delegate call when id is not set correctly", async () => {
              // actions ->
              const actions: AvocadoMultisigStructs.ActionStruct[] = [
                {
                  target: mockDelegateCallTarget.address,
                  data: (await mockDelegateCallTarget.populateTransaction.emitCalled()).data as any,
                  value: 0,
                  operation: 1,
                },
              ];

              const result = await (await executeActions({ ...TestHelpers.testParams.params, actions })).wait();

              const events = parseEvents(result);
              expect(events.length).to.equal(2);
              expect(getCastEvent(events).event).to.equal("CastFailed");
              expect(getCastEvent(events).args?.reason).to.equal("0_AVO__INVALID_ID_OR_OPERATION");
            });

            it("should reset _transientAllowHash after each delegateCall", async () => {
              const actions: AvocadoMultisigStructs.ActionStruct[] = [
                {
                  target: mockDelegateCallTarget.address,
                  // in action 0, set allowHash in a delegatecall
                  data: (await mockDelegateCallTarget.populateTransaction.setTransientAllowHash()).data as any,
                  value: 0,
                  operation: 1,
                },
                {
                  target: mockDelegateCallTarget.address,
                  // in action 1, revert if allow hash is (still) set
                  data: (await mockDelegateCallTarget.populateTransaction.revertIfTransientAllowHashSet()).data as any,
                  value: 0,
                  operation: 1,
                },
              ];

              const result = await (await executeActions({ ...TestHelpers.testParams.params, actions, id: 1 })).wait();

              const events = parseEvents(result);
              // if not CastFailed -> action 1 did not revert -> _transientAllowHash has been reset
              expect(getCastEvent(events).event).to.equal("CastExecuted");
            });

            it("should emit CastFailed event same as call if delegatecall fails", async () => {
              // actions ->
              const actions: AvocadoMultisigStructs.ActionStruct[] = [
                {
                  target: mockDelegateCallTarget.address,
                  data: (await mockDelegateCallTarget.populateTransaction.triggerRevert()).data as any,
                  value: 0,
                  operation: 1,
                },
              ];

              const result = await (await executeActions({ ...TestHelpers.testParams.params, actions, id: 1 })).wait();

              const events = parseEvents(result);
              expect(events.length).to.equal(2);
              expect(getCastEvent(events).event).to.equal("CastFailed");
              expect(getCastEvent(events).args?.reason).to.equal("0_MOCK_REVERT");
            });

            it("should revert previous actions if delegatecall fails", async () => {
              expect((await mockDelegateCallTarget.callCount()).toNumber()).to.equal(0);

              // actions ->
              const actions: AvocadoMultisigStructs.ActionStruct[] = [
                {
                  target: mockDelegateCallTarget.address,
                  data: (await mockDelegateCallTarget.populateTransaction.emitCalled()).data as any,
                  value: 0,
                  operation: 1,
                },
                {
                  target: mockDelegateCallTarget.address,
                  data: (await mockDelegateCallTarget.populateTransaction.triggerRevert()).data as any,
                  value: 0,
                  operation: 1,
                },
              ];

              const result = await (await executeActions({ ...TestHelpers.testParams.params, actions, id: 1 })).wait();

              const events = parseEvents(result);
              expect(events.length).to.equal(2);
              expect(getCastEvent(events).event).to.equal("CastFailed");
              expect(getCastEvent(events).args?.reason).to.equal("1_MOCK_REVERT");

              expect((await mockDelegateCallTarget.callCount()).toNumber()).to.equal(0);
            });

            describe("should not allow to modify storage vars", async () => {
              const subject = async (actionData: BytesLike) => {
                const actions: AvocadoMultisigStructs.ActionStruct[] = [
                  {
                    target: mockDelegateCallTarget.address,
                    data: actionData,
                    value: 0,
                    operation: 1,
                  },
                ];

                const result = await (
                  await executeActions({ ...TestHelpers.testParams.params, actions, id: 1 })
                ).wait();

                const events = parseEvents(result);

                expect(events.length).to.equal(2);
                expect(getCastEvent(events).event).to.equal("CastFailed");
                expect(getCastEvent(events).args?.reason).to.equal("0_AVO__MODIFIED_STORAGE");
              };

              it("should revert if trying to modify avoWalletImpl with a delegatecall action", async () => {
                const avoImplBefore = await testHelpers.readAvoImplAddress(avoContract.address);

                await subject(
                  (
                    await mockDelegateCallTarget.populateTransaction.tryModifyAvoImplementation()
                  ).data as any
                );

                const avoImplAfter = await testHelpers.readAvoImplAddress(avoContract.address);

                expect(avoImplBefore).to.equal(avoImplAfter);
              });

              it("should revert if trying to modify avoNonce with a delegatecall action", async () => {
                const avoNonceBefore = await avoContract.avoNonce();

                await subject((await mockDelegateCallTarget.populateTransaction.tryModifyAvoNonce()).data as any);

                expect(await avoContract.avoNonce()).to.equal(avoNonceBefore.add(1));
              });

              it("should revert if trying to set _initializing with a delegatecall action", async () => {
                await subject((await mockDelegateCallTarget.populateTransaction.trySetInitializing()).data as any);
              });

              it("should revert if trying to set _initialized with a delegatecall action", async () => {
                await subject((await mockDelegateCallTarget.populateTransaction.trySetInitialized()).data as any);
              });

              it("should revert if trying to set requiredSigners with a delegatecall action", async () => {
                await subject(
                  (
                    await (
                      mockDelegateCallTarget as MockDelegateCallTargetMultisig
                    ).populateTransaction.trySetRequiredSigners()
                  ).data as any
                );
              });

              it("should revert if trying to set signersCount with a delegatecall action", async () => {
                await subject(
                  (
                    await (
                      mockDelegateCallTarget as MockDelegateCallTargetMultisig
                    ).populateTransaction.trySetSignersCount()
                  ).data as any
                );
              });

              it("should revert if trying to set signersPointer address with a delegatecall action", async () => {
                await subject(
                  (
                    await (
                      mockDelegateCallTarget as MockDelegateCallTargetMultisig
                    ).populateTransaction.trySetSignersPointer()
                  ).data as any
                );
              });
            });

            context("with msg.value", async () => {
              let actions: AvocadoMultisigStructs.ActionStruct[];
              beforeEach(async () => {
                // actions ->
                actions = [
                  {
                    target: mockDelegateCallTarget.address,
                    data: (await mockDelegateCallTarget.populateTransaction.emitCalled()).data as any,
                    value: 0,
                    operation: 1,
                  },
                  {
                    target: mockDelegateCallTarget.address,
                    data: (
                      await mockDelegateCallTarget.populateTransaction.transferAmountTo(user1.address, parseEther("1"))
                    ).data as any,
                    value: parseEther("1"),
                    operation: 1,
                  },
                ];
              });

              if (currMethod === "castAuthorized") {
                it("should be possible to send msg.value in tx itself for castAuthorized", async () => {
                  // no eth should be present on wallet, will be sent as msg.value
                  expect(((await owner.provider?.getBalance(avoContract.address)) as BigNumber).eq(0)).to.equal(true);

                  // sending msg.value to WETH deposit and then transfer to owner
                  const result = await (
                    await executeActions(
                      { ...TestHelpers.testParams.params, actions, id: 1 },
                      undefined,
                      undefined,
                      parseEther("2")
                    )
                  ).wait();

                  const events = parseEvents(result);
                  expect(getCastEvent(events).event).to.equal("CastExecuted");

                  // sent 2 ether before but 1 ether should have been sent back
                  expect((await ethers.provider.getBalance(avoContract.address)).eq(parseEther("1"))).to.equal(true);
                });
              } else {
                it("should forwarder pass through msg.value as in forwardParams_.value", async () => {
                  // no eth should be present on wallet, will be sent as msg.value
                  expect(((await owner.provider?.getBalance(avoContract.address)) as BigNumber).eq(0)).to.equal(true);

                  // sending msg.value to WETH deposit and then transfer to owner
                  const result = await (
                    await executeActions(
                      { ...TestHelpers.testParams.params, actions, id: 1 },
                      { ...TestHelpers.testParams.forwardParams, value: parseEther("2") },
                      undefined,
                      parseEther("2")
                    )
                  ).wait();

                  const events = parseEvents(result);
                  expect(getCastEvent(events).event).to.equal("CastExecuted");

                  // sent 2 ether before but 1 ether should have been sent back
                  expect((await ethers.provider.getBalance(avoContract.address)).eq(parseEther("1"))).to.equal(true);
                });
              }

              it("should delegatecall with msg.value", async () => {
                const totalValue = parseEther("2");

                // send enough eth to be available on avo smart wallet before
                await owner.sendTransaction({ to: avoContract.address, value: totalValue });

                expect(((await owner.provider?.getBalance(avoContract.address)) as BigNumber).eq(totalValue)).to.equal(
                  true
                );

                const result = await (
                  await executeActions({ ...TestHelpers.testParams.params, actions, id: 1 })
                ).wait();

                const events = parseEvents(result);
                expect(getCastEvent(events).event).to.equal("CastExecuted");

                // sent 2 ether before but 1 ether should have been sent back
                expect((await ethers.provider.getBalance(avoContract.address)).eq(parseEther("1"))).to.equal(true);
              });

              it("should revert if using more msg.value than available for delegatecall", async () => {
                const totalValue = parseEther("1");

                // send not enough eth to be available on avo smart wallet before
                await owner.sendTransaction({ to: avoContract.address, value: totalValue });
                expect(((await owner.provider?.getBalance(avoContract.address)) as BigNumber).eq(totalValue)).to.equal(
                  true
                );

                // actions ->
                actions = [
                  {
                    target: mockDelegateCallTarget.address,
                    data: (
                      await mockDelegateCallTarget.populateTransaction.transferAmountTo(user1.address, parseEther("2"))
                    ).data as any,
                    value: totalValue,
                    operation: 1,
                  },
                ];

                const result = await (
                  await executeActions({ ...TestHelpers.testParams.params, actions, id: 1 })
                ).wait();

                const events = parseEvents(result);
                expect(events.length).to.be.greaterThanOrEqual(1);

                expect(getCastEvent(events).event).to.equal("CastFailed");
                expect(getCastEvent(events).args?.reason).to.equal("0_REASON_NOT_DEFINED");

                // sent value to contract before, action failed but value is still in contract...
                expect((await ethers.provider.getBalance(avoContract.address)).eq(totalValue)).to.equal(true);
              });
            });
          });
        });
      }
    });
  });
}
