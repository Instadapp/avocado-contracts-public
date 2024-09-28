import { deployments, ethers, getNamedAccounts, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, constants, Event } from "ethers";
import { hexlify, solidityKeccak256, toUtf8Bytes } from "ethers/lib/utils";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import {
  AvoForwarder,
  AvoFactory__factory,
  IAvoFactory,
  AvoFactory,
  AvoForwarder__factory,
  IAvocadoMultisigV1,
  AvocadoMultisig,
  AvocadoMultisig__factory,
  IAvocadoMultisigV1__factory,
  AvoRegistry,
} from "../typechain-types";
import { expect, setupSigners, setupContract, sortAddressesAscending, dEaDAddress } from "./util";
import {
  AvocadoMultisigStructs,
  AvoForwarderStructs,
} from "../typechain-types/contracts/AvoForwarder.sol/AvoForwarder";
import { TestHelpers } from "./TestHelpers";

describe("AvoForwarder", () => {
  let avoFactory: IAvoFactory;
  let avoRegistry: AvoRegistry;
  let avoForwarder: AvoForwarder;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let broadcaster: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  let testHelpers: TestHelpers;

  beforeEach(async () => {
    ({ owner, user1, user2, user3, broadcaster, proxyAdmin } = await setupSigners());

    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
    avoRegistry = await setupContract<AvoRegistry>("AvoRegistryProxy", owner);
    avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", broadcaster);

    testHelpers = new TestHelpers(avoForwarder);
  });

  describe("deployment", async () => {
    it("should deploy AvoForwarder", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const avoForwarderDeployment = await deployments.get("AvoForwarder");
      const deployedCode = await ethers.provider.getCode(avoForwarderDeployment.address);
      expect(deployedCode).to.not.equal("0x");
    });

    it("should revert if avoFactory is set to zero address at deployment", async () => {
      const { deployer } = await getNamedAccounts();

      await expect(
        deployments.deploy("AvoForwarder", {
          from: deployer,
          args: [constants.AddressZero],
        })
      ).to.be.revertedWith("");
    });

    it("should have avoFactory address set", async () => {
      expect(await avoForwarder.avoFactory()).to.equal(avoFactory.address);
    });

    it("should have avocadoBytecode set", async () => {
      // get initial avocadoBytecode
      const avocadoBytecode = solidityKeccak256(["bytes"], [(await ethers.getContractFactory("Avocado")).bytecode]);

      expect(await avoForwarder.avocadoBytecode()).to.equal(avocadoBytecode);
    });

    it("should have initializer disabled on logic contract", async () => {
      const logicContractAddress = (await deployments.fixture(["AvoForwarder"]))["AvoForwarder"]?.address as string;

      const logicContract = (await ethers.getContractAt("AvoForwarder", logicContractAddress)) as AvoForwarder;

      // try to initialize, should fail because disabled
      await expect(logicContract.initialize(owner.address, [])).to.be.revertedWith(
        "Initializable: contract is already initialized"
      );
    });
  });

  describe("initialize", async () => {
    it("should revert if already initialized", async () => {
      await expect(avoForwarder.initialize(owner.address, [])).to.be.revertedWith(
        "Initializable: contract is already initialized"
      );
    });

    it("should set owner at initialize", async () => {
      expect(await avoForwarder.owner()).to.equal(owner.address);
    });

    context("from uninitialized state", async () => {
      let uninitializedForwarder: AvoForwarder;
      beforeEach(async () => {
        // custom deployment with proxy
        const { deployer } = await getNamedAccounts();

        const logicContractAddress = (await deployments.fixture(["AvoForwarder"]))["AvoForwarder"]?.address as string;

        // deploy proxy uninitialized
        const newProxyDeployment = await deployments.deploy("AvoForwarderProxy", {
          from: deployer,
          args: [logicContractAddress, proxyAdmin.address, toUtf8Bytes("")],
        });

        uninitializedForwarder = AvoForwarder__factory.connect(newProxyDeployment.address, owner);
      });

      it("should revert if initialized with owner set to zero address", async () => {
        await expect(uninitializedForwarder.initialize(constants.AddressZero, [])).to.be.revertedWith(
          "AvoForwarder__InvalidParams"
        );
      });

      it("should revert if reinitialized with a broadcaster set to zero address", async () => {
        await expect(uninitializedForwarder.initialize(user1.address, [constants.AddressZero])).to.be.revertedWith(
          "AvoForwarder__InvalidParams"
        );
      });

      it("should set allowed broadcasters", async () => {
        expect(await uninitializedForwarder.isBroadcaster(user2.address)).to.equal(false);
        expect(await uninitializedForwarder.isBroadcaster(owner.address)).to.equal(false);

        const result = await (
          await uninitializedForwarder.initialize(user1.address, [user2.address, owner.address])
        ).wait();

        expect(await uninitializedForwarder.isBroadcaster(user2.address)).to.equal(true);
        expect(await uninitializedForwarder.isBroadcaster(owner.address)).to.equal(true);

        const events = result.events as Event[];
        expect(events.length).to.equal(4);
        // pos 0 is OwnershipTransferred
        // pos 3 is Initialized
        expect(events[1].event).to.equal("BroadcasterUpdated");
        expect(events[1].args?.broadcaster).to.equal(user2.address);
        expect(events[1].args?.status).to.equal(true);
        expect(events[2].event).to.equal("BroadcasterUpdated");
        expect(events[2].args?.broadcaster).to.equal(owner.address);
        expect(events[2].args?.status).to.equal(true);
      });
    });
  });

  //#region AvocadoMultisig view methods
  describe("avoNonce (AvocadoMultisig)", async () => {
    const subject = async (index = 0) => {
      return avoForwarder.avoNonce(owner.address, index);
    };

    it("should retrieve avoNonce if AvocadoMultisig is deployed", async () => {
      // deploy Avocado through the factory to enable initialization
      await avoFactory.deploy(owner.address, 0);

      const avocadoMultisig = AvocadoMultisig__factory.connect(
        await avoForwarder.computeAvocado(owner.address, 0),
        owner
      ) as IAvocadoMultisigV1 & AvocadoMultisig;

      const signature = await testHelpers.testSignature(avocadoMultisig, owner);

      const nonceBefore = await subject();
      expect(nonceBefore).to.equal(0);

      await testHelpers.cast(owner, signature);

      const nonceAfter = await subject();

      expect(nonceAfter).to.equal(nonceBefore.add(1));
    });

    it("should retrieve avoNonce if AvocadoMultisig is deployed with index > 1", async () => {
      const index = 2;
      // deploy Avocado through the factory to enable initialization
      await avoFactory.deploy(owner.address, index);

      const avocadoMultisig = AvocadoMultisig__factory.connect(
        await avoForwarder.computeAvocado(owner.address, index),
        owner
      ) as IAvocadoMultisigV1 & AvocadoMultisig;

      const signature = await testHelpers.testSignature(avocadoMultisig, owner);

      const nonceBefore = await subject(index);
      expect(nonceBefore).to.equal(0);

      await testHelpers.cast(
        owner,
        signature,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        index
      );

      const nonceAfter = await subject(index);

      expect(nonceAfter).to.equal(nonceBefore.add(1));
    });

    it("should retrieve avoNonce if AvocadoMultisig is NOT deployed", async () => {
      expect(await subject()).to.equal(0);
    });

    it("should retrieve avoNonce if AvocadoMultisig is NOT deployed with index > 1", async () => {
      expect(await subject(2)).to.equal(0);
    });
  });

  describe("avocadoVersionName", async () => {
    const subject = (owner: string, index = 0) => {
      return avoForwarder.avocadoVersionName(owner, index);
    };

    it("should avocadoVersionName for deployed AvocadoMultisig", async () => {
      // deploy Avocado through the factory to enable initialization
      await avoFactory.deploy(owner.address, 0);

      const result = await subject(owner.address);
      expect(result).to.equal(testHelpers.domainSeparatorName);
    });

    it("should avocadoVersionName for deployed AvocadoMultisig with index > 1", async () => {
      const index = 2;
      // deploy Avocado through the factory to enable initialization
      await avoFactory.deploy(owner.address, index);

      const result = await subject(owner.address, index);
      expect(result).to.equal(testHelpers.domainSeparatorName);
    });

    it("should avocadoVersionName for not deployed yet", async () => {
      // ensure AvocadoMultisig is not deplyoed
      const expectedAddress = await avoForwarder.computeAvocado(owner.address, 0);
      expect(await ethers.provider.getCode(expectedAddress)).to.equal("0x");

      const result = await subject(owner.address);
      expect(result).to.equal(testHelpers.domainSeparatorName);
    });

    it("should avocadoVersionName for not deployed yet with index > 1", async () => {
      const index = 2;
      // ensure AvocadoMultisig is not deplyoed
      const expectedAddress = await avoForwarder.computeAvocado(owner.address, index);
      expect(await ethers.provider.getCode(expectedAddress)).to.equal("0x");

      const result = await subject(owner.address, index);
      expect(result).to.equal(testHelpers.domainSeparatorName);
    });
  });

  describe("avocadoVersion", async () => {
    const subject = (owner: string, index = 0) => {
      return avoForwarder.avocadoVersion(owner, index);
    };

    it("should avocadoVersion for deployed AvocadoMultisig", async () => {
      // deploy Avocado through the factory to enable initialization
      await avoFactory.deploy(owner.address, 0);

      const result = await subject(owner.address);
      expect(result).to.equal(testHelpers.domainSeparatorVersion);
    });

    it("should avocadoVersion for deployed AvocadoMultisig with index > 1", async () => {
      const index = 2;
      // deploy Avocado through the factory to enable initialization
      await avoFactory.deploy(owner.address, index);

      const result = await subject(owner.address, index);
      expect(result).to.equal(testHelpers.domainSeparatorVersion);
    });

    it("should avocadoVersion for not deployed yet", async () => {
      // ensure avocadoMultisig is not deplyoed
      const expectedAddress = await avoForwarder.computeAvocado(owner.address, 0);
      expect(await ethers.provider.getCode(expectedAddress)).to.equal("0x");

      const result = await subject(owner.address);
      expect(result).to.equal(testHelpers.domainSeparatorVersion);
    });

    it("should avocadoVersion for not deployed yet with index > 1", async () => {
      const index = 2;
      // ensure avocadoMultisig is not deplyoed
      const expectedAddress = await avoForwarder.computeAvocado(owner.address, index);
      expect(await ethers.provider.getCode(expectedAddress)).to.equal("0x");

      const result = await subject(owner.address, index);
      expect(result).to.equal(testHelpers.domainSeparatorVersion);
    });
  });

  describe("computeAvocado", async () => {
    const subject = (owner: string, index = 0) => {
      return avoForwarder.computeAvocado(owner, index);
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

  describe("getAvocadoChainAgnosticHashes", async () => {
    it("should getAvocadoChainAgnosticHashes when deployed", async () => {
      const hashes = await avoForwarder.callStatic.getAvocadoChainAgnosticHashes(user1.address, 0, [
        TestHelpers.testParams.chainAgnosticParams(3),
        TestHelpers.testParams.chainAgnosticParams(4),
      ]);
      expect(hashes.length).to.equal(2);
    });

    it("should getAvocadoChainAgnosticHashes when not deployed", async () => {
      const hashes = await avoForwarder.callStatic.getAvocadoChainAgnosticHashes(user2.address, 1, [
        TestHelpers.testParams.chainAgnosticParams(3),
        TestHelpers.testParams.chainAgnosticParams(4),
        TestHelpers.testParams.chainAgnosticParams(5),
      ]);
      expect(hashes.length).to.equal(3);
    });
  });
  //#endregion

  //#region AvocadoMultisig verify & execute interactions
  describe("verify", async () => {
    const subject = async (signature?: string, index = 0) => {
      if (!signature) {
        const verifyingContract = IAvocadoMultisigV1__factory.connect(
          await avoFactory.computeAvocado(owner.address, index),
          owner
        );

        signature = await testHelpers.testSignature(verifyingContract, owner);
      }

      // called without callStatic for easier testing of effects
      return avoForwarder.verifyV1(
        owner.address,
        index,
        TestHelpers.testParams.params,
        TestHelpers.testParams.forwardParams,
        [
          {
            signature,
            signer: owner.address,
          },
        ]
      );
    };

    it("should deploy Avocado if necessary", async () => {
      const expectedAddress = await avoFactory.computeAvocado(owner.address, 0);

      const getCodeBefore = await owner.provider?.getCode(expectedAddress);
      expect(getCodeBefore).to.equal("0x");

      const result = await (await subject()).wait();
      const events = result.events as Event[];
      expect(events.length).to.be.greaterThan(1);

      const getCodeAfter = await owner.provider?.getCode(expectedAddress);
      expect(getCodeAfter).to.not.equal("0x");

      const iface = new ethers.utils.Interface(AvoFactory__factory.abi);

      const parsedEvent = iface.parseLog({
        topics: events[events.length - 1].topics,
        data: events[events.length - 1].data,
      });
      expect(parsedEvent.name).to.equal("AvocadoDeployed");
    });

    it("should forward call verify on AvocadoMultisig", async () => {
      // test with invalid signature
      const verifyingContract = IAvocadoMultisigV1__factory.connect(
        await avoFactory.computeAvocado(owner.address, 0),
        owner
      );
      const invalidSignature = await testHelpers.invalidNonceTestSignature(verifyingContract, owner);

      try {
        await subject(invalidSignature);

        throw new Error("ENFORCE_CATCH");
      } catch (ex: any) {
        const iface = new ethers.utils.Interface(AvocadoMultisig__factory.abi);
        const parsedError = iface.parseError(ex.data);
        expect(parsedError.name).to.equal("AvocadoMultisig__InvalidParams");
      }
    });

    it("should forward call verify on AvocadoMultisig with index > 1", async () => {
      const index = 2;
      const expectedAddress = await avoFactory.computeAvocado(owner.address, index);

      // test with invalid signature
      const verifyingContract = IAvocadoMultisigV1__factory.connect(expectedAddress, owner);
      const invalidSignature = await testHelpers.invalidNonceTestSignature(verifyingContract, owner);

      try {
        await subject(invalidSignature, index);

        throw new Error("ENFORCE_CATCH");
      } catch (ex: any) {
        const iface = new ethers.utils.Interface(AvocadoMultisig__factory.abi);
        const parsedError = iface.parseError(ex.data);
        expect(parsedError.name).to.equal("AvocadoMultisig__InvalidParams");
      }
    });
  });

  describe("verifyChainAgnostic", async () => {
    const subject = async (deployed = true, valid = true, index = 0) => {
      let signer = deployed ? user1 : owner;
      const avocado = IAvocadoMultisigV1__factory.connect(
        await avoFactory.computeAvocado(signer.address, index),
        signer
      );

      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          params: TestHelpers.testParams.params,
          forwardParams: TestHelpers.testParams.forwardParams,
          chainId: -1, // will be set to current network chain id
        },
      ];

      chainAgnosticParams = (await testHelpers.valueToSignChainAgnostic(avocado, signer, chainAgnosticParams)).params;

      const signature = await testHelpers.testSignatureChainAgnostic(
        avocado,
        valid ? signer : user3,
        chainAgnosticParams
      );

      const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] =
        testHelpers.sortSignaturesParamsAscending([
          {
            signature: signature,
            signer: signer.address,
          },
        ]);

      const chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(signer, chainAgnosticParams, index);

      return avoForwarder.verifyChainAgnosticV1(
        signer.address,
        index,
        chainAgnosticParams[1],
        signaturesParams,
        chainAgnosticHashes
      );
    };

    it("should deploy Avocado if necessary", async () => {
      const expectedAddress = await avoFactory.computeAvocado(owner.address, 0);

      const getCodeBefore = await owner.provider?.getCode(expectedAddress);
      expect(getCodeBefore).to.equal("0x");

      const result = await (await subject(false)).wait();
      const events = result.events as Event[];
      expect(events.length).to.be.greaterThan(1);

      const getCodeAfter = await owner.provider?.getCode(expectedAddress);
      expect(getCodeAfter).to.not.equal("0x");
    });

    it("should forward call verify on AvocadoMultisig", async () => {
      // test with invalid signature
      try {
        await subject(true, false);

        throw new Error("ENFORCE_CATCH");
      } catch (ex: any) {
        const iface = new ethers.utils.Interface(AvocadoMultisig__factory.abi);
        const parsedError = iface.parseError(ex.data);
        expect(parsedError.name).to.equal("AvocadoMultisig__InvalidParams");
      }
    });

    it("should forward call verify on AvocadoMultisig with index > 1", async () => {
      try {
        await subject(false, false, 3);

        throw new Error("ENFORCE_CATCH");
      } catch (ex: any) {
        const iface = new ethers.utils.Interface(AvocadoMultisig__factory.abi);
        const parsedError = iface.parseError(ex.data);
        expect(parsedError.name).to.equal("AvocadoMultisig__InvalidParams");
      }
    });
  });

  for (const curMethod of ["simulateV1", "simulateChainAgnosticV1"]) {
    context(`for ${curMethod}:`, async () => {
      describe("simulate", async () => {
        //#region local test helpers
        const subject = async (
          index = 0,
          estimateGas = true,
          avoNonce = 0,
          gasLimit: number | undefined = undefined,
          shouldRevert = false
        ) => {
          const verifyingContract = AvocadoMultisig__factory.connect(
            await avoFactory.computeAvocado(user1.address, index),
            user1
          );

          const actions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: verifyingContract.address,
              data: (
                await verifyingContract.populateTransaction.addSigners(
                  sortAddressesAscending([user2.address, user3.address]),
                  1
                )
              ).data as string,
              value: 0,
              operation: shouldRevert ? 4 : 0, // trigger revert with non existing operation
            },
          ];
          const params = { ...TestHelpers.testParams.params, actions, avoNonce };

          // set up 0x000000000000000000000000000000000000dEaD signer
          await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [dEaDAddress],
          });
          const dEaD = await ethers.getSigner(dEaDAddress);

          if (curMethod === "simulateV1") {
            // use signature from some user that is not a signer
            const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [
              {
                signature: "0x",
                signer: user3.address,
              },
            ];

            if (estimateGas) {
              const previousBlockGasLimit = (await user1.provider?.getBlock(await user1.provider.getBlockNumber()))
                ?.gasLimit;

              return avoForwarder
                .connect(dEaD)
                .estimateGas.simulateV1(
                  user1.address,
                  index,
                  params,
                  TestHelpers.testParams.forwardParams,
                  signaturesParams,
                  {
                    gasLimit: gasLimit || previousBlockGasLimit,
                  }
                );
            } else {
              return avoForwarder
                .connect(dEaD)
                .callStatic.simulateV1(
                  user1.address,
                  index,
                  params,
                  TestHelpers.testParams.forwardParams,
                  signaturesParams
                );
            }
          } else {
            // simulateChainAgnostic
            let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
              {
                ...TestHelpers.testParams.chainAgnosticParams(3),
              },
              {
                params,
                forwardParams: TestHelpers.testParams.forwardParams,
                chainId: -1, // will be set to current network chain id
              },
            ];
            chainAgnosticParams = (
              await testHelpers.valueToSignChainAgnostic(
                IAvocadoMultisigV1__factory.connect(verifyingContract.address, user1),
                user1,
                chainAgnosticParams
              )
            ).params;

            const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] =
              testHelpers.sortSignaturesParamsAscending([
                {
                  signature: "0x",
                  signer: user3.address,
                },
                {
                  signature: "0x",
                  signer: user1.address,
                },
              ]);

            const chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(user1, chainAgnosticParams, index);

            if (estimateGas) {
              const previousBlockGasLimit = (await user1.provider?.getBlock(await user1.provider.getBlockNumber()))
                ?.gasLimit;

              return avoForwarder
                .connect(dEaD)
                .estimateGas.simulateChainAgnosticV1(
                  user1.address,
                  index,
                  chainAgnosticParams[1],
                  signaturesParams,
                  chainAgnosticHashes,
                  {
                    gasLimit: gasLimit || previousBlockGasLimit,
                  }
                );
            } else {
              return avoForwarder
                .connect(dEaD)
                .callStatic.simulateChainAgnosticV1(
                  user1.address,
                  index,
                  chainAgnosticParams[1],
                  signaturesParams,
                  chainAgnosticHashes
                );
            }
          }
        };
        //#endregion

        it("should estimate addSigners", async () => {
          const estimation = (await subject()) as BigNumber;
          expect(estimation.gt(0)).to.equal(true);
        });

        it("should revert on estimate addSigners with too low gas limit", async () => {
          const gasLimit = curMethod === "simulateV1" ? 45000 : 70000;
          await expect(subject(0, true, 0, gasLimit)).to.be.revertedWith(
            "Transaction reverted and Hardhat couldn't infer the reason."
          );
        });

        it("should estimate addSigners with a higher nonce", async () => {
          const estimation = (await subject(0, true, 155)) as BigNumber;
          expect(estimation.gt(0)).to.equal(true);
        });

        it("should estimate when actions revert", async () => {
          const estimation = (await subject(1, true, 0, undefined, true)) as BigNumber;
          expect(estimation.gte(180000)).to.equal(true);
        });

        it("should return expected values when already deployed", async () => {
          const result = (await subject(0, false)) as {
            castGasUsed_: BigNumber;
            deploymentGasUsed_: BigNumber;
            isDeployed_: boolean;
            success_: boolean;
            revertReason_: string;
          };

          expect(result.isDeployed_).to.equal(true);
          expect(result.success_).to.equal(true);
          expect(result.deploymentGasUsed_.lte(10000)).to.equal(true);
          expect(result.castGasUsed_.gte(10000)).to.equal(true);
        });

        it("should return expected values when not yet deployed", async () => {
          const result = (await subject(1, false)) as {
            castGasUsed_: BigNumber;
            deploymentGasUsed_: BigNumber;
            isDeployed_: boolean;
            success_: boolean;
            revertReason_: string;
          };
          expect(result.isDeployed_).to.equal(false);
          expect(result.success_).to.equal(true);
          expect(result.deploymentGasUsed_.gte(100000)).to.equal(true);
          expect(result.castGasUsed_.gte(10000)).to.equal(true);
        });

        it("should return expected values when actions revert", async () => {
          const result = (await subject(0, false, 0, undefined, true)) as {
            castGasUsed_: BigNumber;
            deploymentGasUsed_: BigNumber;
            isDeployed_: boolean;
            success_: boolean;
            revertReason_: string;
          };

          expect(result.isDeployed_).to.equal(true);
          expect(result.success_).to.equal(false);
          expect(result.deploymentGasUsed_.lte(10000)).to.equal(true);
          expect(result.revertReason_).to.equal("0_AVO__INVALID_ID_OR_OPERATION");
          expect(result.castGasUsed_.gte(10000)).to.equal(true);
        });
      });
    });
  }

  describe("simulateBatchV1", async () => {
    //#region local test helpers
    const subject = async (
      estimateGas = true,
      avoNonce = 0,
      gasLimit: number | undefined = undefined,
      shouldRevert = 0, // index of tx that should revert
      singleTx = false,
      continueOnRevert = true
    ) => {
      // set up 0x000000000000000000000000000000000000dEaD signer
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [dEaDAddress],
      });
      const dEaD = await ethers.getSigner(dEaDAddress);

      const avocado1 = AvocadoMultisig__factory.connect(await avoFactory.computeAvocado(user1.address, 0), user1);
      const avocado2 = AvocadoMultisig__factory.connect(await avoFactory.computeAvocado(user2.address, 1), user2);

      let actions: AvocadoMultisigStructs.ActionStruct[] = [
        {
          target: avocado1.address,
          data: (
            await avocado1.populateTransaction.addSigners(
              sortAddressesAscending([owner.address, user3.address]), // add owner and user3 as signers
              1
            )
          ).data as string,
          value: 0,
          operation: shouldRevert === 1 ? 4 : 0, // trigger revert with non existing operation. let first tx revert so continueOnRevert can be tested
        },
      ];
      const params1 = { ...TestHelpers.testParams.params, actions: [{ ...actions[0] }], avoNonce };

      // use signature from some user that is not a signer
      const signaturesParams1: AvocadoMultisigStructs.SignatureParamsStruct[] = [
        {
          signature: "0x",
          signer: user3.address,
        },
      ];

      actions[0].target = avocado2.address;
      actions[0].operation = shouldRevert === 2 ? 4 : 0; // trigger revert with non existing operation
      const params2 = { ...TestHelpers.testParams.params, actions, avoNonce };

      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          params: params2,
          forwardParams: TestHelpers.testParams.forwardParams,
          chainId: -1, // will be set to current network chain id
        },
      ];
      chainAgnosticParams = (
        await testHelpers.valueToSignChainAgnostic(
          avocado2 as unknown as IAvocadoMultisigV1,
          user2,
          chainAgnosticParams
        )
      ).params;

      const signaturesParams2: AvocadoMultisigStructs.SignatureParamsStruct[] = [
        {
          signature: "0x",
          signer: user3.address,
        },
      ];

      let batchParams: AvoForwarderStructs.ExecuteBatchParamsStruct[] = [
        {
          from: user1.address,
          index: 0,
          chainAgnosticHashes: [],
          params: { params: params1, forwardParams: TestHelpers.testParams.forwardParams, chainId: 0 },
          signaturesParams: signaturesParams1,
        },
        {
          from: user2.address, // different user
          index: 1, // not deployed yet
          chainAgnosticHashes: await testHelpers.getChainAgnosticHashes(user2, chainAgnosticParams, 1), // chain agnostic
          params: chainAgnosticParams[1],
          signaturesParams: signaturesParams2,
        },
      ];

      if (singleTx) {
        batchParams = batchParams.slice(0, 1);
      }

      if (estimateGas) {
        const previousBlockGasLimit = (await user1.provider?.getBlock(await user1.provider.getBlockNumber()))?.gasLimit;

        return avoForwarder.connect(dEaD).estimateGas.simulateBatchV1(batchParams, continueOnRevert, {
          gasLimit: gasLimit || previousBlockGasLimit,
        });
      } else {
        return avoForwarder.connect(dEaD).callStatic.simulateBatchV1(batchParams, continueOnRevert);
      }
    };
    //#endregion

    it("should estimate for multiple txs, deployed and undeployed, normal and chain agnostic", async () => {
      const estimation = (await subject()) as BigNumber;
      expect(estimation.toNumber()).to.approximately(987000, 10000);
    });

    it("should callStatic for multiple txs, deployed and undeployed, normal and chain agnostic", async () => {
      await subject(false);
    });

    it("should return expected values", async () => {
      const result = (await subject(false)) as AvoForwarderStructs.SimulateBatchResultStructOutput[];
      expect(result.length).to.be.equal(2);
      expect(result[0].castGasUsed.toNumber()).to.be.greaterThan(10000);
      expect(result[0].success).to.be.equal(true);
      expect(result[0].revertReason).to.be.equal("");
      expect(result[1].castGasUsed.toNumber()).to.be.greaterThan(10000);
      expect(result[1].success).to.be.equal(true);
      expect(result[1].revertReason).to.be.equal("");
    });

    it("should return expected values when an action reverts and flag continueOnRevert = true", async () => {
      const result = (await subject(
        false,
        0,
        undefined,
        1,
        false,
        true
      )) as AvoForwarderStructs.SimulateBatchResultStructOutput[];
      expect(result.length).to.be.equal(2);
      expect(result[0].castGasUsed.toNumber()).to.be.greaterThan(10000);
      expect(result[0].success).to.be.equal(false);
      expect(result[0].revertReason).to.be.equal("0_AVO__INVALID_ID_OR_OPERATION");
      expect(result[1].castGasUsed.toNumber()).to.be.greaterThan(10000);
      expect(result[1].success).to.be.equal(true);
      expect(result[1].revertReason).to.be.equal("");
    });

    it("should return expected values when an action reverts and flag continueOnRevert = false", async () => {
      const result = (await subject(
        false,
        0,
        undefined,
        1,
        false,
        false
      )) as AvoForwarderStructs.SimulateBatchResultStructOutput[];
      expect(result.length).to.be.equal(2);
      expect(result[0].castGasUsed.toNumber()).to.be.greaterThan(10000);
      expect(result[0].success).to.be.equal(false);
      expect(result[0].revertReason).to.be.equal("0_AVO__INVALID_ID_OR_OPERATION");
      expect(result[1].castGasUsed.toNumber()).to.be.equal(0);
      expect(result[1].success).to.be.equal(false);
      expect(result[1].revertReason).to.be.equal("");
    });

    it("should estimate when one tx reverts and flag continueOnRevert = true", async () => {
      // first tx reverts
      let estimation = (await subject(true, 0, undefined, 1, false, true)) as BigNumber;
      expect(estimation.toNumber()).to.approximately(760000, 10000);

      // second tx reverts
      estimation = (await subject(true, 0, undefined, 2, false, true)) as BigNumber;
      expect(estimation.toNumber()).to.approximately(772000, 10000);
    });

    it("should estimate when one tx reverts and flag continueOnRevert = false", async () => {
      const estimation = (await subject(true, 0, undefined, 1, false, false)) as BigNumber;
      expect(estimation.toNumber()).to.approximately(125000, 10000);
    });

    // it("should return expected values when actions revert", async () => {
    //   const result = (await subject(0, false, 0, undefined, true)) as {
    //     castGasUsed_: BigNumber;
    //     deploymentGasUsed_: BigNumber;
    //     isDeployed_: boolean;
    //     success_: boolean;
    //     revertReason_: string;
    //   };

    //   expect(result.isDeployed_).to.equal(true);
    //   expect(result.success_).to.equal(false);
    //   expect(result.deploymentGasUsed_.lte(10000)).to.equal(true);
    //   expect(result.revertReason_).to.equal("0_AVO__INVALID_ID_OR_OPERATION");
    //   expect(result.castGasUsed_.gte(10000)).to.equal(true);
    // });

    it("should revert for one tx", async () => {
      await expect(subject(true, 0, undefined, 0, true)).to.be.revertedWith("AvoForwarder__InvalidParams");
    });
  });

  for (const curMethod of ["executeV1", "executeChainAgnosticV1"]) {
    context(`for ${curMethod}:`, async () => {
      describe("execute", async () => {
        const subject = async (index = 0, successful = true) => {
          const verifyingContract = IAvocadoMultisigV1__factory.connect(
            await avoFactory.computeAvocado(owner.address, index),
            owner
          );

          const failingActions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: avoFactory.address,
              // contract can not be owner of a AvoWallet -> should Fail
              data: (await avoFactory.populateTransaction.deploy(verifyingContract.address, 0)).data as string,
              value: 0,
              operation: 0,
            },
          ];

          const params = successful
            ? TestHelpers.testParams.params
            : {
                ...TestHelpers.testParams.params,
                actions: failingActions,
              };

          if (curMethod === "executveV1") {
            const signature = await testHelpers.testSignature(verifyingContract, owner, params);

            return testHelpers.cast(
              owner,
              signature,
              params,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              index
            );
          } else {
            let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
              {
                ...TestHelpers.testParams.chainAgnosticParams(3),
              },
              {
                params,
                forwardParams: TestHelpers.testParams.forwardParams,
                chainId: -1, // will be set to current network chain id
              },
            ];

            chainAgnosticParams = (
              await testHelpers.valueToSignChainAgnostic(verifyingContract, owner, chainAgnosticParams)
            ).params;

            const signature = await testHelpers.testSignatureChainAgnostic(
              verifyingContract,
              owner,
              chainAgnosticParams
            );

            const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] =
              testHelpers.sortSignaturesParamsAscending([
                {
                  signature: signature,
                  signer: owner.address,
                },
              ]);

            return testHelpers.castChainAgnostic(
              owner,
              "",
              chainAgnosticParams,
              1,
              signaturesParams,
              undefined,
              undefined,
              undefined,
              undefined,
              index
            );
          }
        };

        it("should deploy Avocado if necessary", async () => {
          const expectedAddress = await avoFactory.computeAvocado(owner.address, 0);

          const getCodeBefore = await owner.provider?.getCode(expectedAddress);
          expect(getCodeBefore).to.equal("0x");

          const result = await (await subject()).wait();
          const events = result.events as Event[];
          expect(events.length).to.be.greaterThan(1);

          const getCodeAfter = await owner.provider?.getCode(expectedAddress);
          expect(getCodeAfter).to.not.equal("0x");

          const iface = new ethers.utils.Interface(AvoFactory__factory.abi);

          const parsedEvent = iface.parseLog({
            topics: events[events.length - 3].topics,
            data: events[events.length - 3].data,
          });
          expect(parsedEvent.name).to.equal("AvocadoDeployed");
        });

        it("should forward call cast on AvocadoMultisig", async () => {
          const result = await (await subject()).wait();
          const events = result.events as Event[];
          expect(events.length).to.be.greaterThan(1);

          const iface = new ethers.utils.Interface(AvocadoMultisig__factory.abi);

          const parsedEvent = iface.parseLog({
            topics: events[events.length - 2].topics,
            data: events[events.length - 2].data,
          });
          expect(parsedEvent.name).to.equal("CastExecuted");
        });

        it("should forward call cast on AvocadoMultisig with index > 0", async () => {
          const result = await (await subject(1)).wait();
          const events = result.events as Event[];
          expect(events.length).to.be.greaterThan(1);

          const iface = new ethers.utils.Interface(AvocadoMultisig__factory.abi);

          const parsedEvent = iface.parseLog({
            topics: events[events.length - 2].topics,
            data: events[events.length - 2].data,
          });
          expect(parsedEvent.name).to.equal("CastExecuted");
        });

        it("should emit event Executed on success", async () => {
          const result = await (await subject()).wait();
          const events = result.events as Event[];
          expect(events.length).to.be.greaterThan(1);

          const expectedAvocadoAddress = await avoFactory.computeAvocado(owner.address, 0);

          const event = events[events.length - 1];
          expect(event.event).to.equal("Executed");
          expect(event.args?.avocadoOwner).to.equal(owner.address);
          expect(event.args?.avocadoAddress).to.equal(expectedAvocadoAddress);
          expect(event.args?.source).to.equal(TestHelpers.testParams.params.source);
          expect(event.args?.metadata).to.equal(hexlify(TestHelpers.testParams.params.metadata as string));
        });

        it("should emit event ExecuteFailed if an action fails", async () => {
          // deploy wallets through AvoFactory as test calls
          const expectedAvocadoAddress = await avoFactory.computeAvocado(owner.address, 0);

          const result = await (await subject(0, false)).wait();

          const events = result.events as Event[];
          expect(events.length).to.be.gte(2);
          expect(events[events.length - 1].event).to.equal("ExecuteFailed");
          expect(events[events.length - 1].args?.avocadoOwner).to.equal(owner.address);
          // 0x6e31ab6d = keccak256 selector for custom error AvoFactory__NotEOA()
          expect(events[events.length - 1].args?.reason).to.equal("0_CUSTOM_ERROR: 0x6e31ab6d. PARAMS_RAW: ");
          expect(events[events.length - 1].args?.avocadoAddress).to.equal(expectedAvocadoAddress);
          expect(events[events.length - 1].args?.source).to.equal(TestHelpers.testParams.params.source);
          expect(events[events.length - 1].args?.metadata).to.equal(
            hexlify(TestHelpers.testParams.params.metadata as string)
          );
        });

        it("should revert if not enough gas sent", async () => {
          // deploy wallets through AvoFactory as test calls
          const expectedAvocadoAddress = await avoFactory.computeAvocado(owner.address, 0);
          const iface = new ethers.utils.Interface(AvoFactory__factory.abi);

          // first get actual gas used for a specific transaction
          const actions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: avoFactory.address,
              data: iface.encodeFunctionData("deploy", [user2.address, 0]),
              value: 0,
              operation: 0,
            },
          ];

          const signature = await testHelpers.testSignature(
            IAvocadoMultisigV1__factory.connect(expectedAvocadoAddress, owner),
            owner,
            {
              ...TestHelpers.testParams.params,
              actions,
            }
          );

          const estimateGas = await testHelpers.castEstimate(
            owner,
            signature,
            {
              ...TestHelpers.testParams.params,
              actions,
            },
            {
              ...TestHelpers.testParams.forwardParams,
            }
          );

          const signatureWithGasLimit = await testHelpers.testSignature(
            IAvocadoMultisigV1__factory.connect(expectedAvocadoAddress, owner),
            owner,
            {
              ...TestHelpers.testParams.params,
              actions,
            },
            {
              ...TestHelpers.testParams.forwardParams,
              gas: estimateGas.toNumber(),
            }
          );

          await expect(
            testHelpers.cast(
              owner,
              signatureWithGasLimit,
              {
                ...TestHelpers.testParams.params,
                actions,
              },
              {
                ...TestHelpers.testParams.forwardParams,
                gas: estimateGas,
              },
              undefined,
              estimateGas.sub(60000).toNumber()
            )
          ).to.be.revertedWith("AvocadoMultisig__InsufficientGasSent()");
        });

        it("should revert if called by NOT allowed broadcaster", async () => {
          const verifyingContract = IAvocadoMultisigV1__factory.connect(
            await avoFactory.computeAvocado(owner.address, 0),
            owner
          );

          if (curMethod === "executeV1") {
            const signature = await testHelpers.testSignature(verifyingContract, owner);

            await expect(
              avoForwarder
                .connect(owner)
                .executeV1(owner.address, 0, TestHelpers.testParams.params, TestHelpers.testParams.forwardParams, [
                  {
                    signature,
                    signer: owner.address,
                  },
                ])
            ).to.be.revertedWith("AvoForwarder__Unauthorized()");
          } else {
            let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
              TestHelpers.testParams.chainAgnosticParams(3),
              TestHelpers.testParams.chainAgnosticParams(-1),
            ];
            chainAgnosticParams = (
              await testHelpers.valueToSignChainAgnostic(verifyingContract, owner, chainAgnosticParams)
            ).params;

            const signature = await testHelpers.testSignatureChainAgnostic(
              verifyingContract,
              owner,
              chainAgnosticParams
            );

            const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] =
              testHelpers.sortSignaturesParamsAscending([
                {
                  signature: signature,
                  signer: owner.address,
                },
              ]);

            const chainAgnosticHashes = await testHelpers.getChainAgnosticHashes(owner, chainAgnosticParams, 0);

            await expect(
              avoForwarder
                .connect(owner)
                .executeChainAgnosticV1(owner.address, 0, chainAgnosticParams[0], signaturesParams, chainAgnosticHashes)
            ).to.be.revertedWith("AvoForwarder__Unauthorized()");
          }
        });
      });
    });
  }

  describe("executeBatchV1", async () => {
    let avocado1: AvocadoMultisig;
    let avocado2: AvocadoMultisig;

    beforeEach(async () => {
      avocado1 = AvocadoMultisig__factory.connect(await avoFactory.computeAvocado(user1.address, 0), user1);
      avocado2 = AvocadoMultisig__factory.connect(await avoFactory.computeAvocado(user2.address, 1), user2);
    });

    //#region local test helpers
    const subject = async (
      shouldRevert = 0, // index of tx that should revert
      singleTx = false,
      continueOnRevert = true
    ) => {
      let actions: AvocadoMultisigStructs.ActionStruct[] = [
        {
          target: avocado1.address,
          data: (
            await avocado1.populateTransaction.addSigners(
              sortAddressesAscending([owner.address, user3.address]), // add owner and user3 as signers
              1
            )
          ).data as string,
          value: 0,
          operation: shouldRevert === 1 ? 4 : 0, // trigger revert with non existing operation. let first tx revert so continueOnRevert can be tested
        },
      ];
      const params1 = { ...TestHelpers.testParams.params, actions: [{ ...actions[0] }] };

      // use signature from some user that is not a signer
      const signaturesParams1: AvocadoMultisigStructs.SignatureParamsStruct[] = [
        {
          signature: await testHelpers.testSignature(avocado1 as unknown as IAvocadoMultisigV1, user1, params1),
          signer: user1.address,
        },
      ];

      actions[0].target = avocado2.address;
      actions[0].operation = shouldRevert === 2 ? 4 : 0; // trigger revert with non existing operation
      const params2 = { ...TestHelpers.testParams.params, actions };

      let chainAgnosticParams: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[] = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
        {
          params: params2,
          forwardParams: TestHelpers.testParams.forwardParams,
          chainId: -1, // will be set to current network chain id
        },
      ];
      chainAgnosticParams = (
        await testHelpers.valueToSignChainAgnostic(
          avocado2 as unknown as IAvocadoMultisigV1,
          user2,
          chainAgnosticParams
        )
      ).params;

      const signaturesParams2: AvocadoMultisigStructs.SignatureParamsStruct[] = [
        {
          signature: await testHelpers.testSignatureChainAgnostic(
            avocado2 as unknown as IAvocadoMultisigV1,
            user2,
            chainAgnosticParams
          ),
          signer: user2.address,
        },
      ];

      let batchParams: AvoForwarderStructs.ExecuteBatchParamsStruct[] = [
        {
          from: user1.address,
          index: 0,
          chainAgnosticHashes: [],
          params: { params: params1, forwardParams: TestHelpers.testParams.forwardParams, chainId: 0 },
          signaturesParams: signaturesParams1,
        },
        {
          from: user2.address, // different user
          index: 1, // not deployed yet
          chainAgnosticHashes: await testHelpers.getChainAgnosticHashes(user2, chainAgnosticParams, 1), // chain agnostic
          params: chainAgnosticParams[1],
          signaturesParams: signaturesParams2,
        },
      ];

      if (singleTx) {
        batchParams = batchParams.slice(0, 1);
      }

      return avoForwarder.connect(broadcaster).executeBatchV1(batchParams, continueOnRevert);
    };
    //#endregion

    it("should executeBatchV1 for multiple txs, deployed and undeployed, normal and chain agnostic", async () => {
      expect(await ethers.provider.getCode(avocado2.address)).to.equal("0x");

      await subject();

      expect(await ethers.provider.getCode(avocado2.address)).to.not.equal("0x");

      // check that both avocados are deployed, and signers user3 and owner are added on both
      let signers = await avocado1.signers();
      expect(signers.length).to.equal(3);
      expect(signers).to.contain(user1.address);
      expect(signers).to.contain(user3.address);
      expect(signers).to.contain(owner.address);

      signers = await avocado2.signers();
      expect(signers.length).to.equal(3);
      expect(signers).to.contain(user2.address);
      expect(signers).to.contain(user3.address);
      expect(signers).to.contain(owner.address);
    });

    it("should executeBatchV1 when one tx reverts and flag continueOnRevert = true", async () => {
      // first tx reverts, avocado2 should still get deployed because execution continues
      expect(await ethers.provider.getCode(avocado2.address)).to.equal("0x");
      expect((await avocado1.signers()).length).to.equal(1);

      await subject(1, false, true);

      expect(await ethers.provider.getCode(avocado2.address)).to.not.equal("0x");
      expect((await avocado1.signers()).length).to.equal(1);
    });

    it("should executeBatchV1 when one tx reverts (first) and flag continueOnRevert = false", async () => {
      // first tx reverts, avocado2 should never get deployed
      expect(await ethers.provider.getCode(avocado2.address)).to.equal("0x");
      expect((await avocado1.signers()).length).to.equal(1);

      await subject(1, false, false);

      expect(await ethers.provider.getCode(avocado2.address)).to.equal("0x");
      expect((await avocado1.signers()).length).to.equal(1);
    });

    it("should executeBatchV1 when one tx reverts (second) and flag continueOnRevert = false", async () => {
      expect(await ethers.provider.getCode(avocado2.address)).to.equal("0x");
      expect((await avocado1.signers()).length).to.equal(1);

      // second tx reverts, so deployment happens (is executed by AvoForwarder so it is not reverted),
      // but avocado2 signers should still be 1 while avocado1 signer updates passed
      await subject(2, false, false);

      expect(await ethers.provider.getCode(avocado2.address)).to.not.equal("0x");
      expect((await avocado2.signers()).length).to.equal(1);
      expect((await avocado1.signers()).length).to.equal(3);
    });

    it("should executeBatchV1 revert for one tx", async () => {
      await expect(subject(0, true)).to.be.revertedWith("AvoForwarder__InvalidParams");
    });
  });
  //#endregion

  context("owner & auth only actions", async () => {
    describe("renounceOwnerhsip", async () => {
      it("should revert if called", async () => {
        await expect(avoForwarder.connect(owner).renounceOwnership()).to.be.revertedWith("AvoForwarder__Unsupported()");
      });
    });

    describe("updateAuths", async () => {
      it("should updateAuths: set to allowed", async () => {
        expect(await avoForwarder.isAuth(user1.address)).to.equal(false);

        const authsStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
        ];

        await avoForwarder.connect(owner).updateAuths(authsStatus);

        expect(await avoForwarder.isAuth(user1.address)).to.equal(true);
      });

      it("should updateAuths: reset to unallowed", async () => {
        const authsStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
        ];

        await avoForwarder.connect(owner).updateAuths(authsStatus);
        expect(await avoForwarder.isAuth(user1.address)).to.equal(true);

        authsStatus[0].value = false;

        await avoForwarder.connect(owner).updateAuths(authsStatus);
        expect(await avoForwarder.isAuth(user1.address)).to.equal(false);
      });

      it("should allow auths to remove themselves", async () => {
        // add user 1 as auth
        const authsStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
        ];

        await avoForwarder.connect(owner).updateAuths(authsStatus);
        expect(await avoForwarder.isAuth(user1.address)).to.equal(true);

        authsStatus[0].value = false;

        await avoForwarder.connect(user1).updateAuths(authsStatus);
        expect(await avoForwarder.isAuth(user1.address)).to.equal(false);
      });

      it("should emit event AuthUpdated", async () => {
        const authsStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
          {
            addr: user2.address,
            value: true,
          },
        ];

        const result = await (await avoForwarder.connect(owner).updateAuths(authsStatus)).wait();
        const events = result.events as Event[];
        expect(events.length).to.equal(2);
        expect(events[0].event).to.equal("AuthUpdated");
        expect(events[0].args?.auth).to.equal(authsStatus[0].addr);
        expect(events[0].args?.status).to.equal(authsStatus[0].value);
        expect(events[1].event).to.equal("AuthUpdated");
        expect(events[1].args?.auth).to.equal(authsStatus[1].addr);
        expect(events[1].args?.status).to.equal(authsStatus[1].value);

        expect(await avoForwarder.isAuth(user1.address)).to.equal(true);
        expect(await avoForwarder.isAuth(user2.address)).to.equal(true);
      });

      it("should revert if called by NOT owner and NOT auth", async () => {
        const authsStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
        ];

        await expect(avoForwarder.connect(user1).updateAuths(authsStatus)).to.be.revertedWith(
          "AvoForwarder__Unauthorized()"
        );
      });

      it("should revert if auth is trying to add auths", async () => {
        // add user 1 as auth
        const authsStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
        ];

        await avoForwarder.connect(owner).updateAuths(authsStatus);
        expect(await avoForwarder.isAuth(user1.address)).to.equal(true);

        // try adding user2
        authsStatus[0].addr = user2.address;

        await expect(avoForwarder.connect(user1).updateAuths(authsStatus)).to.be.revertedWith(
          "AvoForwarder__Unauthorized()"
        );
      });

      it("should revert if auth is trying to remove auths other themselves", async () => {
        // add user1 and user2 as auth
        const authsStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
          {
            addr: user2.address,
            value: true,
          },
        ];

        await avoForwarder.connect(owner).updateAuths(authsStatus);
        expect(await avoForwarder.isAuth(user1.address)).to.equal(true);

        // try removing user2 as user1
        await expect(
          avoForwarder.connect(user1).updateAuths([
            {
              addr: user2.address,
              value: false,
            },
          ])
        ).to.be.revertedWith("AvoForwarder__Unauthorized()");
      });
    });

    describe("updateBroadcasters", async () => {
      it("should updateBroadcasters: set to allowed", async () => {
        expect(await avoForwarder.isBroadcaster(user1.address)).to.equal(false);

        const broadcastersStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
        ];

        await avoForwarder.connect(owner).updateBroadcasters(broadcastersStatus);

        expect(await avoForwarder.isBroadcaster(user1.address)).to.equal(true);
      });

      it("should updateBroadcasters: reset to unallowed", async () => {
        const broadcastersStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
        ];

        await avoForwarder.connect(owner).updateBroadcasters(broadcastersStatus);
        expect(await avoForwarder.isBroadcaster(user1.address)).to.equal(true);

        broadcastersStatus[0].value = false;

        await avoForwarder.connect(owner).updateBroadcasters(broadcastersStatus);
        expect(await avoForwarder.isBroadcaster(user1.address)).to.equal(false);
      });

      it("should allow auths to add/remove broadcasters", async () => {
        // add user1 as auth
        await avoForwarder.connect(owner).updateAuths([
          {
            addr: user1.address,
            value: true,
          },
        ]);

        const broadcastersStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user2.address,
            value: true,
          },
        ];

        await avoForwarder.connect(user1).updateBroadcasters(broadcastersStatus);
        expect(await avoForwarder.isBroadcaster(user2.address)).to.equal(true);

        broadcastersStatus[0].value = false;

        await avoForwarder.connect(user1).updateBroadcasters(broadcastersStatus);
        expect(await avoForwarder.isBroadcaster(user2.address)).to.equal(false);
      });

      it("should emit event BroadcasterUpdated", async () => {
        const broadcastersStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
          {
            addr: user2.address,
            value: true,
          },
        ];

        const result = await (await avoForwarder.connect(owner).updateBroadcasters(broadcastersStatus)).wait();
        const events = result.events as Event[];
        expect(events.length).to.equal(2);
        expect(events[0].event).to.equal("BroadcasterUpdated");
        expect(events[0].args?.broadcaster).to.equal(broadcastersStatus[0].addr);
        expect(events[0].args?.status).to.equal(broadcastersStatus[0].value);
        expect(events[1].event).to.equal("BroadcasterUpdated");
        expect(events[1].args?.broadcaster).to.equal(broadcastersStatus[1].addr);
        expect(events[1].args?.status).to.equal(broadcastersStatus[1].value);

        expect(await avoForwarder.isBroadcaster(user1.address)).to.equal(true);
        expect(await avoForwarder.isBroadcaster(user2.address)).to.equal(true);
      });

      it("should revert if called by NOT owner and NOT auth", async () => {
        const broadcastersStatus: AvoForwarderStructs.AddressBoolStruct[] = [
          {
            addr: user1.address,
            value: true,
          },
        ];

        await expect(avoForwarder.connect(user1).updateBroadcasters(broadcastersStatus)).to.be.revertedWith(
          "AvoForwarder__Unauthorized()"
        );
      });
    });
  });
});
