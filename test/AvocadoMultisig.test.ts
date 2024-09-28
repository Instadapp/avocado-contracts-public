import { ethers, getNamedAccounts, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, constants, Event, Wallet } from "ethers";
import { arrayify, BytesLike, concat, formatBytes32String, hexlify, parseEther, toUtf8Bytes } from "ethers/lib/utils";

import { AvocadoMultisigStructs } from "../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";
import {
  AvoFactory,
  AvoForwarder,
  AvoRegistry,
  IAvoFactory,
  IAvocadoMultisigV1,
  AvocadoMultisig,
  AvocadoMultisig__factory,
  MockSigner__factory,
  MockSigner,
  AvoSignersList,
  AvoSignersListProxy,
  MockErrorThrower__factory,
  MockErrorThrower,
  AvoConfigV1,
  AvocadoMultisigSecondary,
  AvoFactory__factory,
  MockDeposit__factory,
  MockERC20Token__factory,
  MockFailingFeeCollector__factory,
  MockInvalidRegistryCalcFeeAbuseGas__factory,
  MockInvalidRegistryCalcFeeInvalidAddress__factory,
  MockInvalidRegistryCalcFeeTooLong__factory,
  MockInvalidRegistryCalcFeeTooShort__factory,
} from "../typechain-types";
import { expect, setupSigners, setupContract, dEaDAddress, sortAddressesAscending } from "./util";
import { avoWalletMultisigSharedTests } from "./AvocadoMultisigCore";
import {
  castEventPosFromLastForAuthorized,
  castEventPosFromLastForSigned,
  defaultAuthorizedMaxFee,
  defaultAuthorizedMinFee,
  EIP1271MagicValue,
  TestHelpers,
} from "./TestHelpers";

describe("AvocadoMultisig", () => {
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
  let user4: SignerWithAddress;
  let broadcaster: SignerWithAddress;
  let dEaDSigner: SignerWithAddress;
  let backupFeeCollector: SignerWithAddress;
  let defaultTestSignature: string;

  let testHelpers: TestHelpers;

  const testSetup = async () => {
    ({ owner, user1, user2, user3, user4, broadcaster, backupFeeCollector } = await setupSigners());

    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
    avoRegistry = await setupContract<AvoRegistry>("AvoRegistryProxy", owner);
    avoLogicContract = await setupContract<AvocadoMultisig>("AvocadoMultisig", owner);
    avoSecondary = await setupContract<AvocadoMultisigSecondary>("AvocadoMultisigSecondary", owner);
    avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", broadcaster);
    avoSignersList = await setupContract<AvoSignersList>("AvoSignersListProxy", owner);
    avoConfigV1 = await setupContract<AvoConfigV1>("AvoConfigV1", owner);

    // AvocadoMultisig for user1 is already deployed through hardhat-deploy script local
    avoContract = AvocadoMultisig__factory.connect(
      await avoFactory.computeAvocado(user1.address, 0),
      user1
    ) as AvocadoMultisig & IAvocadoMultisigV1;

    await user1.sendTransaction({ to: dEaDAddress, value: ethers.utils.parseEther("2") });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [dEaDAddress],
    });
    dEaDSigner = await ethers.getSigner(dEaDAddress);

    testHelpers = new TestHelpers(avoForwarder);

    defaultTestSignature = await testHelpers.testSignature(avoContract, user1);

    return {
      testHelpers,
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
    };
  };

  beforeEach(async () => {
    await testSetup();
  });

  describe("AvoMultisigCore tests", () => {
    avoWalletMultisigSharedTests(testSetup);
  });

  describe.skip("ideal gas measurements", async () => {
    // tests here can be used to do gas measurements for reserve gas amounts and simulation of verify sig logic
    // in simulation methods.
    // expected to be used in combination with console.log gas measurements in contracts directly
    describe("_validateParams", async () => {
      it("max gas possible", async () => {
        // trigger a tx to have nonce > 0
        await testHelpers.executeActions(avoContract, user1, TestHelpers.testParams.params.actions);

        // have all validate params tests use maximum gas: set nonce, validAfter, validUntil, value
        const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

        const value = parseEther("0.1");

        const maxGasForwardParams = {
          ...TestHelpers.testParams.forwardParams,
          validAfter: (currentBlock as any).timestamp - 1,
          validUntil: (currentBlock as any).timestamp + 100,
          value,
          avoNonce: 1,
        };

        const result = await (
          await testHelpers.cast(
            user1,
            await testHelpers.testSignature(avoContract, user1, undefined, maxGasForwardParams),
            undefined,
            maxGasForwardParams,
            undefined,
            undefined,
            value
          )
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Executed");
      });
    });

    describe("_verifySig", async () => {
      it("measure nonSequentialNonce check", async () => {
        let expectedNonSequentialNonce = await avoContract.getSigDigest(
          TestHelpers.nonSequentialTestParams.params,
          TestHelpers.nonSequentialTestParams.forwardParams
        );

        expect(await avoContract.nonSequentialNonces(expectedNonSequentialNonce)).to.equal(0);

        const result = await (
          await testHelpers.cast(
            user1,
            await testHelpers.testSignature(
              avoContract,
              user1,
              TestHelpers.nonSequentialTestParams.params,
              TestHelpers.nonSequentialTestParams.forwardParams
            ),
            TestHelpers.nonSequentialTestParams.params,
            TestHelpers.nonSequentialTestParams.forwardParams
          )
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Executed");

        expect(await avoContract.nonSequentialNonces(expectedNonSequentialNonce)).to.equal(1);
      });

      it("should measure smart contract signer", async () => {
        // deploy MockSigner contract
        const mockSignerFactory = (await ethers.getContractFactory("MockSigner", user3)) as MockSigner__factory;
        const mockSigner: MockSigner = await mockSignerFactory.deploy();
        await mockSigner.deployed();

        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            // execute addSigners() to add user2 and mockSigner as signers
            (
              await (avoContract as IAvocadoMultisigV1 & AvocadoMultisig).populateTransaction.addSigners(
                sortAddressesAscending([user2.address, mockSigner.address]),
                // set requiredSigners() to 2
                2
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        );

        const signatureUser1 = await testHelpers.testSignature(avoContract, user1);
        const signatureUser3 = await testHelpers.testSignature(avoContract, user3);

        const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] =
          testHelpers.sortSignaturesParamsAscending([
            {
              signature: signatureUser1,
              signer: user1.address,
            },
            {
              signature: signatureUser3,
              signer: mockSigner.address,
            },
          ]);

        const result = await (await testHelpers.cast(user1, "", undefined, undefined, signaturesParams)).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Executed");
      });

      it("measure 1 signer", async () => {
        const result = await (
          await testHelpers.cast(user1, await testHelpers.testSignature(avoContract, user1))
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Executed");
      });

      it("measure 2 signer", async () => {
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(sortAddressesAscending([user2.address]), 2)
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        );

        const result = await (
          await testHelpers.cast(user1, "", undefined, undefined, [
            {
              signer: user1.address,
              signature: testHelpers.testSignature(avoContract, user1, TestHelpers.testParams.params),
            },
            {
              signer: user2.address,
              signature: testHelpers.testSignature(avoContract, user2, TestHelpers.testParams.params),
            },
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Executed");
      });

      it("measure 3 signer", async () => {
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                3
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        );

        const result = await (
          await testHelpers.cast(user1, "", undefined, undefined, [
            {
              signer: user1.address,
              signature: testHelpers.testSignature(avoContract, user1, TestHelpers.testParams.params),
            },
            {
              signer: user2.address,
              signature: testHelpers.testSignature(avoContract, user2, TestHelpers.testParams.params),
            },
            {
              signer: user3.address,
              signature: testHelpers.testSignature(avoContract, user3, TestHelpers.testParams.params),
            },
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Executed");
      });

      it("measure 3 signer, required 2", async () => {
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                2
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        );

        const result = await (
          await testHelpers.cast(user1, "", undefined, undefined, [
            {
              signer: user1.address,
              signature: testHelpers.testSignature(avoContract, user1, TestHelpers.testParams.params),
            },
            {
              signer: user2.address,
              signature: testHelpers.testSignature(avoContract, user2, TestHelpers.testParams.params),
            },
          ])
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Executed");
      });

      it("measure 3 signer, last signature invalid", async () => {
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                3
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        );

        await expect(
          testHelpers.cast(user1, "", undefined, undefined, [
            {
              signer: user1.address,
              signature: testHelpers.testSignature(avoContract, user1, TestHelpers.testParams.params),
            },
            {
              signer: user2.address,
              signature: testHelpers.testSignature(avoContract, user2, TestHelpers.testParams.params),
            },
            {
              signer: user3.address,
              signature: testHelpers.testSignature(avoContract, owner, TestHelpers.testParams.params),
            },
          ])
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams()");
      });

      it("should measure many signers", async () => {
        const addSignersCount = (await avoContract.MAX_SIGNERS_COUNT()).toNumber() - 1;
        // -1 to set to maximum because owner is already a signer

        const signers: Wallet[] = [];
        for (let i = 0; i < addSignersCount; i++) {
          signers[i] = Wallet.createRandom();
        }

        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending(signers.map((signer) => signer.address)),
                addSignersCount
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [];

        for (let i = 0; i < addSignersCount; i++) {
          signaturesParams[i] = {
            signature: await testHelpers.testSignature(avoContract, signers[i] as unknown as SignerWithAddress),
            signer: signers[i].address,
          };
        }

        const result = await (await testHelpers.cast(user1, "", undefined, undefined, signaturesParams)).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Executed");
      });
    });

    describe("hardcoded values", async () => {
      it("castAuthorized with max possible gas", async () => {
        // for max possible gas, cause failing action with revertReason too long causing it to be trimmed to max length
        // and pay fee with all values set
        // deploy MockErrorThrower contract
        const mockErrorThrowerFactory = (await ethers.getContractFactory(
          "MockErrorThrower",
          user1
        )) as MockErrorThrower__factory;
        const mockErrorThrower: MockErrorThrower = await mockErrorThrowerFactory.deploy();
        await mockErrorThrower.deployed();

        await avoRegistry.updateFeeConfig({ fee: 1e9, feeCollector: user2.address, mode: 0 });
        // send some eth to AvoWallet to fund fee payments
        await owner.sendTransaction({ to: avoContract.address, value: parseEther("10") });

        const result = await (
          await testHelpers.executeActions(
            avoContract,
            user1,
            [
              {
                target: mockErrorThrower.address,
                data: (await mockErrorThrower.populateTransaction.throwTooLongRequire()).data as string,
                value: 0,
                operation: 0,
              },
            ],
            undefined,
            { ...TestHelpers.testParams.authorizedParams, maxFee: parseEther("10") }
          )
        ).wait();

        const expectReason =
          "0_" +
          "throwRequireVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong".slice(
            0,
            250
          );

        const events = result.events as Event[];
        const castEvent = events[events.length - castEventPosFromLastForAuthorized];
        expect(castEvent.event).to.equal("CastFailed");
        expect(castEvent.args?.reason).to.equal(expectReason);
      });

      it("cast with max possible gas", async () => {
        // for max possible gas, cause failing action with revertReason too long causing it to be trimmed to max length
        // deploy MockErrorThrower contract
        const mockErrorThrowerFactory = (await ethers.getContractFactory(
          "MockErrorThrower",
          user1
        )) as MockErrorThrower__factory;
        const mockErrorThrower: MockErrorThrower = await mockErrorThrowerFactory.deploy();
        await mockErrorThrower.deployed();

        const params = {
          ...TestHelpers.testParams.params,
          actions: [
            {
              target: mockErrorThrower.address,
              data: (await mockErrorThrower.populateTransaction.throwTooLongRequire()).data as string,
              value: 0,
              operation: 0,
            },
          ],
        };

        const result = await (
          await testHelpers.cast(user1, await testHelpers.testSignature(avoContract, user1, params), params)
        ).wait();

        const expectReason =
          "0_" +
          "throwRequireVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong".slice(
            0,
            250
          );

        const events = result.events as Event[];

        expect(events[events.length - 1].event).to.equal("ExecuteFailed");
        expect(events[events.length - 1].args?.reason).to.equal(expectReason);
      });
    });
  });

  describe("function selector collision", async () => {
    it("should not implement a method `_avoImpl` to prevent collision with proxy", async () => {
      let thrownError: any;
      try {
        avoContract.interface.getFunction("_avoImpl" as any);
      } catch (error) {
        thrownError = error;
      }
      expect((thrownError?.message as string)?.startsWith("no matching function")).to.equal(true);
    });

    it("should not implement a method `_owner` to prevent collision with proxy", async () => {
      let thrownError: any;
      try {
        avoContract.interface.getFunction("_owner" as any);
      } catch (error) {
        thrownError = error;
      }
      expect((thrownError?.message as string)?.startsWith("no matching function")).to.equal(true);
    });

    it("should not implement a method `_data` to prevent collision with proxy", async () => {
      let thrownError: any;
      try {
        avoContract.interface.getFunction("_data" as any);
      } catch (error) {
        thrownError = error;
      }
      expect((thrownError?.message as string)?.startsWith("no matching function")).to.equal(true);
    });
  });

  describe("initialize", async () => {
    it("should set owner as signer in initialize", async () => {
      expect(await avoContract.isSigner(user1.address)).to.equal(true);
    });

    it("should set requiredSigners to 1 in initialize", async () => {
      expect(await avoContract.requiredSigners()).to.equal(1);
    });

    it("should ignore if AvoSignersList fails and emit event ListSyncFailed", async () => {
      const { proxyAdmin } = await setupSigners();
      const avoSignersListProxy = await setupContract<AvoSignersListProxy>("AvoSignersListProxy", proxyAdmin, true);
      // set some contract that will not have the method to sync, thus fail
      await avoSignersListProxy.upgradeTo(avoFactory.address);

      const expectedAddress = await avoFactory.computeAvocado(user2.address, 0);
      expect(await owner.provider?.getCode(expectedAddress)).to.equal("0x");

      const result = await (await avoFactory.deploy(user2.address, 0)).wait();
      expect(await owner.provider?.getCode(expectedAddress)).to.not.equal("0x");

      const events = result.events as Event[];
      expect(events.length).to.equal(5);
      const log = AvocadoMultisig__factory.createInterface().parseLog(events[2]);

      expect(log.name).to.equal("ListSyncFailed");

      // ensure user2 (owner) is a signer
      expect(await AvocadoMultisig__factory.connect(expectedAddress, user2).isSigner(user2.address)).to.equal(true);
    });
  });

  //#region view methods
  describe("getSigDigestAuthorized", async () => {
    it("should build correct sig digest authorized hash", async () => {
      const contractDigest = await avoContract.getSigDigestAuthorized(
        TestHelpers.testParams.params,
        TestHelpers.testParams.authorizedParams
      );

      const digest = await testHelpers.getSigDigestAuthorized(avoContract, user1);

      expect(contractDigest).to.equal(digest);
    });

    it("should build correct sig digest authorized hash for non-sequential nonce", async () => {
      const contractDigest = await avoContract.getSigDigestAuthorized(
        TestHelpers.nonSequentialTestParams.params,
        TestHelpers.nonSequentialTestParams.authorizedParams
      );

      const digest = await testHelpers.getSigDigestAuthorized(
        avoContract,
        user1,
        TestHelpers.nonSequentialTestParams.params,
        TestHelpers.nonSequentialTestParams.authorizedParams
      );

      expect(contractDigest).to.equal(digest);
    });
  });

  describe("getSigDigestChainAgnostic", async () => {
    it("should build correct sig digest chain agnostic hash", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];
      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const contractDigest = await avoContract.getSigDigestChainAgnostic(chainAgnosticParams);

      const digest = await testHelpers.getSigDigestChainAgnostic(avoContract, user1, chainAgnosticParams);

      expect(contractDigest).to.equal(digest);

      // should also build the same digest for hashes as inputs
      const contractDigestFromHashes = await avoContract.getSigDigestChainAgnosticFromHashes(
        await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams, 0)
      );
      expect(contractDigestFromHashes).to.equal(digest);
    });

    it("should build correct sig digest chain agnostic hash for non-sequential nonce", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];
      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;
      chainAgnosticParams[0].params.avoNonce = -1;
      chainAgnosticParams[1].params.avoNonce = -1;

      const contractDigest = await avoContract.getSigDigestChainAgnostic(chainAgnosticParams);

      const digest = await testHelpers.getSigDigestChainAgnostic(avoContract, user1, chainAgnosticParams);

      expect(contractDigest).to.equal(digest);

      // should also build the same digest for hashes as inputs
      const contractDigestFromHashes = await avoContract.getSigDigestChainAgnosticFromHashes(
        await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams, 0)
      );
      expect(contractDigestFromHashes).to.equal(digest);
    });

    it("should take chain ids into account to verify correctness", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];
      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const contractDigest = await avoContract.getSigDigestChainAgnostic(chainAgnosticParams);

      let chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams, 0);

      // should also build the same digest for hashes as inputs
      let contractDigestFromHashes = await avoContract.getSigDigestChainAgnosticFromHashes(chainAgnosticHashes);
      expect(contractDigestFromHashes).to.equal(contractDigest);

      // when any chain id is modified, it should not equal the same hash anymore
      chainAgnosticHashes = [
        {
          ...chainAgnosticHashes[0],
        },
        {
          ...chainAgnosticHashes[1],
          chainId: BigNumber.from(7),
        },
      ];
      contractDigestFromHashes = await avoContract.getSigDigestChainAgnosticFromHashes(chainAgnosticHashes);
      expect(contractDigestFromHashes).to.not.equal(contractDigest);
    });

    it("should revert if only 1 chain agnostic action", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];
      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      await expect(avoContract.getSigDigestChainAgnostic(chainAgnosticParams)).to.be.revertedWith(
        testHelpers.avoError("InvalidParams")
      );
    });
  });

  describe("getChainAgnosticHashes", async () => {
    it("should return chain agnostic hashes", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];
      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(owner, chainAgnosticParams, 0);

      expect(chainAgnosticHashes.length).to.equal(2);
      expect(chainAgnosticHashes[0].chainId).to.equal(3);
      expect(chainAgnosticHashes[0].hash).to.not.equal("0x");
      expect(chainAgnosticHashes[0].hash).to.not.equal(ethers.constants.HashZero);
      expect(chainAgnosticHashes[1].chainId).to.equal((await ethers.provider.getNetwork()).chainId);
      expect(chainAgnosticHashes[1].hash).to.not.equal("0x");
      expect(chainAgnosticHashes[1].hash).to.not.equal(ethers.constants.HashZero);
    });

    it("should revert if only 1 chain agnostic action", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      await expect(avoContract.getChainAgnosticHashes(chainAgnosticParams)).to.be.revertedWith(
        testHelpers.avoError("InvalidParams")
      );
    });

    // validity of returned hashes indirectly tested in execution, verification tests
  });
  //#endregion

  //#region signers (indirectly tests `isSigner()`)
  describe("addSigners", async () => {
    it("should addSigners", async () => {
      expect(await avoContract.isSigner(user1.address)).to.equal(true);
      expect(await avoContract.isSigner(user2.address)).to.equal(false);
      expect(await avoContract.isSigner(user3.address)).to.equal(false);

      // execute addSigners(), must be executed through self-called
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(sortAddressesAscending([user2.address, user3.address]), 1)
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      // ensure user2 and user3 is now a signer
      expect(await avoContract.isSigner(user2.address)).to.equal(true);
      expect(await avoContract.isSigner(user3.address)).to.equal(true);

      // ensure user1 (owner is still a signer)
      expect(await avoContract.isSigner(user1.address)).to.equal(true);
    });

    it("should update signersCount", async () => {
      expect(await avoContract.signersCount()).to.equal(1);

      // execute addSigners(), must be executed through self-called
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(sortAddressesAscending([user2.address, user3.address]), 1)
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      expect(await avoContract.signersCount()).to.equal(3);
    });

    it("should emit SignerAdded", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.addSigners([user2.address], 1)).data as string],
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

      expect(events[0].event).to.equal("SignerAdded");
      expect(events[0].args?.signer).to.equal(user2.address);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
    });

    it("should add mapping at AvoSignersList", async () => {
      expect(await avoSignersList.isSignerOf(avoContract.address, user2.address)).to.equal(false);
      expect(await avoSignersList.isSignerOf(avoContract.address, user3.address)).to.equal(false);

      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(sortAddressesAscending([user2.address, user3.address]), 1)
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      expect(await avoSignersList.isSignerOf(avoContract.address, user2.address)).to.equal(true);
      expect(await avoSignersList.isSignerOf(avoContract.address, user3.address)).to.equal(true);
    });

    it("should ignore if AvoSignersList fails and emit event ListSyncFailed", async () => {
      const { proxyAdmin } = await setupSigners();
      const avoSignersListProxy = await setupContract<AvoSignersListProxy>("AvoSignersListProxy", proxyAdmin, true);
      // set some contract that will not have the method to sync, thus fail
      await avoSignersListProxy.upgradeTo(avoFactory.address);

      expect(await avoContract.isSigner(user1.address)).to.equal(true);
      expect(await avoContract.isSigner(user2.address)).to.equal(false);
      expect(await avoContract.isSigner(user3.address)).to.equal(false);

      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
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
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(6);

      expect(events[3].event).to.equal("ListSyncFailed");

      // ensure user2 and user3 is now a signer
      expect(await avoContract.isSigner(user2.address)).to.equal(true);
      expect(await avoContract.isSigner(user3.address)).to.equal(true);

      // ensure user1 (owner is still a signer)
      expect(await avoContract.isSigner(user1.address)).to.equal(true);
    });

    it("should add more signers ascending at correct position", async () => {
      // insert signers, including first position
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000005",
                "0x0000000000000000000000000000000000000009",
                "0x0000000000000000000000000000000000000011",
              ],
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

      let signers_ = await avoContract.signers();
      expect(signers_[0]).to.equal("0x0000000000000000000000000000000000000002");
      expect(signers_[1]).to.equal("0x0000000000000000000000000000000000000003");
      expect(signers_[2]).to.equal("0x0000000000000000000000000000000000000005");
      expect(signers_[3]).to.equal("0x0000000000000000000000000000000000000009");
      expect(signers_[4]).to.equal("0x0000000000000000000000000000000000000011");
      expect(signers_[5]).to.equal(user1.address);
      expect(await avoContract.signersCount()).to.equal(6);

      // insert signers, including last position
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000004",
                "0x0000000000000000000000000000000000000007",
                "0x0000000000000000000000000000000000000012",
                "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF",
              ],
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

      signers_ = await avoContract.signers();
      expect(signers_[0]).to.equal("0x0000000000000000000000000000000000000001");
      expect(signers_[1]).to.equal("0x0000000000000000000000000000000000000002");
      expect(signers_[2]).to.equal("0x0000000000000000000000000000000000000003");
      expect(signers_[3]).to.equal("0x0000000000000000000000000000000000000004");
      expect(signers_[4]).to.equal("0x0000000000000000000000000000000000000005");
      expect(signers_[5]).to.equal("0x0000000000000000000000000000000000000007");
      expect(signers_[6]).to.equal("0x0000000000000000000000000000000000000009");
      expect(signers_[7]).to.equal("0x0000000000000000000000000000000000000011");
      expect(signers_[8]).to.equal("0x0000000000000000000000000000000000000012");
      expect(signers_[9]).to.equal(user1.address);
      expect(signers_[10]).to.equal("0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF");
      expect(await avoContract.signersCount()).to.equal(11);
    });

    it("should revert if not self-called", async () => {
      await expect(avoContract.addSigners([user2.address], 1)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });

    it("should revert (with CastFailed) if signer to add is already present in the middle", async () => {
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000004",
              ],
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

      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000005",
              ],
              1
            )
          ).data as string,
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

    it("should revert (with CastFailed) if signer to add is already present at first pos", async () => {
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000004",
              ],
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

      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.addSigners(
              ["0x0000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000005"],
              1
            )
          ).data as string,
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

    it("should revert (with CastFailed) if signer to add is already present at last pos", async () => {
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000004",
              ],
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

      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.addSigners(
              ["0x0000000000000000000000000000000000000005", "0x0000000000000000000000000000000000000003"],
              1
            )
          ).data as string,
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

    it("should revert (with CastFailed) if signer to add is already present with only one signer to add", async () => {
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000004",
              ],
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

      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.addSigners(["0x0000000000000000000000000000000000000003"], 1)
          ).data as string,
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

    it("should revert (with CastFailed) if signers to add are not ordered ascending", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000005",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000004",
              ],
              1
            )
          ).data as string,
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

    it("should revert (with CastFailed) if signer address at pos 0 to add is zero", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.addSigners([constants.AddressZero], 1)).data as string,
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

    it("should revert (with CastFailed) if signer address at middle pos to add is zero", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000001",
                constants.AddressZero,
                "0x0000000000000000000000000000000000000005",
              ],
              1
            )
          ).data as string,
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

    it("should revert (with CastFailed) if signer address at last pos to add is zero", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.addSigners(
              ["0x0000000000000000000000000000000000000001", constants.AddressZero],
              1
            )
          ).data as string,
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

    it("should revert (with CastFailed) if signers array to add is empty", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.addSigners([], 1)).data as string,
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

    it("should add signers up to MAX_SIGNERS_COUNT", async () => {
      const maxSignersCount = (await avoContract.MAX_SIGNERS_COUNT()).toNumber();
      expect(await avoContract.signersCount()).to.equal(1);

      const signers: Wallet[] = [];
      for (let i = 0; i < maxSignersCount - 1; i++) {
        // -1 because owner is already present
        signers[i] = Wallet.createRandom();
      }

      // add signers
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending(signers.map((signer) => signer.address)),
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
        )
      ).wait();

      const events = result.events as Event[];

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
      expect(await avoContract.signersCount()).to.equal(maxSignersCount);
    });

    it("should revert (with CastFailed) if trying to add more signers than MAX_SIGNERS_COUNT", async () => {
      const maxSignersCount = (await avoContract.MAX_SIGNERS_COUNT()).toNumber();

      const signers: Wallet[] = [];
      for (let i = 0; i < maxSignersCount; i++) {
        // loop until maxSignersCount will be too much because owner is also already present as signer
        signers[i] = Wallet.createRandom();
      }

      // add signers
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.addSigners(
              sortAddressesAscending(signers.map((signer) => signer.address)),
              1
            )
          ).data as string,
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

    it("should set requiredSigners", async () => {
      expect(await avoContract.requiredSigners()).to.equal(1);

      await testHelpers.executeActions(
        avoContract,
        user1,
        [(await avoContract.populateTransaction.addSigners([user2.address], 2)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer", "requiredSigners"]
      );

      expect(await avoContract.requiredSigners()).to.equal(2);
    });

    it("should emit RequiredSignersSet", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.addSigners([user2.address], 2)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(5);

      expect(events[1].event).to.equal("RequiredSignersSet");
      expect(events[1].args?.requiredSigners).to.equal(2);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
    });

    it("should revert if setting requiredSigners > signersCount", async () => {
      const signersCount = await avoContract.signersCount();

      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.addSigners([user2.address], signersCount + 2)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(2);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
      // 0xec925985 = keccak256 selector for custom error AvocadoMultisig__InvalidParams()
      expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal(
        "0_CUSTOM_ERROR: 0xec925985. PARAMS_RAW: "
      );
    });

    it("should revert if setting requiredSigners to 0", async () => {
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.addSigners([user2.address], 0)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        )
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

  describe("removeSigners", async () => {
    beforeEach(async () => {
      // execute addSigners() to add user2 and user3 as signers
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(sortAddressesAscending([user2.address, user3.address]), 1)
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

    it("should start with user2 as a signer", async () => {
      expect(await avoContract.isSigner(user2.address)).to.equal(true);
    });
    it("should start with user3 as a signer", async () => {
      expect(await avoContract.isSigner(user3.address)).to.equal(true);
    });

    it("should removeSigners (user2)", async () => {
      // remove signer
      await testHelpers.executeActions(
        avoContract,
        user1,
        [(await avoContract.populateTransaction.removeSigners([user2.address], 1)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      // ensure user2 is now NOT a signer anymore
      expect(await avoContract.isSigner(user2.address)).to.equal(false);
      // ensure user3 and user1 (owner) are still signers
      expect(await avoContract.isSigner(user3.address)).to.equal(true);
      expect(await avoContract.isSigner(user1.address)).to.equal(true);
    });

    it("should removeSigners (user3)", async () => {
      // remove signer
      await testHelpers.executeActions(
        avoContract,
        user1,
        [(await avoContract.populateTransaction.removeSigners([user3.address], 1)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      // ensure user3 is now NOT a signer anymore
      expect(await avoContract.isSigner(user3.address)).to.equal(false);
      // ensure user2 and user1 (owner) are still signers
      expect(await avoContract.isSigner(user2.address)).to.equal(true);
      expect(await avoContract.isSigner(user1.address)).to.equal(true);
    });

    it("should removeSigners all except owner", async () => {
      // remove signer
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.removeSigners(
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

      // ensure user2 and user3 is now NOT a signer anymore
      expect(await avoContract.isSigner(user2.address)).to.equal(false);
      expect(await avoContract.isSigner(user3.address)).to.equal(false);
      // ensure user1 (owner) is still signer
      expect(await avoContract.isSigner(user1.address)).to.equal(true);
    });

    it("should reset slot 1 when resetting to signersCount = 1", async () => {
      expect(await avoContract.provider?.getStorageAt(avoContract.address, 1)).to.not.equal(ethers.constants.HashZero);

      // remove signer
      const res = await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.removeSigners(
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

      expect(await avoContract.provider?.getStorageAt(avoContract.address, 1)).to.equal(ethers.constants.HashZero);

      // ensure user2 and user3 is now NOT a signer anymore
      expect(await avoContract.isSigner(user2.address)).to.equal(false);
      expect(await avoContract.isSigner(user3.address)).to.equal(false);
      // ensure user1 (owner) is still signer
      expect(await avoContract.isSigner(user1.address)).to.equal(true);

      expect(await avoContract.requiredSigners()).to.equal(1);
      expect(await avoContract.signersCount()).to.equal(1);
    });

    it("should revert when resetting slot 1 when resetting to signersCount = 1 but requiredSigners > 1", async () => {
      // remove signer
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.removeSigners(
                sortAddressesAscending([user2.address, user3.address]),
                2
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
    });

    it("should revert when resetting slot 1 when resetting to signersCount = 1 but requiredSigners = 0", async () => {
      // remove signer
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.removeSigners(
                sortAddressesAscending([user2.address, user3.address]),
                0
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
    });

    it("should update signersCount", async () => {
      expect(await avoContract.signersCount()).to.equal(3);

      // execute removeSigners(), must be executed through self-called
      await testHelpers.executeActions(
        avoContract,
        user1,
        [(await avoContract.populateTransaction.removeSigners([user3.address], 1)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      expect(await avoContract.signersCount()).to.equal(2);
    });

    it("should emit SignerRemoved", async () => {
      // remove signer
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.removeSigners([user2.address], 1)).data as string],
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

      expect(events[0].event).to.equal("SignerRemoved");
      expect(events[0].args?.signer).to.equal(user2.address);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
    });

    it("should remove mapping at AvoSignersList", async () => {
      expect(await avoSignersList.isSignerOf(avoContract.address, user2.address)).to.equal(true);
      expect(await avoSignersList.isSignerOf(avoContract.address, user3.address)).to.equal(true);

      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.removeSigners(
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

      expect(await avoSignersList.isSignerOf(avoContract.address, user2.address)).to.equal(false);
      expect(await avoSignersList.isSignerOf(avoContract.address, user3.address)).to.equal(false);
    });

    it("should ignore if AvoSignersList fails and emit event ListSyncFailed", async () => {
      const { proxyAdmin } = await setupSigners();
      const avoSignersListProxy = await setupContract<AvoSignersListProxy>("AvoSignersListProxy", proxyAdmin, true);
      // set some contract that will not have the method to sync, thus fail
      await avoSignersListProxy.upgradeTo(avoFactory.address);
      // execute addSigners() to add user2 and user3 as signers
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(sortAddressesAscending([user2.address, user3.address]), 1)
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      expect(await avoContract.isSigner(user1.address)).to.equal(true);
      expect(await avoContract.isSigner(user2.address)).to.equal(true);
      expect(await avoContract.isSigner(user3.address)).to.equal(true);

      // execute removeSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.removeSigners(
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
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(5);

      expect(events[2].event).to.equal("ListSyncFailed");

      // ensure user2 and user3 is now a signer
      expect(await avoContract.isSigner(user2.address)).to.equal(false);
      expect(await avoContract.isSigner(user3.address)).to.equal(false);

      // ensure user1 (owner is still a signer)
      expect(await avoContract.isSigner(user1.address)).to.equal(true);
    });

    it("should removeSigners at correct sorted position", async () => {
      // remove user2 and user3 first for easier test use of sorted signers
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.removeSigners(
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

      // execute addSigners(), must be executed through self-called
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000004",
                "0x0000000000000000000000000000000000000005",
                "0x0000000000000000000000000000000000000007",
                "0x0000000000000000000000000000000000000009",
                "0x0000000000000000000000000000000000000011",
                "0x0000000000000000000000000000000000000012",
                "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF",
              ],
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

      let signers_ = await avoContract.signers();
      expect(signers_[0]).to.equal("0x0000000000000000000000000000000000000001");
      expect(signers_[1]).to.equal("0x0000000000000000000000000000000000000002");
      expect(signers_[2]).to.equal("0x0000000000000000000000000000000000000003");
      expect(signers_[3]).to.equal("0x0000000000000000000000000000000000000004");
      expect(signers_[4]).to.equal("0x0000000000000000000000000000000000000005");
      expect(signers_[5]).to.equal("0x0000000000000000000000000000000000000007");
      expect(signers_[6]).to.equal("0x0000000000000000000000000000000000000009");
      expect(signers_[7]).to.equal("0x0000000000000000000000000000000000000011");
      expect(signers_[8]).to.equal("0x0000000000000000000000000000000000000012");
      expect(signers_[9]).to.equal(user1.address);
      expect(signers_[10]).to.equal("0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF");
      expect(await avoContract.signersCount()).to.equal(11);

      // remove certain signers including last one
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.removeSigners(
              [
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000005",
                "0x0000000000000000000000000000000000000007",
                "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF",
              ],
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

      signers_ = await avoContract.signers();
      expect(signers_[0]).to.equal("0x0000000000000000000000000000000000000001");
      expect(signers_[1]).to.equal("0x0000000000000000000000000000000000000003");
      expect(signers_[2]).to.equal("0x0000000000000000000000000000000000000004");
      expect(signers_[3]).to.equal("0x0000000000000000000000000000000000000009");
      expect(signers_[4]).to.equal("0x0000000000000000000000000000000000000011");
      expect(signers_[5]).to.equal("0x0000000000000000000000000000000000000012");
      expect(signers_[6]).to.equal(user1.address);
      expect(await avoContract.signersCount()).to.equal(7);

      // remove certain signers including first one
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.removeSigners(
              [
                "0x0000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000011",
              ],
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

      signers_ = await avoContract.signers();
      expect(signers_[0]).to.equal("0x0000000000000000000000000000000000000004");
      expect(signers_[1]).to.equal("0x0000000000000000000000000000000000000009");
      expect(signers_[2]).to.equal("0x0000000000000000000000000000000000000012");
      expect(signers_[3]).to.equal(user1.address);
      expect(await avoContract.signersCount()).to.equal(4);
    });

    it("should revert if not self-called", async () => {
      await expect(avoContract.removeSigners([user2.address], 1)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });

    it("should revert (with CastFailed) if signer to remove is not a signer", async () => {
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.removeSigners(["0x0000000000000000000000000000000000000002"], 1)
          ).data as string,
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

    it("should revert (with CastFailed) if signersCount would be < requiredSigners after execution", async () => {
      await testHelpers.executeActions(
        avoContract,
        user1,
        [(await avoContract.populateTransaction.setRequiredSigners(3)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["requiredSigners"]
      );

      const params: AvocadoMultisigStructs.CastParamsStruct = {
        ...TestHelpers.testParams.params,
        actions: [
          {
            target: avoContract.address,
            data: (await avoContract.populateTransaction.removeSigners([user2.address], 3)).data as string,
            operation: 0,
            value: 0,
          },
        ],
      };

      const result = await (
        await testHelpers.cast(user1, "", params, undefined, [
          {
            signer: user1.address,
            signature: testHelpers.testSignature(avoContract, user1, params),
          },
          {
            signer: user2.address,
            signature: testHelpers.testSignature(avoContract, user2, params),
          },
          {
            signer: user3.address,
            signature: testHelpers.testSignature(avoContract, user3, params),
          },
        ])
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(2);

      // event must be decoded because tx was executed through forwarder
      const log = AvocadoMultisig__factory.createInterface().parseLog(
        events[events.length - castEventPosFromLastForSigned]
      );

      expect(log.name).to.equal("CastFailed");
      // 0xec925985 = keccak256 selector for custom error AvocadoMultisig__InvalidParams()
      expect(log.args?.reason).to.equal("0_CUSTOM_ERROR: 0xec925985. PARAMS_RAW: ");
    });

    it("should revert if signers to remove are not ordered ascending", async () => {
      // execute addSigners(), must be executed through self-called
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000004",
                "0x0000000000000000000000000000000000000005",
              ],
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

      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (
            await avoContract.populateTransaction.removeSigners(
              [
                "0x0000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000004",
                "0x0000000000000000000000000000000000000002",
              ],
              1
            )
          ).data as string,
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

    it("should revert (with CastFailed) if signers array to remove is empty", async () => {
      // execute addSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.removeSigners([], 1)).data as string,
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

    it("should set requiredSigners", async () => {
      expect(await avoContract.requiredSigners()).to.equal(1);

      await testHelpers.executeActions(
        avoContract,
        user1,
        [(await avoContract.populateTransaction.removeSigners([user2.address], 2)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer", "requiredSigners"]
      );

      expect(await avoContract.requiredSigners()).to.equal(2);
    });

    it("should set requiredSigners if previous value is > than new signersCount", async () => {
      await testHelpers.executeActions(
        avoContract,
        user1,
        [(await avoContract.populateTransaction.setRequiredSigners(3)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["requiredSigners"]
      );
      expect(await avoContract.requiredSigners()).to.equal(3);

      const params: AvocadoMultisigStructs.CastParamsStruct = {
        ...TestHelpers.testParams.params,
        actions: [
          {
            target: avoContract.address,
            // required signers is 3 and is reduced to 2 after removing the signer user2
            data: (await avoContract.populateTransaction.removeSigners([user2.address], 2)).data as string,
            operation: 0,
            value: 0,
          },
        ],
      };

      const result = await (
        await testHelpers.cast(
          user1,
          "",
          params,
          undefined,
          [
            {
              signer: user1.address,
              signature: testHelpers.testSignature(avoContract, user1, params),
            },
            {
              signer: user2.address,
              signature: testHelpers.testSignature(avoContract, user2, params),
            },
            {
              signer: user3.address,
              signature: testHelpers.testSignature(avoContract, user3, params),
            },
          ],
          undefined,
          undefined,
          undefined,
          ["_signersPointer", "signersCount", "requiredSigners"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(5);

      // event must be decoded because tx was executed through forwarder
      const log = AvocadoMultisig__factory.createInterface().parseLog(
        events[events.length - castEventPosFromLastForSigned]
      );

      expect(log.name).to.equal("CastExecuted");
      expect(await avoContract.requiredSigners()).to.equal(2);
    });

    it("should emit RequiredSignersSet", async () => {
      // execute removeSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.removeSigners([user2.address], 2)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(5);

      expect(events[1].event).to.equal("RequiredSignersSet");
      expect(events[1].args?.requiredSigners).to.equal(2);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
    });

    it("should revert if setting requiredSigners > signersCount", async () => {
      const signersCount = await avoContract.signersCount();

      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.removeSigners([user2.address], signersCount)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(2);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
      // 0xec925985 = keccak256 selector for custom error AvocadoMultisig__InvalidParams()
      expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal(
        "0_CUSTOM_ERROR: 0xec925985. PARAMS_RAW: "
      );
    });

    it("should revert if setting requiredSigners to 0", async () => {
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.removeSigners([user2.address], 0)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["signersCount", "_signersPointer", "requiredSigners"]
        )
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

  describe("setRequiredSigners", async () => {
    beforeEach(async () => {
      // add a lot of signers so required signers count can be increased
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(
              [
                "0x0000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000003",
                "0x0000000000000000000000000000000000000004",
                "0x0000000000000000000000000000000000000005",
                "0x0000000000000000000000000000000000000006",
              ],
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

    it("should setRequiredSigners", async () => {
      expect(await avoContract.requiredSigners()).to.equal(1);

      await testHelpers.executeActions(
        avoContract,
        user1,
        [(await avoContract.populateTransaction.setRequiredSigners(5)).data as string],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["requiredSigners"]
      );

      expect(await avoContract.requiredSigners()).to.equal(5);
    });

    it("should emit RequiredSignersSet", async () => {
      // execute setRequiredSigners(), must be executed through self-called
      const result = await (
        await testHelpers.executeActions(
          avoContract,
          user1,
          [(await avoContract.populateTransaction.setRequiredSigners(5)).data as string],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners"]
        )
      ).wait();

      const events = result.events as Event[];
      expect(events.length).to.equal(3);

      expect(events[0].event).to.equal("RequiredSignersSet");
      expect(events[0].args?.requiredSigners).to.equal(5);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
    });

    it("should return silently if value is already set", async () => {
      expect(await avoContract.requiredSigners()).to.equal(1);

      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.setRequiredSigners(1)).data as string,
        ])
      ).wait();

      expect(await avoContract.requiredSigners()).to.equal(1);

      const events = result.events as Event[];
      expect(events.length).to.equal(2);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
    });

    it("should revert if setting requiredSigners > signersCount", async () => {
      const signersCount = await avoContract.signersCount();

      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.setRequiredSigners(signersCount + 1)).data as string,
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

    it("should revert if setting requiredSigners to 0", async () => {
      const result = await (
        await testHelpers.executeActions(avoContract, user1, [
          (await avoContract.populateTransaction.setRequiredSigners(0)).data as string,
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

    it("should revert if not self-called", async () => {
      await expect(avoContract.setRequiredSigners(4)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });
  });

  describe("signers", async () => {
    it("should get signers", async () => {
      const signers = await avoContract.signers();
      expect(signers.length).to.equal(1);
      expect(signers[0]).to.equal(user1.address);
    });

    it("should get signers (multiple)", async () => {
      // execute addSigners(), must be executed through self-called
      await testHelpers.executeActions(
        avoContract,
        user1,
        [
          (
            await avoContract.populateTransaction.addSigners(sortAddressesAscending([user2.address, user3.address]), 1)
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer"]
      );

      const signers = await avoContract.signers();
      expect(signers.length).to.equal(3);
      expect(signers).to.contain(user1.address);
      expect(signers).to.contain(user2.address);
      expect(signers).to.contain(user3.address);
    });
  });
  //#endregion

  describe("initial signers state setup", async () => {
    it("should have requiredSigners = 1", async () => {
      expect(await avoContract.requiredSigners()).to.equal(1);
    });

    it("should have signersCount = 1", async () => {
      expect(await avoContract.signersCount()).to.equal(1);
    });

    it("should have owner as signer", async () => {
      const signers = await avoContract.signers();
      expect(signers.length).to.equal(1);
      expect(signers[0]).to.equal(user1.address);
    });

    it("should execute a transaction via owner signature", async () => {
      const result = await (await testHelpers.cast(user1, defaultTestSignature)).wait();

      const events = result.events as Event[];
      expect(events[events.length - 1]?.event).to.equal("Executed");
    });
  });

  describe("isValidSignature", async () => {
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
          // execute addSigners() to add user2 and mockSigner as signers
          (
            await (avoContract as IAvocadoMultisigV1 & AvocadoMultisig).populateTransaction.addSigners(
              sortAddressesAscending([user2.address, mockSigner.address]),
              // set requiredSigners() to 2
              2
            )
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "_signersPointer", "requiredSigners"]
      );
    });

    it("should return 0x1626ba7e for multiple valid signatures concat manually with prefix", async () => {
      const digest = await testHelpers.getSigDigest(avoContract, user1);
      const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);
      const signatureUser2 = await testHelpers.signEIP1271(avoContract, user2, digest);

      // // create 85 bytes length signature + signer combinations
      const signatureUser1To85Bytes = concat([arrayify(signatureUser1), arrayify(user1.address)]);
      const signatureUser2To85Bytes = concat([arrayify(signatureUser2), arrayify(user2.address)]);

      const signatureBytes =
        sortAddressesAscending([user1.address, user2.address])[0] == user1.address
          ? concat(["0xDEC0DE6520", signatureUser1To85Bytes, signatureUser2To85Bytes])
          : concat(["0xDEC0DE6520", signatureUser2To85Bytes, signatureUser1To85Bytes]);

      const result = await avoContract.isValidSignature(digest, signatureBytes);
      expect(result).to.equal(EIP1271MagicValue);
    });

    it("should return 0x1626ba7e for multiple valid signatures via abi.encode / decode", async () => {
      const digest = await testHelpers.getSigDigest(avoContract, user1);
      const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);
      const signatureUser2 = await testHelpers.signEIP1271(avoContract, user2, digest);

      const signaturesParams_: AvocadoMultisigStructs.SignatureParamsStruct[] =
        testHelpers.sortSignaturesParamsAscending([
          {
            signature: signatureUser1,
            signer: user1.address,
          },
          {
            signature: signatureUser2,
            signer: user2.address,
          },
        ]);

      const signatureBytes = ethers.utils.defaultAbiCoder.encode(
        ["tuple(bytes signature,address signer)[]"],
        [signaturesParams_]
      );

      const result = await avoContract.isValidSignature(digest, signatureBytes);
      expect(result).to.equal(EIP1271MagicValue);
    });

    it("should return 0x1626ba7e for multiple valid signatures with a smart contract signer", async () => {
      const digest = await testHelpers.getSigDigest(avoContract, user1);
      const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);
      const signatureUser3 = await testHelpers.signEIP1271(avoContract, user3, digest);

      // create 85 bytes length signature + signer combinations
      const signatureUser1To85Bytes = concat([arrayify(signatureUser1), arrayify(user1.address)]);
      const signatureMockSignerTo85Bytes = concat([arrayify(signatureUser3), arrayify(mockSigner.address)]);

      const signatureBytes =
        sortAddressesAscending([user1.address, mockSigner.address])[0] == user1.address
          ? concat(["0xDEC0DE6520", signatureUser1To85Bytes, signatureMockSignerTo85Bytes])
          : concat(["0xDEC0DE6520", signatureMockSignerTo85Bytes, signatureUser1To85Bytes]);

      const result = await avoContract.isValidSignature(digest, signatureBytes);
      expect(result).to.equal(EIP1271MagicValue);
    });

    it("should revert for multiple signatures when one is invalid", async () => {
      const digest = await testHelpers.getSigDigest(avoContract, user1);
      const signatureUser1 = await testHelpers.signEIP1271(avoContract, user1, digest);
      const signatureUser3 = await testHelpers.signEIP1271(avoContract, user3, digest); // user3 is not an allowed signer

      // create 85 bytes length signature + signer combinations
      const signatureUser1To85Bytes = concat([arrayify(signatureUser1), arrayify(user1.address)]);
      const signatureUser3To85Bytes = concat([arrayify(signatureUser3), arrayify(user3.address)]);

      const signatureBytes =
        sortAddressesAscending([user1.address, user3.address])[0] == user1.address
          ? concat(["0xDEC0DE6520", signatureUser1To85Bytes, signatureUser3To85Bytes])
          : concat(["0xDEC0DE6520", signatureUser3To85Bytes, signatureUser1To85Bytes]);

      expect(avoContract.isValidSignature(digest, signatureBytes)).to.be.revertedWith(
        "AvocadoMultisig__InvalidEIP1271Signature()"
      );
    });
  });

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
          return testHelpers.verifyAuthorized(avoContract, user1, signaturesParams, params, authorizedParams);
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
        authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams
      ) => {
        if (currMethod === "verify") {
          return testHelpers.testSignature(avoContract, signer, params, forwardParams);
        } else if (currMethod === "verifyAuthorized") {
          return testHelpers.testSignatureAuthorized(avoContract, signer, params, authorizedParams);
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

          chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, signer, chainAgnosticParams))
            .params;

          return testHelpers.testSignatureChainAgnostic(avoContract, signer, chainAgnosticParams);
        } else {
          throw new Error("NOT_IMPLEMENTED");
        }
      };

      it("should revert if not enough signatures", async () => {
        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                3
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        await expect(
          executeVerify([
            {
              signature: await buildCurrMethodSignature(user1),
              signer: user1.address,
            },
            {
              signature: await buildCurrMethodSignature(user2),
              signer: user2.address,
            },
          ])
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if not enough valid signatures (one by not allowed signer)", async () => {
        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                3
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        await expect(
          executeVerify([
            {
              signature: await buildCurrMethodSignature(user1),
              signer: user1.address,
            },
            {
              signature: await buildCurrMethodSignature(user2),
              signer: user2.address,
            },
            {
              signature: await buildCurrMethodSignature(broadcaster),
              signer: broadcaster.address,
            },
          ])
        ).to.be.revertedWith("AvocadoMultisig__InvalidSignature()");
      });

      it("should revert if duplicate valid signatures", async () => {
        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                3
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        await expect(
          executeVerify([
            {
              signature: await buildCurrMethodSignature(user1),
              signer: user1.address,
            },
            {
              signature: await buildCurrMethodSignature(user2),
              signer: user2.address,
            },
            {
              signature: await buildCurrMethodSignature(user2),
              signer: user2.address,
            },
          ])
        ).to.be.revertedWith("AvocadoMultisig__InvalidSignature()");
      });

      it("should verify valid signature correctly with max signers count", async () => {
        const addSignersCount = (await avoContract.MAX_SIGNERS_COUNT()).toNumber() - 1;

        const signers: Wallet[] = [];
        for (let i = 0; i < addSignersCount; i++) {
          signers[i] = Wallet.createRandom();
        }

        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending(signers.map((signer) => signer.address)),
                addSignersCount
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        const signatureParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [];

        for (let i = 0; i < addSignersCount; i++) {
          signatureParams[i] = {
            signature: await buildCurrMethodSignature(signers[i] as unknown as SignerWithAddress),
            signer: signers[i].address,
          };
        }

        expect(await executeVerify(testHelpers.sortSignaturesParamsAscending(signatureParams))).to.equal(true);
      });
    });
  }

  describe("verifyChainAgnostic", async () => {
    it("should build correct domain separator chain agnostic", async () => {
      const contractDomainSeparator = await avoContract.domainSeparatorV4ChainAgnostic();

      const domainSeparator = ethers.utils._TypedDataEncoder.hashDomain(
        await testHelpers.typedDataDomainChainAgnostic(avoContract)
      );

      expect(domainSeparator).to.equal(contractDomainSeparator);
    });

    it("should revert if only 1 chain agnostic action", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ];

      let chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams);
      // adjust chain agnostic hashes
      chainAgnosticHashes = [{ ...chainAgnosticHashes[1] }];

      await expect(
        avoForwarder.verifyChainAgnosticV1(
          user1.address,
          0,
          chainAgnosticParams[1],
          signaturesParams,
          chainAgnosticHashes
        )
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if chain id param is not network chain id", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(7245125),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      await expect(testHelpers.verifyChainAgnostic(avoContract, user1, chainAgnosticParams, 1, [])).to.be.revertedWith(
        testHelpers.avoError("InvalidParams")
      );
    });

    it("should revert if chainAgnosticHashes do not match", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ];

      // adjusting chainAgnosticParams at index 0, which results in a different hash for the cast on another chain
      chainAgnosticParams[0].params.metadata = toUtf8Bytes("different");

      await expect(
        testHelpers.verifyChainAgnostic(avoContract, user1, chainAgnosticParams, 1, signaturesParams)
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if chainAgnosticHashes chain ids are incorrect", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      let signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ] as AvocadoMultisigStructs.SignatureParamsStruct[];

      signaturesParams = testHelpers.sortSignaturesParamsAscending(signaturesParams);

      const paramsToCast = chainAgnosticParams[1];

      let chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams, 0);

      const result = await avoContract
        .connect(user1)
        .verifyChainAgnostic(paramsToCast, signaturesParams, chainAgnosticHashes);

      // should be valid here
      expect(result).to.equal(true);

      // modify a chain id, should become invalid
      chainAgnosticHashes = [
        {
          ...chainAgnosticHashes[0],
          chainId: BigNumber.from(7),
        },
        {
          // for params that are being executed, the hash would be correct
          ...chainAgnosticHashes[1],
        },
      ];

      await expect(
        avoContract.connect(user1).verifyChainAgnostic(paramsToCast, signaturesParams, chainAgnosticHashes)
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if chainAgnosticHash is found but is not for given chain id", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      let signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ] as AvocadoMultisigStructs.SignatureParamsStruct[];

      signaturesParams = testHelpers.sortSignaturesParamsAscending(signaturesParams);

      const paramsToCast = chainAgnosticParams[1];

      let chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams, 0);

      const result = await avoContract
        .connect(user1)
        .verifyChainAgnostic(paramsToCast, signaturesParams, chainAgnosticHashes);

      // should be valid here
      expect(result).to.equal(true);

      // modify a chain id, should become invalid
      chainAgnosticHashes = [
        {
          ...chainAgnosticHashes[0],
        },
        {
          // for params that are being executed, the hash would be WRONG
          ...chainAgnosticHashes[1],
          chainId: BigNumber.from(7),
        },
      ];

      await expect(
        avoContract.connect(user1).verifyChainAgnostic(paramsToCast, signaturesParams, chainAgnosticHashes)
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });
  });

  describe("castAuthorized", async () => {
    it("should revert on wrong avoNonce signature, with signer param ", async () => {
      const invalidSignature = await testHelpers.testSignatureAuthorized(
        avoContract,
        user1,
        {
          ...TestHelpers.testParams.params,
          avoNonce: 77, // setting wrong avoNonce
        },
        TestHelpers.testParams.authorizedParams
      );

      // params are sent with the actually correct nonce, just the signature uses a wrong nonce
      // to simulate malicious use. With signer, the recovered signer will mismatch the sent signer
      await expect(
        testHelpers.castAuthorized(avoContract, user1, [
          {
            signature: invalidSignature,
            signer: user1.address,
          },
        ])
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
    });

    it("should revert if signature not valid anymore", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const expiredParams = {
        ...TestHelpers.testParams.authorizedParams,
        validUntil: (currentBlock as any).timestamp - 10, // set already expired
      };

      const signature = await testHelpers.testSignatureAuthorized(avoContract, user1, undefined, expiredParams);

      await expect(
        testHelpers.castAuthorized(
          avoContract,
          user1,
          [
            {
              signature,
              signer: user1.address,
            },
          ],
          undefined,
          expiredParams
        )
      ).to.be.revertedWith("AvocadoMultisig__InvalidTiming");
    });

    it("should revert if signature not valid anymore and trying to make it appear as still valid", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const expiredParams = {
        ...TestHelpers.testParams.authorizedParams,
        validUntil: (currentBlock as any).timestamp - 10, // set already expired
      };

      const signature = await testHelpers.testSignatureAuthorized(avoContract, user1, undefined, expiredParams);

      await expect(
        testHelpers.castAuthorized(
          avoContract,
          user1,
          [
            {
              signature,
              signer: user1.address,
            },
          ],
          TestHelpers.testParams.params,
          // set correct time here that would still be valid
          TestHelpers.testParams.authorizedParams
        )
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if not valid yet", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const tooEarlyParams = {
        ...TestHelpers.testParams.authorizedParams,
        validAfter: (currentBlock as any).timestamp + 100, // set to after next block timestamp
      };

      const signature = await testHelpers.testSignatureAuthorized(avoContract, user1, undefined, tooEarlyParams);

      await expect(
        testHelpers.castAuthorized(
          avoContract,
          user1,
          [
            {
              signature,
              signer: user1.address,
            },
          ],
          undefined,
          tooEarlyParams
        )
      ).to.be.revertedWith("AvocadoMultisig__InvalidTiming");
    });

    it("should revert if signature is not valid yet and trying to make it appear as already valid", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const tooEarlyParams = {
        ...TestHelpers.testParams.authorizedParams,
        validAfter: (currentBlock as any).timestamp + 100, // set to after next block timestamp
      };

      const signature = await testHelpers.testSignatureAuthorized(avoContract, user1, undefined, tooEarlyParams);

      await expect(
        testHelpers.castAuthorized(
          avoContract,
          user1,
          [
            {
              signature,
              signer: user1.address,
            },
          ],
          TestHelpers.testParams.params,
          // set correct time here that would still be valid
          TestHelpers.testParams.authorizedParams
        )
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should execute when called with proper authorization", async () => {
      const result = await (await testHelpers.executeActions(avoContract, user1, [TestHelpers.testAction])).wait();
      const events = result.events as Event[];
      expect(events.length).to.equal(2);

      expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");
    });

    describe("decode errors to revertReason", async () => {
      let mockErrorThrower: MockErrorThrower;
      beforeEach(async () => {
        // deploy MockErrorThrower contract
        const mockErrorThrowerFactory = (await ethers.getContractFactory(
          "MockErrorThrower",
          user1
        )) as MockErrorThrower__factory;
        mockErrorThrower = await mockErrorThrowerFactory.deploy();
        await mockErrorThrower.deployed();
      });

      const executeExpectReason = async (calldata: string, expectReason: string) => {
        const result = await (
          await testHelpers.executeActions(
            avoContract,
            user1,
            [
              {
                target: mockErrorThrower.address,
                data: calldata,
                value: 0,
                operation: 0,
              },
            ],
            undefined,
            undefined,
            500000 // set gas limit for out of gas test to not take too long
          )
        ).wait();

        const events = result.events as Event[];
        const castEvent = events[events.length - castEventPosFromLastForAuthorized];
        expect(castEvent.event).to.equal("CastFailed");
        expect(castEvent.args?.reason).to.equal(expectReason);
      };

      it("should handle Custom Error with 3x Uint256", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwCustomError3xUint256()
          ).data as string,
          // 0xb96c3800 = keccak256 selector for CustomError3xUint256(uint256,uint256,uint256)
          "0_CUSTOM_ERROR: 0xb96c3800. PARAMS_RAW: 000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003"
        );
      });

      it("should handle Custom Error with String", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwCustomErrorString()
          ).data as string,
          // 0x6e1af1ff = keccak256 selector for CustomErrorString(string)
          "0_CUSTOM_ERROR: 0x6e1af1ff. PARAMS_RAW: 000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000167468726f77437573746f6d4572726f72537472696e6700000000000000000000"
        );
      });

      it("should handle Custom Error with String when String too long", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwCustomErrorStringTooLong()
          ).data as string,
          // 0x6e1af1ff = keccak256 selector for CustomErrorString(string)
          "0_CUSTOM_ERROR: 0x6e1af1ff. PARAMS_RAW: 000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000001067468726f77437573746f6d4572726f72537472696e675665727956657279566572795665727956657279"
        );
      });

      it("should handle Out of gas error", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwOutOfGas()
          ).data as string,
          "AVO__OUT_OF_GAS"
        );
      });

      it("should handle panic error (assert) with code 0x01", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwPanic0x01()
          ).data as string,
          "0_TARGET_PANICKED: 0x01"
        );
      });

      it("should handle panic error (assert) with code 0x12", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwPanic0x12()
          ).data as string,
          "0_TARGET_PANICKED: 0x12"
        );
      });

      it("should handle require error (Error(string))", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwRequire()
          ).data as string,
          "0_throwRequire"
        );
      });

      it("should handle revert reason with string that is too long (truncate)", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwTooLongRequire()
          ).data as string,
          "0_" +
            "throwRequireVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryVeryLong".slice(
              0,
              250
            )
        );
      });

      it("should handle no revert reason", async () => {
        await executeExpectReason(
          (
            await mockErrorThrower.populateTransaction.throwUnknown()
          ).data as string,
          "0_REASON_NOT_DEFINED"
        );
      });
    });

    describe("pay fee logic", async () => {
      const defaultFeeAbs = parseEther("0.1");
      beforeEach(async () => {
        // set absolute fee (mode 1) with 0.1 ether as fee, setting user2 as fee collector address
        // note other fee mode tests are implemented in AvoRegistry.test, modes do not have to be tested here
        await avoRegistry.updateFeeConfig({ fee: defaultFeeAbs, feeCollector: user2.address, mode: 1 });
        // send some eth to AvoWallet to fund fee payments
        await owner.sendTransaction({ to: avoContract.address, value: parseEther("10") });
      });

      it("should pay fee when actions are executed", async () => {
        const avoBalanceBefore = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceBefore = (await owner.provider?.getBalance(user2.address)) as BigNumber;

        await testHelpers.executeActions(avoContract, user1, [TestHelpers.testAction]);

        const avoBalanceAfter = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceAfter = (await owner.provider?.getBalance(user2.address)) as BigNumber;

        expect(avoBalanceBefore.sub(avoBalanceAfter).eq(defaultFeeAbs)).to.equal(true);
        expect(feeCollectorBalanceAfter.sub(feeCollectorBalanceBefore).eq(defaultFeeAbs)).to.equal(true);
      });

      it("should pay fee when actions fail", async () => {
        const avoBalanceBefore = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceBefore = (await owner.provider?.getBalance(user2.address)) as BigNumber;

        // deploy wallets through AvoFactory as test calls with a failing action
        const iface = new ethers.utils.Interface(AvoFactory__factory.abi);
        // deploy wallets through AvoFactory as test calls with a failing action
        const result = await (
          await testHelpers.executeActions(avoContract, user1, [
            iface.encodeFunctionData("deploy", [user2.address, 0]),
            // contract can not be owner of a AvoWallet -> should Fail
            iface.encodeFunctionData("deploy", [avoContract.address, 0]),
          ])
        ).wait();
        expect((result.events as Event[])[(result.events as Event[]).length - 2]?.event).to.equal("CastFailed");

        const avoBalanceAfter = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceAfter = (await owner.provider?.getBalance(user2.address)) as BigNumber;

        expect(avoBalanceBefore.sub(avoBalanceAfter).eq(defaultFeeAbs)).to.equal(true);
        expect(feeCollectorBalanceAfter.sub(feeCollectorBalanceBefore).eq(defaultFeeAbs)).to.equal(true);
      });

      it("should emit FeePaid", async () => {
        const result = await (await testHelpers.executeActions(avoContract, user1, [TestHelpers.testAction])).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(2);

        expect(events[1].event).to.equal("FeePaid");
        expect(events[1].args?.fee).to.equal(defaultFeeAbs);
      });

      it("should revert if fee is > maxFee", async () => {
        await expect(
          testHelpers.executeActions(avoContract, user1, [TestHelpers.testAction], undefined, {
            ...TestHelpers.testParams.authorizedParams,
            maxFee: parseEther("0.099999"),
          })
        ).to.be.revertedWith(`AvocadoMultisig__MaxFee(${defaultFeeAbs}, ${parseEther("0.099999")})`);
      });

      it("should revert with AvocadoMultisig__InsufficientBalance if Avo contract does not have sufficient funds for paying the fee", async () => {
        // empty Avo contract balance except for 1 wei
        await testHelpers.executeActions(avoContract, user1, [
          {
            target: user1.address,
            data: "0x",
            operation: 0,
            value: (await ethers.provider.getBalance(avoContract.address)).sub(defaultFeeAbs).sub(1),
          },
        ]);
        expect((await ethers.provider.getBalance(avoContract.address)).eq(1)).to.equal(true);

        await expect(testHelpers.executeActions(avoContract, user1, [TestHelpers.testAction])).to.be.revertedWith(
          "AvocadoMultisig__InsufficientBalance"
        );
      });

      it("should use AUTHORIZED_MIN_FEE & AUTHORIZED_FEE_COLLECTOR if AvoRegistry calcFee reverts", async () => {
        // fee config is at storage slot 101. Set fee mode to 2 which is not implemented, causing calcFee to revert
        const storageSlot101Value = await user1.provider?.getStorageAt(avoRegistry.address, 101);
        // fee mode is set to 1, feeCollector is user2.address. so we can replace with:
        await network.provider.send("hardhat_setStorageAt", [
          avoRegistry.address,
          "0x65", // = storage slot 101 in hex
          storageSlot101Value?.replace(
            `1${user2.address.toLowerCase().slice(2)}`,
            `2${user2.address.toLowerCase().slice(2)}`
          ),
        ]);
        expect((await avoRegistry.feeConfig()).mode).to.equal(2);

        const avoBalanceBefore = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceBefore = (await owner.provider?.getBalance(user2.address)) as BigNumber;
        const backupFeeCollectorBalanceBefore = (await owner.provider?.getBalance(
          backupFeeCollector.address
        )) as BigNumber;

        const result = await (await testHelpers.executeActions(avoContract, user1, [TestHelpers.testAction])).wait();

        // expect tx to have been executed normally
        const events = result.events as Event[];
        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");

        const avoBalanceAfter = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceAfter = (await owner.provider?.getBalance(user2.address)) as BigNumber;
        const backupFeeCollectorBalanceAfter = (await owner.provider?.getBalance(
          backupFeeCollector.address
        )) as BigNumber;

        expect(avoBalanceBefore.sub(avoBalanceAfter).eq(defaultAuthorizedMinFee)).to.equal(true);
        expect(feeCollectorBalanceBefore.eq(feeCollectorBalanceAfter)).to.equal(true);
        expect(
          backupFeeCollectorBalanceAfter.sub(backupFeeCollectorBalanceBefore).eq(defaultAuthorizedMinFee)
        ).to.equal(true);
      });

      const testUsesFallbackForMockRegistry = async (registryAddress: string, expectFallback = true) => {
        const newSecondaryContract = (
          await testHelpers.deployAvocadoMultisigSecondaryContract(
            owner.address,
            registryAddress,
            avoForwarder.address,
            avoConfigV1,
            avoSignersList.address
          )
        ).address;
        const newLogicContract = (
          await testHelpers.deployAvocadoMultisigContract(
            owner.address,
            registryAddress,
            avoForwarder.address,
            avoConfigV1,
            avoSignersList.address,
            newSecondaryContract
          )
        ).address;

        // set it as valid version in registry

        await avoRegistry.setAvoVersion(newLogicContract, true, true);

        // store expected estimated gas with normal registry function
        const estimateGasResult = await testHelpers.castAuthorizedEstimate(avoContract, user1);

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
        expect(avoImplAfter).to.equal(newLogicContract.toLowerCase());

        // execute and check that backup fee mode got triggered or not as expected
        const avoBalanceBefore = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceBefore = (await owner.provider?.getBalance(user2.address)) as BigNumber;
        const backupFeeCollectorBalanceBefore = (await owner.provider?.getBalance(
          backupFeeCollector.address
        )) as BigNumber;

        const result = await (
          await testHelpers.castAuthorized(
            avoContract,
            user1,
            undefined,
            undefined,
            undefined,
            estimateGasResult.add(50000).toNumber()
          )
        ).wait();

        // expect tx to have been executed normally
        const events = result.events as Event[];
        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");

        const avoBalanceAfter = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceAfter = (await owner.provider?.getBalance(user2.address)) as BigNumber;
        const backupFeeCollectorBalanceAfter = (await owner.provider?.getBalance(
          backupFeeCollector.address
        )) as BigNumber;

        if (expectFallback) {
          expect(avoBalanceBefore.sub(avoBalanceAfter).eq(defaultAuthorizedMinFee)).to.equal(true);
          expect(feeCollectorBalanceBefore.eq(feeCollectorBalanceAfter)).to.equal(true);
          expect(
            backupFeeCollectorBalanceAfter.sub(backupFeeCollectorBalanceBefore).eq(defaultAuthorizedMinFee)
          ).to.equal(true);
        } else {
          expect(avoBalanceBefore.sub(avoBalanceAfter).eq(defaultFeeAbs)).to.equal(true);
          expect(backupFeeCollectorBalanceBefore.eq(backupFeeCollectorBalanceAfter)).to.equal(true);
        }
      };

      it("should handle decodable AvoRegistry calcFee when returns too long data without fallback", async () => {
        // upgrade avo smart wallet to a logic contract where registry is set to the MockInvalidRegistryCalcFeeTooLong
        const mockInvalidRegistryCalcFeeTooLongFactory = (await ethers.getContractFactory(
          "MockInvalidRegistryCalcFeeTooLong",
          owner
        )) as MockInvalidRegistryCalcFeeTooLong__factory;
        const invalidRegistryCalcFee = await mockInvalidRegistryCalcFeeTooLongFactory.deploy();
        await invalidRegistryCalcFee.deployed();

        await testUsesFallbackForMockRegistry(invalidRegistryCalcFee.address, false);
      });

      it("should use fallback if AvoRegistry calcFee returns non-decodable too short data", async () => {
        // upgrade avo smart wallet to a logic contract where registry is set to the MockInvalidRegistryCalcFeeTooShort
        const mockInvalidRegistryCalcFeeTooShortFactory = (await ethers.getContractFactory(
          "MockInvalidRegistryCalcFeeTooShort",
          owner
        )) as MockInvalidRegistryCalcFeeTooShort__factory;
        const invalidRegistryCalcFee = await mockInvalidRegistryCalcFeeTooShortFactory.deploy();
        await invalidRegistryCalcFee.deployed();

        await testUsesFallbackForMockRegistry(invalidRegistryCalcFee.address);
      });

      it("should use fallback if AvoRegistry calcFee returns invalid address", async () => {
        // upgrade avo smart wallet to a logic contract where registry is set to the MockInvalidRegistryCalcFeeInvalidAddress
        const mockInvalidRegistryCalcFeeInvalidAddressFactory = (await ethers.getContractFactory(
          "MockInvalidRegistryCalcFeeInvalidAddress",
          owner
        )) as MockInvalidRegistryCalcFeeInvalidAddress__factory;
        const invalidRegistryCalcFee = await mockInvalidRegistryCalcFeeInvalidAddressFactory.deploy();
        await invalidRegistryCalcFee.deployed();

        await testUsesFallbackForMockRegistry(invalidRegistryCalcFee.address);
      });

      it("should use fallback if AvoRegistry calcFee runs out of gas", async () => {
        // upgrade avo smart wallet to a logic contract where registry is set to the MockInvalidRegistryCalcFeeInvalidAddress
        const mockInvalidRegistryCalcFeeAbuseGasFactory = (await ethers.getContractFactory(
          "MockInvalidRegistryCalcFeeAbuseGas",
          owner
        )) as MockInvalidRegistryCalcFeeAbuseGas__factory;
        const invalidRegistryCalcFee = await mockInvalidRegistryCalcFeeAbuseGasFactory.deploy();
        await invalidRegistryCalcFee.deployed();

        await testUsesFallbackForMockRegistry(invalidRegistryCalcFee.address);
      });

      it("should use AUTHORIZED_MAX_FEE if AvoRegistry calcFee returns a higher fee", async () => {
        // set a very high fee at AvoRegistry
        await avoRegistry.updateFeeConfig({
          fee: parseEther("10000"),
          feeCollector: user2.address,
          mode: 1,
        });

        const avoBalanceBefore = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceBefore = (await owner.provider?.getBalance(user2.address)) as BigNumber;

        await testHelpers.executeActions(avoContract, user1, [TestHelpers.testAction]);

        const avoBalanceAfter = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceAfter = (await owner.provider?.getBalance(user2.address)) as BigNumber;

        expect(avoBalanceBefore.sub(avoBalanceAfter).eq(defaultAuthorizedMaxFee)).to.equal(true);
        expect(feeCollectorBalanceAfter.sub(feeCollectorBalanceBefore).eq(defaultAuthorizedMaxFee)).to.equal(true);
      });

      it("should emit FeePayFailed but not revert when paying fee fails at feeCollector", async () => {
        const mockFailingFeeCollectorFactory = (await ethers.getContractFactory(
          "MockFailingFeeCollector",
          owner
        )) as MockFailingFeeCollector__factory;
        const mockFailingFeeCollector = await mockFailingFeeCollectorFactory.deploy();
        await mockFailingFeeCollector.deployed();

        // set failing fee collector at registry
        await avoRegistry.updateFeeConfig({
          fee: defaultFeeAbs,
          feeCollector: mockFailingFeeCollector.address,
          mode: 1,
        });

        const avoBalanceBefore = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceBefore = (await owner.provider?.getBalance(
          mockFailingFeeCollector.address
        )) as BigNumber;

        const result = await (await testHelpers.executeActions(avoContract, user1, [TestHelpers.testAction])).wait();

        const events = result.events as Event[];
        expect(events.length).to.equal(2);

        expect(events[1].event).to.equal("FeePayFailed");
        expect(events[1].args?.fee).to.equal(defaultFeeAbs);
        expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastExecuted");

        const avoBalanceAfter = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
        const feeCollectorBalanceAfter = (await owner.provider?.getBalance(
          mockFailingFeeCollector.address
        )) as BigNumber;

        expect(avoBalanceBefore.eq(avoBalanceAfter)).to.equal(true);
        expect(feeCollectorBalanceAfter.eq(feeCollectorBalanceBefore)).to.equal(true);
      });

      describe("out of gas", async () => {
        let actions: AvocadoMultisigStructs.ActionStruct[];

        beforeEach(async () => {
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
          actions = [
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
        });

        const estimateGas = async (params: AvocadoMultisigStructs.CastParamsStruct): Promise<BigNumber> => {
          return await testHelpers.castAuthorizedEstimate(
            avoContract as IAvocadoMultisigV1,
            user1,
            [
              {
                signer: user1.address,
                signature: testHelpers.testSignatureAuthorized(avoContract as IAvocadoMultisigV1, user1, {
                  ...params,
                  actions,
                }),
              },
            ],
            { ...params, actions }
          );
        };

        it("should emit CastFailed if action runs out of gas", async () => {
          // execute the same estimated tx with a gasLimit
          // because we block reserve gas in the cast calling method which will not be sent on to callTargets,
          // only adding 7k to gas estimate for gas limit is not enough
          const gasLimit = (await estimateGas(TestHelpers.testParams.params)).add(8500).toNumber();

          const result = await (
            await testHelpers.executeActions(avoContract, user1, actions, undefined, undefined, gasLimit)
          ).wait();

          const events = result.events as Event[];
          expect(events.length).to.be.greaterThanOrEqual(2);

          expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
          expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal("AVO__OUT_OF_GAS");
        });

        it("should emit CastFailed if action execution logic runs out of gas", async () => {
          // execute the same estimated tx with a gasLimit
          // because we block reserve gas in the cast calling method which will not be sent on to callTargets,
          // only adding 7k to gas estimate for gas limit is not enough
          const gasLimit = (await estimateGas(TestHelpers.testParams.params)).sub(1000).toNumber();

          const result = await (
            await testHelpers.executeActions(avoContract, user1, actions, undefined, undefined, gasLimit)
          ).wait();

          const events = result.events as Event[];
          expect(events.length).to.be.greaterThanOrEqual(2);

          expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
          expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal("AVO__OUT_OF_GAS");
        });

        it("should emit CastFailed if not enough gas for reserve gas", async () => {
          // execute the same estimated tx with a gasLimit
          // because we block reserve gas in the cast calling method which will not be sent on to callTargets,
          // only adding 7k to gas estimate for gas limit is not enough
          const gasLimit = (await estimateGas(TestHelpers.testParams.params)).sub(25000).toNumber();

          const result = await (
            await testHelpers.executeActions(avoContract, user1, actions, undefined, undefined, gasLimit)
          ).wait();

          const events = result.events as Event[];
          expect(events.length).to.be.greaterThanOrEqual(2);

          expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
          expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal("AVO__OUT_OF_GAS");
        });

        it("should dynamically allocate reserve gas for metadata", async () => {
          const params: AvocadoMultisigStructs.CastParamsStruct = {
            ...TestHelpers.testParams.params,
            metadata: toUtf8Bytes("test".repeat(5000)), // simulate huge metadata, length 20k -> gas cost for emit would be 160k
          };

          // second execute the same tx with a tight gasLimit. -> should run out of gas but CastFailed must be logged
          // even with huge metadata.
          const gasLimit = (await estimateGas(params)).sub(65000).toNumber();

          const result = await (
            await testHelpers.executeActions(avoContract, user1, params.actions, params, undefined, gasLimit)
          ).wait();

          const events = result.events as Event[];
          expect(events.length).to.be.greaterThanOrEqual(2);

          expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
          expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal("AVO__OUT_OF_GAS");
          expect(events[events.length - castEventPosFromLastForAuthorized].args?.metadata).to.equal(
            hexlify(params.metadata as BytesLike)
          );
        });

        it("should pay fee when actions execution runs out of gas", async () => {
          // second execute the same tx with a gasLimit
          // because we block reserve gas in the cast calling method which will not be sent on to callTargets,
          // only adding 7k to gas estimate for gas limit is not enough
          const gasLimit = (await estimateGas(TestHelpers.testParams.params)).add(8500).toNumber();

          const avoBalanceBefore = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
          const feeCollectorBalanceBefore = (await owner.provider?.getBalance(user2.address)) as BigNumber;

          const result = await (
            await testHelpers.executeActions(avoContract, user1, actions, undefined, undefined, gasLimit)
          ).wait();

          const avoBalanceAfter = (await owner.provider?.getBalance(avoContract.address)) as BigNumber;
          const feeCollectorBalanceAfter = (await owner.provider?.getBalance(user2.address)) as BigNumber;

          expect(avoBalanceBefore.sub(avoBalanceAfter).eq(defaultFeeAbs)).to.equal(true);
          expect(feeCollectorBalanceAfter.sub(feeCollectorBalanceBefore).eq(defaultFeeAbs)).to.equal(true);

          const events = result.events as Event[];
          expect(events.length).to.be.greaterThanOrEqual(2);

          expect(events[events.length - castEventPosFromLastForAuthorized].event).to.equal("CastFailed");
          expect(events[events.length - castEventPosFromLastForAuthorized].args?.reason).to.equal("AVO__OUT_OF_GAS");

          expect(events[1].event).to.equal("FeePaid");
          expect(events[1].args?.fee).to.equal(defaultFeeAbs);
        });
      });
    });
  });

  describe("cast", async () => {
    it("should revert if called by NOT forwarder", async () => {
      await expect(
        (avoContract as IAvocadoMultisigV1).cast(TestHelpers.testParams.params, TestHelpers.testParams.forwardParams, [
          {
            signature: await testHelpers.testSignature(avoContract, user1),
            signer: user1.address,
          },
        ])
      ).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });

    // @dev
    // it("should revert if forwarder does not send along gas as instructed in signed params", async () => {
    //   already implemented in AvoForwarder tests
    // });

    it("should revert on wrong avoNonce signature", async () => {
      const invalidSignature = await testHelpers.invalidNonceTestSignature(avoContract, user1);

      // params are sent with the actually correct nonce, just the signature uses a wrong nonce
      // to simulate malicious use. With signer, the recovered signer will mismatch the sent signer
      await expect(testHelpers.cast(user1, invalidSignature)).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if signature not valid anymore", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const expiredParams = {
        ...TestHelpers.testParams.forwardParams,
        validUntil: (currentBlock as any).timestamp - 10, // set already expired
      };

      const signature = await testHelpers.testSignature(avoContract, user1, undefined, expiredParams);

      await expect(testHelpers.cast(user1, signature, undefined, expiredParams)).to.be.revertedWith(
        "AvocadoMultisig__InvalidTiming"
      );
    });

    it("should revert if signature not valid anymore and trying to make it appear as still valid", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const expiredParams = {
        ...TestHelpers.testParams.forwardParams,
        validUntil: (currentBlock as any).timestamp - 10, // set already expired
      };

      const signature = await testHelpers.testSignature(avoContract, user1, undefined, expiredParams);

      await expect(
        testHelpers.cast(
          user1,
          signature,
          TestHelpers.testParams.params,
          // set correct time here that would still be valid
          TestHelpers.testParams.forwardParams
        )
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if not valid yet", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const tooEarlyParams = {
        ...TestHelpers.testParams.forwardParams,
        validAfter: (currentBlock as any).timestamp + 100, // set to after next block timestamp
      };

      const signature = await testHelpers.testSignature(avoContract, user1, undefined, tooEarlyParams);

      await expect(testHelpers.cast(user1, signature, undefined, tooEarlyParams)).to.be.revertedWith(
        "AvocadoMultisig__InvalidTiming"
      );
    });

    it("should revert if signature is not valid yet and trying to make it appear as already valid", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const tooEarlyParams = {
        ...TestHelpers.testParams.forwardParams,
        validAfter: (currentBlock as any).timestamp + 100, // set to after next block timestamp
      };

      const signature = await testHelpers.testSignature(avoContract, user1, undefined, tooEarlyParams);

      await expect(
        testHelpers.cast(
          user1,
          signature,
          TestHelpers.testParams.params,
          // set correct time here that would still be valid
          TestHelpers.testParams.forwardParams
        )
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });
  });

  describe("castChainAgnostic", async () => {
    it("should revert if chain id param is not network chain id", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(7245125),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ];

      await expect(
        testHelpers.castChainAgnostic(user1, "", chainAgnosticParams, 1, signaturesParams)
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if only 1 chain agnostic action", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ];

      let chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams);
      // adjust chain agnostic hashes
      chainAgnosticHashes = [{ ...chainAgnosticHashes[1] }];

      await expect(
        avoForwarder.executeChainAgnosticV1(
          user1.address,
          0,
          chainAgnosticParams[1],
          signaturesParams,
          chainAgnosticHashes
        )
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if chainAgnosticHashes do not match", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ];

      // adjusting chainAgnosticParams at index 0, which results in a different hash for the cast on another chain
      chainAgnosticParams[0].params.metadata = toUtf8Bytes("different");

      await expect(
        testHelpers.castChainAgnostic(user1, "", chainAgnosticParams, 1, signaturesParams)
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));
    });

    it("should revert if chainAgnosticHashes chain ids are incorrect", async () => {
      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      let signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ] as AvocadoMultisigStructs.SignatureParamsStruct[];

      signaturesParams = testHelpers.sortSignaturesParamsAscending(signaturesParams);

      const paramsToCast = chainAgnosticParams[1];

      const chainAgnosticHashesCorrect = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams, 0);
      // modify a chain id, should become invalid
      const chainAgnosticHashesModified = [
        {
          ...chainAgnosticHashesCorrect[0],
        },
        {
          ...chainAgnosticHashesCorrect[1],
          chainId: BigNumber.from(7),
        },
      ];

      await expect(
        avoForwarder.executeChainAgnosticV1(
          user1.address,
          0,
          paramsToCast,
          signaturesParams,
          chainAgnosticHashesModified
        )
      ).to.be.revertedWith(testHelpers.avoError("InvalidParams"));

      // ensure would work with correct chain ids
      await avoForwarder.executeChainAgnosticV1(
        user1.address,
        0,
        paramsToCast,
        signaturesParams,
        chainAgnosticHashesCorrect
      );
    });

    it("should revert if called by NOT forwarder", async () => {
      const chainAgnosticParams = [
        TestHelpers.testParams.chainAgnosticParams(3),
        TestHelpers.testParams.chainAgnosticParams(-1),
      ];

      await expect(
        (avoContract as IAvocadoMultisigV1).castChainAgnostic(
          chainAgnosticParams[1],
          [
            {
              signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
              signer: user1.address,
            },
          ],
          await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams)
        )
      ).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });

    // @dev
    // it("should revert if forwarder does not send along gas as instructed in signed params", async () => {
    //   already implemented in AvoForwarder tests
    // });

    it("should revert on wrong avoNonce signature", async () => {
      const chainAgnosticParams = [
        TestHelpers.testParams.chainAgnosticParams(3),
        TestHelpers.testParams.chainAgnosticParams(-1),
      ];

      chainAgnosticParams[1].params.avoNonce = 2777; // random avoNonce

      const invalidSignature = await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams);

      // params are sent with the actually correct nonce, just the signature uses a wrong nonce
      // to simulate malicious use. With signer, the recovered signer will mismatch the sent signer
      chainAgnosticParams[1].params.avoNonce = 0; // correct avoNonce
      await expect(testHelpers.castChainAgnostic(user1, invalidSignature, chainAgnosticParams, 1)).to.be.revertedWith(
        testHelpers.avoError("InvalidParams")
      );
    });

    it("should revert if signature not valid anymore", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const expiredParams = {
        ...TestHelpers.testParams.forwardParams,
        validUntil: (currentBlock as any).timestamp - 10, // set already expired
      };

      const chainAgnosticParams = [
        TestHelpers.testParams.chainAgnosticParams(3),
        TestHelpers.testParams.chainAgnosticParams(-1),
      ];
      chainAgnosticParams[1].forwardParams = expiredParams;

      const signature = await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams);

      await expect(testHelpers.castChainAgnostic(user1, signature, chainAgnosticParams, 1)).to.be.revertedWith(
        testHelpers.avoError("InvalidTiming")
      );
    });

    it("should revert if signature not valid anymore and trying to make it appear as still valid", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const expiredParams = {
        ...TestHelpers.testParams.forwardParams,
        validUntil: (currentBlock as any).timestamp - 10, // set already expired
      };

      const chainAgnosticParams = [
        TestHelpers.testParams.chainAgnosticParams(3),
        TestHelpers.testParams.chainAgnosticParams(-1),
      ];
      chainAgnosticParams[1].forwardParams = expiredParams;

      const signature = await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams);

      // set correct time when casting that would still be valid
      chainAgnosticParams[1].forwardParams = TestHelpers.testParams.forwardParams;

      await expect(testHelpers.castChainAgnostic(user1, signature, chainAgnosticParams, 1)).to.be.revertedWith(
        testHelpers.avoError("InvalidParams")
      );
    });

    it("should revert if not valid yet", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const tooEarlyParams = {
        ...TestHelpers.testParams.forwardParams,
        validAfter: (currentBlock as any).timestamp + 100, // set to after next block timestamp
      };

      const chainAgnosticParams = [
        TestHelpers.testParams.chainAgnosticParams(3),
        TestHelpers.testParams.chainAgnosticParams(-1),
      ];
      chainAgnosticParams[1].forwardParams = tooEarlyParams;

      const signature = await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams);

      await expect(testHelpers.castChainAgnostic(user1, signature, chainAgnosticParams, 1)).to.be.revertedWith(
        testHelpers.avoError("InvalidTiming")
      );
    });

    it("should revert if signature is not valid yet and trying to make it appear as already valid", async () => {
      const currentBlock = await owner.provider?.getBlock(await owner.provider?.getBlockNumber());

      const tooEarlyParams = {
        ...TestHelpers.testParams.forwardParams,
        validAfter: (currentBlock as any).timestamp + 100, // set to after next block timestamp
      };

      const chainAgnosticParams = [
        TestHelpers.testParams.chainAgnosticParams(3),
        TestHelpers.testParams.chainAgnosticParams(-1),
      ];
      chainAgnosticParams[1].forwardParams = tooEarlyParams;

      const signature = await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams);

      // set correct time when casting that would still be valid
      chainAgnosticParams[1].forwardParams = TestHelpers.testParams.forwardParams;

      await expect(testHelpers.castChainAgnostic(user1, signature, chainAgnosticParams, 1)).to.be.revertedWith(
        testHelpers.avoError("InvalidParams")
      );
    });
  });

  for (const currMethod of ["cast", "castAuthorized", "castChainAgnostic"]) {
    describe(`${currMethod} Test Suite:`, async () => {
      //#region local test helpers

      // helper method to execute actions based on `currMethod`
      const executeCurrMethod = async (
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

        if (currMethod === "cast") {
          return testHelpers.cast(user1, "", params, forwardParams, signaturesParams);
        } else if (currMethod === "castAuthorized") {
          return testHelpers.castAuthorized(avoContract, user1, signaturesParams, params, authorizedParams);
        } else if (currMethod === "castChainAgnostic") {
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

          return testHelpers.castChainAgnostic(user1, "", chainAgnosticParams, 1, signaturesParams);
        } else {
          throw new Error("NOT_IMPLEMENTED");
        }
      };

      const buildCurrMethodSignature = async (
        signer: SignerWithAddress,
        params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
        forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams,
        authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams
      ) => {
        if (currMethod === "cast") {
          return testHelpers.testSignature(avoContract, signer, params, forwardParams);
        } else if (currMethod === "castAuthorized") {
          return testHelpers.testSignatureAuthorized(avoContract, signer, params, authorizedParams);
        } else if (currMethod === "castChainAgnostic") {
          let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
            {
              ...TestHelpers.testParams.chainAgnosticParams(3),
            },
            {
              params,
              forwardParams,
              chainId: -1, // -1 will be set to current network chain id
            },
          ];

          chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, signer, chainAgnosticParams))
            .params;

          return testHelpers.testSignatureChainAgnostic(avoContract, signer, chainAgnosticParams);
        } else {
          throw new Error("NOT_IMPLEMENTED");
        }
      };

      it("should revert if not enough signatures", async () => {
        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                3
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        await expect(
          executeCurrMethod([
            {
              signature: await buildCurrMethodSignature(user1),
              signer: user1.address,
            },
            {
              signature: await buildCurrMethodSignature(user2),
              signer: user2.address,
            },
          ])
        ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
      });

      it("should revert if not enough valid signatures (one by not allowed signer)", async () => {
        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                3
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        await expect(
          executeCurrMethod([
            {
              signature: await buildCurrMethodSignature(user1),
              signer: user1.address,
            },
            {
              signature: await buildCurrMethodSignature(user2),
              signer: user2.address,
            },
            {
              signature: await buildCurrMethodSignature(broadcaster),
              signer: broadcaster.address,
            },
          ])
        ).to.be.revertedWith("AvocadoMultisig__InvalidSignature()");
      });

      it("should revert if duplicate valid signatures", async () => {
        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending([user2.address, user3.address]),
                3
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        await expect(
          executeCurrMethod([
            {
              signature: await buildCurrMethodSignature(user1),
              signer: user1.address,
            },
            {
              signature: await buildCurrMethodSignature(user2),
              signer: user2.address,
            },
            {
              signature: await buildCurrMethodSignature(user2),
              signer: user2.address,
            },
          ])
        ).to.be.revertedWith("AvocadoMultisig__InvalidSignature()");
      });

      it("should cast with with max signers count", async () => {
        const addSignersCount = (await avoContract.MAX_SIGNERS_COUNT()).toNumber() - 1;
        // -1 to set to maximum because owner is already a signer

        const signers: Wallet[] = [];
        for (let i = 0; i < addSignersCount; i++) {
          signers[i] = Wallet.createRandom();
        }

        // add signers
        await testHelpers.executeActions(
          avoContract,
          user1,
          [
            (
              await avoContract.populateTransaction.addSigners(
                sortAddressesAscending(signers.map((signer) => signer.address)),
                addSignersCount
              )
            ).data as string,
          ],
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          ["requiredSigners", "_signersPointer", "signersCount"]
        );

        const signatureParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [];

        for (let i = 0; i < addSignersCount; i++) {
          signatureParams[i] = {
            signature: await buildCurrMethodSignature(signers[i] as unknown as SignerWithAddress),
            signer: signers[i].address,
          };
        }

        const result = await (
          await executeCurrMethod(testHelpers.sortSignaturesParamsAscending(signatureParams))
        ).wait();

        const events = result.events as Event[];
        if (currMethod === "cast" || currMethod === "castChainAgnostic") {
          expect(events[events.length - 1].event).to.equal("Executed");
        } else {
          expect(events[events.length - 2].event).to.equal("CastExecuted");
        }
      });
    });
  }

  describe("simulateCastChainAgnostic", async () => {
    it("should validate chain id", async () => {
      // set up 0x000000000000000000000000000000000000dEaD signer
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [dEaDAddress],
      });
      const dEaD = await ethers.getSigner(dEaDAddress);

      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(543643643), // wrong chain id
        },
      ];
      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ];

      await expect(
        avoForwarder
          .connect(dEaD)
          .simulateChainAgnosticV1(
            user1.address,
            0,
            chainAgnosticParams[1],
            signaturesParams,
            await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams)
          )
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
    });

    it("should NOT revert on invalid chainAgnostic hashes, if current params not present", async () => {
      // set up 0x000000000000000000000000000000000000dEaD signer
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [dEaDAddress],
      });
      const dEaD = await ethers.getSigner(dEaDAddress);

      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];
      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      const chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams);

      const signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ];

      // adjust param sent wrongly
      chainAgnosticParams[1].params.metadata = toUtf8Bytes("somethingElse");

      const result = await (
        await avoForwarder
          .connect(dEaD)
          .simulateChainAgnosticV1(user1.address, 0, chainAgnosticParams[1], signaturesParams, chainAgnosticHashes)
      ).wait();
      expect((result.events as Event[])[(result.events as Event[]).length - 1].event).to.equal("Executed");
    });

    it("should revert if only 1 chain agnostic action", async () => {
      // set up 0x000000000000000000000000000000000000dEaD signer
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [dEaDAddress],
      });
      const dEaD = await ethers.getSigner(dEaDAddress);

      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];
      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      let chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams);

      const signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ];

      // adjust chain agnostic hashes
      chainAgnosticHashes = [{ ...chainAgnosticHashes[1] }];

      await expect(
        avoForwarder
          .connect(dEaD)
          .simulateChainAgnosticV1(user1.address, 0, chainAgnosticParams[1], signaturesParams, chainAgnosticHashes)
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
    });

    it("should revert if chainAgnosticHashes chain ids are incorrect", async () => {
      // set up 0x000000000000000000000000000000000000dEaD signer
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [dEaDAddress],
      });
      const dEaD = await ethers.getSigner(dEaDAddress);

      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
        .params;

      let signaturesParams = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(avoContract, user1, chainAgnosticParams),
          signer: user1.address,
        },
      ] as AvocadoMultisigStructs.SignatureParamsStruct[];

      signaturesParams = testHelpers.sortSignaturesParamsAscending(signaturesParams);

      const paramsToCast = chainAgnosticParams[1];

      const chainAgnosticHashesCorrect = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams, 0);
      // modify a chain id, should become invalid
      const chainAgnosticHashesModified = [
        {
          ...chainAgnosticHashesCorrect[0],
        },
        {
          ...chainAgnosticHashesCorrect[1],
          chainId: BigNumber.from(7),
        },
      ];

      await expect(
        avoForwarder
          .connect(dEaD)
          .simulateChainAgnosticV1(user1.address, 0, paramsToCast, signaturesParams, chainAgnosticHashesModified)
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams");

      // ensure would work with correct chain ids
      await avoForwarder
        .connect(dEaD)
        .simulateChainAgnosticV1(user1.address, 0, paramsToCast, signaturesParams, chainAgnosticHashesCorrect);
    });
  });

  for (const currMethod of ["simulateCast", "simulateCastChainAgnostic"]) {
    describe(`${currMethod} Test Suite:`, async () => {
      const buildCurrMethodSignatureParams = async (
        params = TestHelpers.testParams.params,
        forwardParams = TestHelpers.testParams.forwardParams,
        signers: SignerWithAddress[] = []
      ) => {
        if (!signers.length) {
          signers = [user1];
        }

        const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [];

        if (currMethod == "simulateCast") {
          for await (let signer of signers) {
            signaturesParams.push({
              signature: await testHelpers.testSignature(avoContract, signer, params, forwardParams),
              signer: signer.address,
            });
          }
        } else {
          let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
            {
              ...TestHelpers.testParams.chainAgnosticParams(3),
            },
            {
              params,
              forwardParams,
              chainId: -1, // will be set to correct current chain id
            },
          ];

          chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
            .params;

          for await (let signer of signers) {
            signaturesParams.push({
              signature: await testHelpers.testSignatureChainAgnostic(avoContract, signer, chainAgnosticParams),
              signer: signer.address,
            });
          }
        }

        return testHelpers.sortSignaturesParamsAscending(signaturesParams);
      };

      const simulateEstimateGasCurrMethod = async (
        params = TestHelpers.testParams.params,
        forwardParams = TestHelpers.testParams.forwardParams,
        signers: SignerWithAddress[] = [],
        sendSigsEmpty = false,
        sendEmptySignatureParams = false
      ) => {
        // ~10% gas is automatically added at forwarder.
        // only reduce by 8% here to account for calldata which is not included when forwarder "wastes" the 10%.
        // the reduced amount is used for comparing values with expected gas usage at execution.
        const ESTIMATION_GAS_MARGIN = 8;

        // set up 0x000000000000000000000000000000000000dEaD signer
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [dEaDAddress],
        });

        let signaturesParams = await buildCurrMethodSignatureParams(params, forwardParams, signers);

        if (sendSigsEmpty) {
          signaturesParams = signaturesParams.map((x) => ({
            ...x,
            signature: toUtf8Bytes(""),
          }));
        }
        if (sendEmptySignatureParams) {
          signaturesParams = [];
        }

        let estimateGasResult;
        if (currMethod == "simulateCast") {
          estimateGasResult = await avoForwarder
            .connect(await ethers.getSigner(dEaDAddress))
            .estimateGas.simulateV1(user1.address, 0, params, forwardParams, signaturesParams);
        } else {
          let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
            {
              ...TestHelpers.testParams.chainAgnosticParams(3),
            },
            {
              params,
              forwardParams,
              chainId: -1, // will be set to correct current chain id
            },
          ];

          chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
            .params;

          estimateGasResult = await avoForwarder
            .connect(await ethers.getSigner(dEaDAddress))
            .estimateGas.simulateChainAgnosticV1(
              user1.address,
              0,
              chainAgnosticParams[1],
              signaturesParams,
              await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams)
            );
        }

        return parseInt(((estimateGasResult.toNumber() * (100 - ESTIMATION_GAS_MARGIN)) / 100).toFixed(0));
      };

      const executeCurrMethod = async (
        params = TestHelpers.testParams.params,
        forwardParams = TestHelpers.testParams.forwardParams,
        signers: SignerWithAddress[] = [],
        gaslimit: number | undefined = undefined
      ) => {
        const signaturesParams = await buildCurrMethodSignatureParams(params, forwardParams, signers);

        if (currMethod == "simulateCast") {
          return testHelpers.cast(user1, "", params, forwardParams, signaturesParams, gaslimit, undefined, undefined, [
            "requiredSigners",
            "_signersPointer",
            "signersCount",
          ]);
        } else {
          let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
            {
              ...TestHelpers.testParams.chainAgnosticParams(3),
            },
            {
              params,
              forwardParams,
              chainId: -1, // will be set to correct current chain id
            },
          ];

          chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
            .params;

          return testHelpers.castChainAgnostic(
            user1,
            "",
            chainAgnosticParams,
            1,
            signaturesParams,
            gaslimit,
            undefined,
            undefined,
            ["requiredSigners", "_signersPointer", "signersCount"]
          );
        }
      };

      const simulateCurrMethod = async (
        params = TestHelpers.testParams.params,
        forwardParams = TestHelpers.testParams.forwardParams,
        fromDeadSigner = true,
        throughForwarder = true,
        validSig = true,
        validActions = true,
        signers: SignerWithAddress[] = [],
        useEstimateMethod = false
      ) => {
        // set up 0x000000000000000000000000000000000000dEaD signer
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [dEaDAddress],
        });
        const dEaD = await ethers.getSigner(dEaDAddress);

        if (!validActions) {
          params = {
            ...params,
            actions: [
              {
                target: avoFactory.address,
                // contract can not be owner of a AvoWallet -> should Fail
                data: (await avoFactory.populateTransaction.deploy(avoContract.address, 0)).data as string,
                value: 0,
                operation: 0,
              },
            ],
          };
        }

        let signaturesParams = await buildCurrMethodSignatureParams(params, forwardParams, signers);

        if (currMethod == "simulateCast") {
          if (!validSig) {
            signaturesParams = [
              {
                signature: await testHelpers.testSignature(avoContract, owner, params, forwardParams),
                signer: user1.address,
              },
            ];
          }

          if (throughForwarder) {
            if (useEstimateMethod) {
              return avoForwarder
                .connect(fromDeadSigner ? dEaD : owner)
                .estimateV1(user1.address, 0, params, forwardParams, signaturesParams);
            } else {
              return avoForwarder
                .connect(fromDeadSigner ? dEaD : owner)
                .simulateV1(user1.address, 0, params, forwardParams, signaturesParams);
            }
          } else {
            if (useEstimateMethod) {
              return (avoContract as IAvocadoMultisigV1)
                .connect(dEaD)
                .estimateCast(params, forwardParams, signaturesParams);
            } else {
              return (avoContract as IAvocadoMultisigV1)
                .connect(dEaD)
                .simulateCast(params, forwardParams, signaturesParams);
            }
          }
        } else {
          let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
            {
              ...TestHelpers.testParams.chainAgnosticParams(3),
            },
            {
              params,
              forwardParams,
              chainId: -1, // will be set to correct current chain id
            },
          ];

          chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avoContract, user1, chainAgnosticParams))
            .params;

          if (!validSig) {
            signaturesParams = [
              {
                signature: await testHelpers.testSignatureChainAgnostic(avoContract, owner, chainAgnosticParams),
                signer: user1.address,
              },
            ];
          }

          if (throughForwarder) {
            if (useEstimateMethod) {
              return avoForwarder
                .connect(fromDeadSigner ? dEaD : owner)
                .estimateChainAgnosticV1(
                  user1.address,
                  0,
                  chainAgnosticParams[1],
                  signaturesParams,
                  await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams)
                );
            } else {
              return avoForwarder
                .connect(fromDeadSigner ? dEaD : owner)
                .simulateChainAgnosticV1(
                  user1.address,
                  0,
                  chainAgnosticParams[1],
                  signaturesParams,
                  await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams)
                );
            }
          } else {
            if (useEstimateMethod) {
              return (avoContract as IAvocadoMultisigV1)
                .connect(dEaD)
                .estimateCastChainAgnostic(
                  chainAgnosticParams[1],
                  signaturesParams,
                  await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams)
                );
            } else {
              return (avoContract as IAvocadoMultisigV1)
                .connect(dEaD)
                .simulateCastChainAgnostic(
                  chainAgnosticParams[1],
                  signaturesParams,
                  await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams)
                );
            }
          }
        }
      };

      it("should revert if called by forwarder & NOT tx.origin dead signer", async () => {
        await expect(simulateCurrMethod(undefined, undefined, false, true)).to.be.revertedWith(
          "AvoForwarder__Unauthorized"
        );
      });

      it("should revert if called directly (unless dead signer)", async () => {
        await expect(simulateCurrMethod(undefined, undefined, false, false)).to.not.be.revertedWith(
          "AvocadoMultisig__Unauthorized"
        );
      });

      it("should NOT revert if called by msg.sender dead signer", async () => {
        await expect(simulateCurrMethod(undefined, undefined, true, false)).to.not.be.revertedWith(
          "AvocadoMultisig__Unauthorized"
        );
      });

      it("should estimate() revert if called by forwarder & NOT tx.origin dead signer", async () => {
        await expect(
          simulateCurrMethod(undefined, undefined, false, true, undefined, undefined, undefined, true)
        ).to.be.revertedWith("AvoForwarder__Unauthorized");
      });

      it("should estimate() revert if called directly (unless dead signer)", async () => {
        await expect(
          simulateCurrMethod(undefined, undefined, false, false, undefined, undefined, undefined, true)
        ).to.not.be.revertedWith("AvocadoMultisig__Unauthorized");
      });

      it("should estimate() NOT revert if called by msg.sender dead signer", async () => {
        await expect(
          simulateCurrMethod(undefined, undefined, true, false, undefined, undefined, undefined, true)
        ).to.not.be.revertedWith("AvocadoMultisig__Unauthorized");
      });

      it("should emit CastExecuted event as normally", async () => {
        const result = await (await simulateCurrMethod()).wait();

        const events = result.events as Event[];

        expect(events.length).to.equal(2);

        // event must be decoded because tx was executed through forwarder
        const log = AvocadoMultisig__factory.createInterface().parseLog(
          events[events.length - castEventPosFromLastForSigned]
        );

        expect(log.name).to.equal("CastExecuted");
      });

      it("should verify signatures normally if set", async () => {
        await expect(simulateCurrMethod(undefined, undefined, true, true, false)).to.be.revertedWith(
          "AvocadoMultisig__InvalidParams"
        );
      });

      it("should emit CastFailed event as normally", async () => {
        const result = await (await simulateCurrMethod(undefined, undefined, true, true, true, false)).wait();
        const events = result.events as Event[];
        expect(events.length).to.equal(2);
        // event must be decoded because tx was executed through forwarder
        const log = AvocadoMultisig__factory.createInterface().parseLog(
          events[events.length - castEventPosFromLastForSigned]
        );
        expect(log.name).to.equal("CastFailed");
        // 0x6e31ab6d = keccak256 selector for custom error AvoFactory__NotEOA()
        expect(log.args?.reason).to.equal("0_CUSTOM_ERROR: 0x6e31ab6d. PARAMS_RAW: ");
      });

      // it("should return success and revert reason", async () => {
      //  // already covered in AvoForwarder tests
      // });

      it("should not revert on invalid params: avoNonce", async () => {
        // invalid nonce
        const result = await (
          await simulateCurrMethod({
            ...TestHelpers.testParams.params,
            avoNonce: 27777, // random wrong nonce
          })
        ).wait();
        expect((result.events as Event[])[(result.events as Event[]).length - 1].event).to.equal("Executed");
      });

      it("should not revert on invalid params: validAfter", async () => {
        // invalid timing
        const result = await (
          await simulateCurrMethod(undefined, {
            ...TestHelpers.testParams.forwardParams,
            validAfter: 999999999999999,
          })
        ).wait();
        expect((result.events as Event[])[(result.events as Event[]).length - 1].event).to.equal("Executed");
      });

      it("should not revert on invalid params: validUntil", async () => {
        // invalid timing
        const result = await (
          await simulateCurrMethod(undefined, {
            ...TestHelpers.testParams.forwardParams,
            validUntil: 1,
          })
        ).wait();
        expect((result.events as Event[])[(result.events as Event[]).length - 1].event).to.equal("Executed");
      });

      it("should not check for insufficient gas sent by AvoForwarder", async () => {
        const result = await (
          await simulateCurrMethod(undefined, {
            ...TestHelpers.testParams.forwardParams,
            gas: 999999999999999,
          })
        ).wait();
        expect((result.events as Event[])[(result.events as Event[]).length - 1].event).to.equal("Executed");
      });

      describe("simulate: estimateGas", async () => {
        const MAX_GAS_DIFF = 15_000;

        it("should simulate estimateGas within tolerance of actual execution: EMPTY ACTION", async () => {
          // test with empty action
          let estimatedGas = await simulateEstimateGasCurrMethod();
          const result = await (await executeCurrMethod()).wait();
          const events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");
          let executedGas = result?.gasUsed?.toNumber();

          console.log("estimatedGas EMPTY ACTION", estimatedGas);
          console.log("executedGas EMPTY ACTION", executedGas);

          expect(estimatedGas).to.approximately(
            executedGas,
            MAX_GAS_DIFF,
            "EMPTY ACTION EXECUTION NOT WITHIN EXPECTED MAX GAS DIFF"
          );
          expect(estimatedGas).to.be.greaterThanOrEqual(executedGas);
        });

        it("should simulate estimateGas within tolerance of actual execution: ADD SIGNERS ACTION", async () => {
          // test with adding signers action
          const params = { ...TestHelpers.testParams.params };
          params.actions = [
            {
              data: (
                await avoContract.populateTransaction.addSigners(
                  sortAddressesAscending([user2.address, user3.address, owner.address, dEaDAddress]),
                  3 // increase required signers to 3
                )
              ).data as string,
              target: avoContract.address,
              operation: 0,
              value: 0,
            },
          ];

          let estimatedGas = await simulateEstimateGasCurrMethod(params);
          let result = await (await executeCurrMethod(params)).wait();
          let events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");

          let executedGas = result?.gasUsed?.toNumber();
          console.log("estimatedGas ADD SIGNERS", estimatedGas);
          console.log("executedGas ADD SIGNERS", executedGas);
          expect(estimatedGas).to.approximately(
            executedGas,
            MAX_GAS_DIFF,
            "ADD SIGNERS ACTION EXECUTION NOT WITHIN EXPECTED MAX GAS DIFF"
          );
          expect(estimatedGas).to.be.greaterThanOrEqual(executedGas);

          // test execute with multiple required signers (3)
          params.actions = [
            {
              data: (await avoContract.populateTransaction.setRequiredSigners(2)).data as string,
              target: avoContract.address,
              operation: 0,
              value: 0,
            },
          ];
          params.avoNonce = 1;

          estimatedGas = await simulateEstimateGasCurrMethod(params, undefined, [user1, user2, user3]);
          result = await (await executeCurrMethod(params, undefined, [user1, user2, user3])).wait();
          events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");

          executedGas = result?.gasUsed?.toNumber();
          console.log("estimatedGas ACTION WITH MULTIPLE SIGNERS (3)", estimatedGas);
          console.log("executedGas ACTION WITH MULTIPLE SIGNERS (3)", executedGas);
          expect(estimatedGas).to.approximately(
            executedGas,
            MAX_GAS_DIFF,
            "MULTIPLE SIGNERS ACTION EXECUTION NOT WITHIN EXPECTED MAX GAS DIFF"
          );
          expect(estimatedGas).to.be.greaterThanOrEqual(executedGas);
        });

        it("should SIMULATE verify sig gas usage for multiple signers (when signatures are not sent)", async () => {
          // @dev this test also verifies: should automatically simulate add gas estimation for
          // requiredSigners if signatureParams are sent as empty array

          // action: occupy 3 non-sequential nonces
          const params = { ...TestHelpers.testParams.params };
          params.actions = [
            {
              data: (
                await avoContract.populateTransaction.occupyNonSequentialNonces([
                  formatBytes32String("test1_1"),
                  formatBytes32String("test2_1"),
                  formatBytes32String("test3_1"),
                ])
              ).data as string,
              target: avoContract.address,
              operation: 0,
              value: 0,
            },
          ];

          // execute for 1 signer
          const estimatedGas1Signer = await simulateEstimateGasCurrMethod(params, undefined, undefined, true);
          const estimatedGas1SignerWithoutSignatureParams = await simulateEstimateGasCurrMethod(
            params,
            undefined,
            undefined,
            true,
            true
          );
          console.log("estimatedGas1Signer", estimatedGas1Signer);
          console.log("estimatedGas1SignerWithoutSignatureParams", estimatedGas1SignerWithoutSignatureParams);
          expect(estimatedGas1Signer).to.approximately(
            estimatedGas1SignerWithoutSignatureParams,
            500,
            "verify sig not simulated for empty signature params"
          );
          // test gas limit: add back the 8% that are reduced from estimate amount for comparison reasons in `simulateEstimateGasCurrMethod`
          let result = await (
            await executeCurrMethod(
              params,
              undefined,
              undefined,
              parseInt(((estimatedGas1Signer * 108) / 100).toFixed(0))
            )
          ).wait();
          let events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");
          const executedGas1Signer = result?.gasUsed?.toNumber();
          expect(estimatedGas1Signer).to.approximately(
            executedGas1Signer,
            MAX_GAS_DIFF,
            "GAS SIMULATE VS EXECUTE NOT WITHIN EXPECTED MAX GAS DIFF"
          );
          expect(estimatedGas1Signer).to.be.greaterThanOrEqual(executedGas1Signer);
          console.log("estimatedGas OCCUPY NONCES WITH 1 SIGNER", estimatedGas1Signer);
          console.log("executedGas OCCUPY NONCES WITH 1 SIGNER", executedGas1Signer);
          console.log("EXECUTION USES LESS GAS:", estimatedGas1Signer - executedGas1Signer);

          // add a few allowed signers and increase required signers to 2
          result = await (
            await executeCurrMethod({
              ...TestHelpers.testParams.params,
              avoNonce: 1,
              actions: [
                {
                  data: (
                    await avoContract.populateTransaction.addSigners(
                      sortAddressesAscending([user2.address, user3.address, owner.address, broadcaster.address]),
                      2 // increase required signers to 2
                    )
                  ).data as string,
                  target: avoContract.address,
                  operation: 0,
                  value: 0,
                },
              ],
            })
          ).wait();
          events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");
          console.log(" ------------------ Executed add signers ------------------ ");

          // ensure gas verify sig increases accordingly
          params.avoNonce = 2;
          params.actions = [
            {
              data: (
                await avoContract.populateTransaction.occupyNonSequentialNonces([
                  formatBytes32String("test1_2"),
                  formatBytes32String("test2_2"),
                  formatBytes32String("test3_2"),
                ])
              ).data as string,
              target: avoContract.address,
              operation: 0,
              value: 0,
            },
          ];
          const estimatedGas2Signer = await simulateEstimateGasCurrMethod(params, undefined, [user1, user2], true);
          const estimatedGas2SignerWithoutSignatureParams = await simulateEstimateGasCurrMethod(
            params,
            undefined,
            undefined,
            true,
            true
          );
          console.log("estimatedGas2Signer", estimatedGas2Signer);
          console.log("estimatedGas2SignerWithoutSignatureParams", estimatedGas2SignerWithoutSignatureParams);
          expect(estimatedGas2Signer).to.approximately(
            estimatedGas2SignerWithoutSignatureParams,
            500,
            "verify sig not simulated for empty signature params"
          );

          result = await (
            await executeCurrMethod(
              params,
              undefined,
              [user1, user2],
              parseInt(((estimatedGas2Signer * 108) / 100).toFixed(0))
            )
          ).wait();
          events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");
          const executedGas2Signer = result?.gasUsed?.toNumber();
          expect(estimatedGas2Signer).to.approximately(
            executedGas2Signer,
            MAX_GAS_DIFF,
            "GAS SIMULATE VS EXECUTE NOT WITHIN EXPECTED MAX GAS DIFF"
          );
          expect(estimatedGas2Signer).to.be.greaterThanOrEqual(executedGas2Signer);
          console.log("estimatedGas OCCUPY NONCES WITH 2 SIGNER", estimatedGas2Signer);
          console.log("executedGas OCCUPY NONCES WITH 2 SIGNER", executedGas2Signer);
          console.log("EXECUTION USES LESS GAS:", estimatedGas2Signer - executedGas2Signer);

          let executionIncreasedBy = executedGas2Signer - executedGas1Signer;
          let estimationIncreasedBy = estimatedGas2Signer - estimatedGas1Signer;
          console.log("EXECUTION from 1 signer to 2 signers increased by:", executionIncreasedBy);
          console.log("ESTIMATION from 1 signer to 2 signers increased by:", estimationIncreasedBy);
          expect(estimationIncreasedBy).to.approximately(executionIncreasedBy, 5000);

          // increase required signers to 3
          result = await (
            await executeCurrMethod(
              {
                ...TestHelpers.testParams.params,
                avoNonce: 3,
                actions: [
                  {
                    data: (await avoContract.populateTransaction.setRequiredSigners(3)).data as string,
                    target: avoContract.address,
                    operation: 0,
                    value: 0,
                  },
                ],
              },
              undefined,
              [user1, user2]
            )
          ).wait();
          events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");
          console.log(" ------------------ Executed increase required signers to 3 ------------------ ");

          // ensure gas verify sig increases accordingly
          params.avoNonce = 4;
          params.actions = [
            {
              data: (
                await avoContract.populateTransaction.occupyNonSequentialNonces([
                  formatBytes32String("test1_3"),
                  formatBytes32String("test2_3"),
                  formatBytes32String("test3_3"),
                ])
              ).data as string,
              target: avoContract.address,
              operation: 0,
              value: 0,
            },
          ];
          const estimatedGas3Signer = await simulateEstimateGasCurrMethod(
            params,
            undefined,
            [user1, user2, user3],
            true
          );
          const estimatedGas3SignerWithoutSignatureParams = await simulateEstimateGasCurrMethod(
            params,
            undefined,
            undefined,
            true,
            true
          );
          console.log("estimatedGas3Signer", estimatedGas3Signer);
          console.log("estimatedGas3SignerWithoutSignatureParams", estimatedGas3SignerWithoutSignatureParams);
          expect(estimatedGas3Signer).to.approximately(
            estimatedGas3SignerWithoutSignatureParams,
            500,
            "verify sig not simulated for empty signature params"
          );

          result = await (
            await executeCurrMethod(
              params,
              undefined,
              [user1, user2, user3],
              parseInt(((estimatedGas3Signer * 108) / 100).toFixed(0))
            )
          ).wait();
          events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");
          const executedGas3Signer = result?.gasUsed?.toNumber();
          console.log("estimatedGas OCCUPY NONCES WITH 3 SIGNER", estimatedGas3Signer);
          console.log("executedGas OCCUPY NONCES WITH 3 SIGNER", executedGas3Signer);
          console.log("EXECUTION USES LESS GAS:", estimatedGas3Signer - executedGas3Signer);
          expect(estimatedGas3Signer).to.approximately(
            executedGas3Signer,
            MAX_GAS_DIFF,
            "GAS SIMULATE VS EXECUTE NOT WITHIN EXPECTED MAX GAS DIFF"
          );
          expect(estimatedGas3Signer).to.be.greaterThanOrEqual(executedGas3Signer);

          executionIncreasedBy = executedGas3Signer - executedGas2Signer;
          estimationIncreasedBy = estimatedGas3Signer - estimatedGas2Signer;
          console.log("EXECUTION from 2 signer to 3 signers increased by:", executionIncreasedBy);
          console.log("ESTIMATION from 2 signer to 3 signers increased by:", estimationIncreasedBy);
          expect(estimationIncreasedBy).to.approximately(executionIncreasedBy, 5000);

          // test with max signers to ensure diff in calldata is accounted for
          const addSignersCount = (await avoContract.MAX_SIGNERS_COUNT()).toNumber() - 5;
          const signers: Wallet[] = [];
          for (let i = 0; i < addSignersCount; i++) {
            signers[i] = Wallet.createRandom();
          }
          // add signers
          result = await (
            await executeCurrMethod(
              {
                ...TestHelpers.testParams.params,
                avoNonce: 5,
                actions: [
                  {
                    data: (
                      await avoContract.populateTransaction.addSigners(
                        sortAddressesAscending(signers.map((signer) => signer.address)),
                        (await avoContract.MAX_SIGNERS_COUNT()).toNumber()
                      )
                    ).data as string,
                    target: avoContract.address,
                    operation: 0,
                    value: 0,
                  },
                ],
              },
              undefined,
              [user1, user2, user3]
            )
          ).wait();
          events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");
          console.log(" ------------------ Executed increase allowed and required signers to max ------------------ ");
          console.log("max signers", (await avoContract.MAX_SIGNERS_COUNT()).toNumber());
          console.log("requiredSigners", await avoContract.requiredSigners());
          const allowedSigners = await avoContract.signers();
          console.log("allowed signers", allowedSigners.length);

          // ensure gas verify sig increases accordingly
          const allRequiredSigners: SignerWithAddress[] = [
            user1,
            user2,
            user3,
            owner,
            broadcaster,
            ...(signers as any as SignerWithAddress[]),
          ];
          params.avoNonce = 6;
          params.actions = [
            {
              data: (
                await avoContract.populateTransaction.occupyNonSequentialNonces([
                  formatBytes32String("test1_Max"),
                  formatBytes32String("test2_Max"),
                  formatBytes32String("test3_Max"),
                ])
              ).data as string,
              target: avoContract.address,
              operation: 0,
              value: 0,
            },
          ];
          const estimatedGasMaxSigner = await simulateEstimateGasCurrMethod(
            params,
            undefined,
            allRequiredSigners,
            true
          );
          const estimatedGasMaxSignerWithoutSignatureParams = await simulateEstimateGasCurrMethod(
            params,
            undefined,
            undefined,
            true,
            true
          );
          console.log("estimatedGasMaxSigner", estimatedGasMaxSigner);
          console.log("estimatedGasMaxSignerWithoutSignatureParams", estimatedGasMaxSignerWithoutSignatureParams);
          expect(estimatedGasMaxSigner).to.approximately(
            estimatedGasMaxSignerWithoutSignatureParams,
            5000, // bigger allowed gas diff for max signers
            "verify sig not simulated for empty signature params"
          );

          result = await (
            await executeCurrMethod(
              params,
              undefined,
              allRequiredSigners,
              parseInt(((estimatedGasMaxSigner * 108) / 100).toFixed(0))
            )
          ).wait();
          events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("Executed");
          const executedGasMaxSigner = result?.gasUsed?.toNumber();
          console.log("estimatedGas OCCUPY NONCES WITH MAX SIGNER", estimatedGasMaxSigner);
          console.log("executedGas OCCUPY NONCES WITH MAX SIGNER", executedGasMaxSigner);
          console.log("EXECUTION USES LESS GAS:", estimatedGasMaxSigner - executedGasMaxSigner);
          expect(estimatedGasMaxSigner).to.approximately(
            executedGasMaxSigner,
            60_000, // bigger allowed gas diff for max signers
            "GAS SIMULATE VS EXECUTE NOT WITHIN EXPECTED MAX GAS DIFF"
          );
          expect(estimatedGasMaxSigner).to.be.greaterThanOrEqual(executedGasMaxSigner);

          executionIncreasedBy = executedGasMaxSigner - executedGas3Signer;
          estimationIncreasedBy = estimatedGasMaxSigner - estimatedGas3Signer;
          console.log("EXECUTION from 3 signer to max signers increased by:", executionIncreasedBy);
          console.log("ESTIMATION from 3 signer to max signers increased by:", estimationIncreasedBy);
          expect(estimationIncreasedBy).to.approximately(executionIncreasedBy, 50000); // bigger allowed gas diff for max signers
        });

        it("should simulate gas usage for non sequential nonce in verify sig", async () => {
          // should increase estimated gas usage by ~2.2k if nonce is non-sequential

          // execute some action to have avoNonce not as 0
          await executeCurrMethod();

          // action: occupy 3 non-sequential nonces
          const params = { ...TestHelpers.testParams.params };
          params.avoNonce = 1;
          params.actions = [
            {
              data: (
                await avoContract.populateTransaction.occupyNonSequentialNonces([
                  formatBytes32String("test1_1"),
                  formatBytes32String("test2_1"),
                  formatBytes32String("test3_1"),
                ])
              ).data as string,
              target: avoContract.address,
              operation: 0,
              value: 0,
            },
          ];

          // simulate with normal sequential nonce
          const estimatedGasSequential = await simulateEstimateGasCurrMethod(params, undefined, undefined, true);

          params.avoNonce = -1;
          const estimatedGasNonSequential = await simulateEstimateGasCurrMethod(params, undefined, undefined, true);

          console.log("estimatedGasSequential", estimatedGasSequential);
          console.log("estimatedGasNonSequential", estimatedGasNonSequential);
          console.log("estimatedGasNonSequential increased:", estimatedGasNonSequential - estimatedGasSequential);

          const expectedIncrease = 20_000 + 2_200; // -> 20k for SSTORE, 2_200 simulated add

          expect(estimatedGasSequential + expectedIncrease).to.approximately(
            estimatedGasNonSequential,
            1000,
            "NON SEQUENTIAL NONCE GAS SIMULATE NOT ADDED"
          );
        });
      });
    });
  }
});
