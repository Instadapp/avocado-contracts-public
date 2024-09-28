import { deployments, ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { parseEther, toUtf8Bytes } from "ethers/lib/utils";
import { Contract, Event, Wallet } from "ethers";

import {
  AvoFactory,
  AvoRegistry,
  MockERC20Token__factory,
  AvoForwarder,
  InstaFlashAggregatorInterface,
  InstaFlashAggregatorInterface__factory,
  IWETH9,
  IWETH9__factory,
  MockDeposit,
  MockDeposit__factory,
  AvocadoMultisig__factory,
  AvocadoMultisig,
  IAvocadoMultisigV1,
  AvoSignersList,
  AvoSignersListProxy,
  AvoConfigV1,
  AvocadoMultisigSecondary,
} from "../typechain-types";
import { expect, onlyForked, setupContract, setupSigners, sortAddressesAscending } from "../test/util";
import { TestHelpers } from "../test/TestHelpers";
import { AvocadoMultisigStructs } from "../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";

const castAuthorizedReserveGas = 52000;
const castReserveGas = 20000;

describe("Gas usage reports", () => {
  let avoFactory: AvoFactory;
  let avoForwarder: AvoForwarder;
  let avoRegistry: AvoRegistry;
  let avoSignersList: AvoSignersList;
  let avocadoMultisig: AvocadoMultisig & IAvocadoMultisigV1;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let broadcaster: SignerWithAddress;

  let testHelpersMultisig: TestHelpers;

  beforeEach(async () => {
    ({ owner, user1, user2, broadcaster } = await setupSigners());

    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", user1);

    avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", broadcaster);

    avoRegistry = await setupContract<AvoRegistry>("AvoRegistryProxy", owner);

    avoSignersList = await setupContract<AvoSignersList>("AvoSignersListProxy", owner);

    // connect to AvocadoMultisig with user1, already deployed locally through hardhat-deploy script
    avocadoMultisig = AvocadoMultisig__factory.connect(
      await avoFactory.computeAvocado(user1.address, 0),
      user1
    ) as AvocadoMultisig & IAvocadoMultisigV1;

    // set percentage fee (mode 0) with 30%
    await avoRegistry.updateFeeConfig({ fee: 30e7, feeCollector: owner.address, mode: 0 });
    // send some eth to AvocadoMultisig to fund fee payments
    await owner.sendTransaction({ to: avocadoMultisig.address, value: parseEther("10") });

    testHelpersMultisig = new TestHelpers(avoForwarder);
  });

  describe("\n\nAvoFactory ----------------------- ", async () => {
    it("computeAvocado()", async () => {
      console.log("computeAvocado()_________");
      const result = await avoFactory.estimateGas.computeAvocado(user1.address, 0);
      console.log(result.toNumber().toLocaleString(), "estimated gas");
    });

    it("deploy()", async () => {
      console.log("deploy()_________");
      const result = await avoFactory.estimateGas.deploy(user2.address, 0);
      const txResult = await (await avoFactory.deploy(user2.address, 0)).wait();
      console.log(txResult.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS");
      console.log(result.toNumber().toLocaleString(), "(estimated gas)");

      // ensure deployment actually worked
      const getCodeSize = await user2.provider?.getCode(await avoFactory.computeAvocado(user2.address, 0));
      expect(getCodeSize).to.not.equal("0x");
    });

    it("deploy() with trackInStorage=false", async () => {
      console.log("deploy() with trackInStorage=false_________");

      // deploy AvoSignersList with trackInStorage = false
      const { proxyAdmin } = await setupSigners();
      const avoSignersListProxy = await setupContract<AvoSignersListProxy>("AvoSignersListProxy", proxyAdmin, true);

      const avoConfigV1 = await setupContract<AvoConfigV1>("AvoConfigV1", owner);
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
      expect(await avoSignersList.trackInStorage()).to.equal(false);

      const result = await avoFactory.estimateGas.deploy(user2.address, 0);
      const txResult = await (await avoFactory.deploy(user2.address, 0)).wait();
      console.log(txResult.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS");
      console.log(result.toNumber().toLocaleString(), "(estimated gas)");

      // ensure deployment actually worked
      const getCodeSize = await user2.provider?.getCode(await avoFactory.computeAvocado(user2.address, 0));
      expect(getCodeSize).to.not.equal("0x");
    });

    it("deployWithVersion()", async () => {
      console.log("deployWithVersion()_________");

      const avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", owner);
      const avoSecondary = await setupContract<AvocadoMultisigSecondary>("AvocadoMultisigSecondary", owner);

      // deploy a new version of Avo smart wallet logic contract
      const newAvocadoMultisigVersion = (
        await testHelpersMultisig.deployAvocadoMultisigContract(
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

      const result = await avoFactory.estimateGas.deployWithVersion(user2.address, 0, newAvocadoMultisigVersion);
      const txResult = await (await avoFactory.deployWithVersion(user2.address, 0, newAvocadoMultisigVersion)).wait();
      console.log(txResult.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS");
      console.log(result.toNumber().toLocaleString(), "(estimated gas)");

      // ensure deployment actually worked
      const getCodeSize = await user2.provider?.getCode(await avoFactory.computeAvocado(user2.address, 0));
      expect(getCodeSize).to.not.equal("0x");
    });
  });

  describe("\n\nAvoForwarder ----------------------- ", async () => {
    it("computeAvocado()", async () => {
      console.log("computeAvocado()_________");
      const result = await avoForwarder.estimateGas.computeAvocado(user1.address, 0);
      console.log(result.toNumber().toLocaleString(), "estimated gas");
    });

    //#region AvocadoMultisig actions
    it("executeMultisig() with signature if Avocado must be deployed", async () => {
      console.log("executeMultisig() with signature and deploy_________");

      // connect to avocadoMultisig with user2, which is not yet deployed
      const user2AvocadoMultisig = AvocadoMultisig__factory.connect(
        await avoForwarder.computeAvocado(user2.address, 0),
        user1
      ) as AvocadoMultisig & IAvocadoMultisigV1;

      const signature = await testHelpersMultisig.testSignature(user2AvocadoMultisig, user2);

      const estimateResult = await testHelpersMultisig.castEstimate(user2, signature);

      const result = await (await testHelpersMultisig.cast(user2, signature)).wait();

      // make sure the tx actually worked
      const events = result.events as Event[];
      expect(events.length).to.be.greaterThanOrEqual(1);
      expect(events[events.length - 1].event).to.equal("Executed");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS______\n");
      console.log("(estimated gas):", estimateResult.toNumber().toLocaleString());
    });

    it("executeMultisig() with signature if Avocado must be deployed, with failing action", async () => {
      console.log("executeMultisig() with signature and deploy, with failing action_________");

      // connect to avocadoMultisig with user2, which is not yet deployed
      const user2AvocadoMultisig = AvocadoMultisig__factory.connect(
        await avoForwarder.computeAvocado(user2.address, 0),
        user1
      ) as AvocadoMultisig & IAvocadoMultisigV1;

      const testParamsWithFailingAction: AvocadoMultisigStructs.CastParamsStruct = {
        ...TestHelpers.testParams.params,
        actions: [
          ...TestHelpers.testParams.params.actions,
          {
            target: avoFactory.address,
            // deploy for smart contract will fail
            data: (await avoFactory.populateTransaction.deploy(avocadoMultisig.address, 0)).data as any,
            value: 0,
            operation: 0,
          },
        ],
      };

      const signature = await testHelpersMultisig.testSignature(
        user2AvocadoMultisig,
        user2,
        testParamsWithFailingAction
      );

      const estimateResult = await testHelpersMultisig.castEstimate(user2, signature, testParamsWithFailingAction);

      const result = await (await testHelpersMultisig.cast(user2, signature, testParamsWithFailingAction)).wait();

      // make sure the tx actually worked
      const events = result.events as Event[];
      expect(events.length).to.be.greaterThanOrEqual(1);
      expect(events[events.length - 1].event).to.equal("ExecuteFailed");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS______\n");
      console.log("(estimated gas):", estimateResult.toNumber().toLocaleString());
    });

    it("executeMultisig() with signature if Avocado is already deployed, 1st transaction(nonce = 0)", async () => {
      console.log("executeMultisig() with signature, Avocado already deployed, 1st transaction(nonce = 0)_________");

      const signature = await testHelpersMultisig.testSignature(avocadoMultisig, user1);

      const estimateResult = await testHelpersMultisig.castEstimate(user1, signature);

      const result = await (await testHelpersMultisig.cast(user1, signature)).wait();

      // make sure the tx actually worked
      const events = result.events as Event[];
      expect(events.length).to.be.greaterThanOrEqual(1);
      expect(events[events.length - 1].event).to.equal("Executed");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS______\n");
      console.log("(estimated gas):", estimateResult.toNumber().toLocaleString());
    });

    it("executeMultisig() with signature if Avocado is already deployed, nth transaction(nonce > 0)", async () => {
      console.log("executeMultisig() with signature, Avocado already deployed, nth transaction(nonce > 0)_________");

      let signature = await testHelpersMultisig.testSignature(avocadoMultisig, user1);

      // execute once to get nonce > 0
      await testHelpersMultisig.cast(user1, signature);

      // get signature for inceased nonce
      signature = await testHelpersMultisig.testSignature(avocadoMultisig, user1);

      const estimateResult = await testHelpersMultisig.castEstimate(user1, signature);

      const result = await (await testHelpersMultisig.cast(user1, signature)).wait();

      // make sure the tx actually worked
      const events = result.events as Event[];
      expect(events.length).to.be.greaterThanOrEqual(1);
      expect(events[events.length - 1].event).to.equal("Executed");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS______\n");
      console.log("(estimated gas):", estimateResult.toNumber().toLocaleString());
    });
    //#endregion
  });

  describe("\n\nAvocado (proxy) ----------------------- ", async () => {
    it("castAuthorized(), using Avocado directly", async () => {
      console.log("castAuthorized() with fee and maxFee_________");
      let estimateResult = await testHelpersMultisig.castAuthorizedEstimate(
        avocadoMultisig,
        user1,
        undefined,
        undefined,
        {
          ...TestHelpers.testParams.authorizedParams,
          maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
        }
      );

      let result = await (
        await testHelpersMultisig.castAuthorized(
          avocadoMultisig,
          user1,
          undefined,
          undefined,
          {
            ...TestHelpers.testParams.authorizedParams,
            maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
          },
          estimateResult.add(castAuthorizedReserveGas).toNumber()
        )
      ).wait();

      // make sure the tx actually worked
      let events = result.events as Event[];
      expect(events.length).to.equal(2);
      expect(events[0].event).to.equal("CastExecuted");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS FIRST TX (nonce = 0)");
      console.log("(estimated gas FIRST TX)", estimateResult.toNumber().toLocaleString());

      estimateResult = await testHelpersMultisig.castAuthorizedEstimate(avocadoMultisig, user1, undefined, undefined, {
        ...TestHelpers.testParams.authorizedParams,
        maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
      });

      result = await (
        await testHelpersMultisig.castAuthorized(
          avocadoMultisig,
          user1,
          undefined,
          undefined,
          {
            ...TestHelpers.testParams.authorizedParams,
            maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
          },
          estimateResult.add(castAuthorizedReserveGas).toNumber()
        )
      ).wait();

      // make sure the tx actually worked
      events = result.events as Event[];
      expect(events.length).to.equal(2);
      expect(events[0].event).to.equal("CastExecuted");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS SECOND TX (nonce > 0)");
      console.log("(estimated gas SECOND TX)", estimateResult.toNumber().toLocaleString());
    });

    it("castAuthorized(), using Avocado directly, with failing action", async () => {
      console.log("castAuthorized() with fee and maxFee, with failing action_________");

      const testParamsWithFailingAction: AvocadoMultisigStructs.CastParamsStruct = {
        ...TestHelpers.testParams.params,
        actions: [
          ...TestHelpers.testParams.params.actions,
          {
            target: avoFactory.address,
            // deploy for smart contract will fail
            data: (await avoFactory.populateTransaction.deploy(avocadoMultisig.address, 0)).data as any,
            value: 0,
            operation: 0,
          },
        ],
      };

      const authorizedParams = {
        ...TestHelpers.testParams.authorizedParams,
        maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
      };

      const signature = await testHelpersMultisig.testSignatureAuthorized(
        avocadoMultisig,
        user1,
        testParamsWithFailingAction,
        authorizedParams
      );

      const estimateResult = await testHelpersMultisig.castAuthorizedEstimate(
        avocadoMultisig,
        user1,
        [
          {
            signature,
            signer: user1.address,
          },
        ],
        testParamsWithFailingAction,
        authorizedParams
      );

      const result = await (
        await testHelpersMultisig.castAuthorized(
          avocadoMultisig,
          user1,
          [
            {
              signature,
              signer: user1.address,
            },
          ],
          testParamsWithFailingAction,
          authorizedParams
        )
      ).wait();

      // make sure the tx actually failed
      const events = result.events as Event[];
      expect(events.length).to.equal(2);
      expect(events[0].event).to.equal("CastFailed");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS");
      console.log("(estimated gas)", estimateResult.toNumber().toLocaleString());
    });

    it("castAuthorized(), using Avocado directly when maxFee > 0, fee = 0", async () => {
      console.log("castAuthorized() with maxFee > 0, fee = 0_________");
      // set percentage fee to 0
      await avoRegistry.updateFeeConfig({ fee: 0, feeCollector: owner.address, mode: 0 });

      let estimateResult = await testHelpersMultisig.castAuthorizedEstimate(
        avocadoMultisig,
        user1,
        undefined,
        undefined,
        {
          ...TestHelpers.testParams.authorizedParams,
          maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
        }
      );

      let result = await (
        await testHelpersMultisig.castAuthorized(
          avocadoMultisig,
          user1,
          undefined,
          undefined,
          {
            ...TestHelpers.testParams.authorizedParams,
            maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
          },
          estimateResult.add(castAuthorizedReserveGas).toNumber()
        )
      ).wait();

      // make sure the tx actually worked
      let events = result.events as Event[];
      expect(events.length).to.equal(2);
      expect(events[0].event).to.equal("CastExecuted");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS");
      console.log("(estimated gas)", estimateResult.toNumber().toLocaleString());
    });

    it("castAuthorized() using Avocado directly when maxFee = 0, fee > 0", async () => {
      console.log("castAuthorized() with maxFee = 0, fee > 0_________");

      let estimateResult = await testHelpersMultisig.castAuthorizedEstimate(
        avocadoMultisig,
        user1,
        undefined,
        undefined,
        {
          ...TestHelpers.testParams.authorizedParams,
          maxFee: 0,
        }
      );

      let result = await (
        await testHelpersMultisig.castAuthorized(
          avocadoMultisig,
          user1,
          undefined,
          undefined,
          {
            ...TestHelpers.testParams.authorizedParams,
            maxFee: 0,
          },
          estimateResult.add(castAuthorizedReserveGas).toNumber()
        )
      ).wait();

      // make sure the tx actually worked
      let events = result.events as Event[];
      expect(events.length).to.equal(2);
      expect(events[0].event).to.equal("CastExecuted");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS");
      console.log("(estimated gas)", estimateResult.toNumber().toLocaleString());
    });

    it("castAuthorized() using Avocado directly when maxFee = 0, fee = 0", async () => {
      console.log("castAuthorized() with maxFee = 0, fee = 0_________");
      // set percentage fee to 0
      await avoRegistry.updateFeeConfig({ fee: 0, feeCollector: owner.address, mode: 0 });

      let estimateResult = await testHelpersMultisig.castAuthorizedEstimate(
        avocadoMultisig,
        user1,
        undefined,
        undefined,
        {
          ...TestHelpers.testParams.authorizedParams,
          maxFee: 0,
        }
      );

      let result = await (
        await testHelpersMultisig.castAuthorized(
          avocadoMultisig,
          user1,
          undefined,
          undefined,
          {
            ...TestHelpers.testParams.authorizedParams,
            maxFee: 0,
          },
          estimateResult.add(castAuthorizedReserveGas).toNumber()
        )
      ).wait();

      // make sure the tx actually worked
      let events = result.events as Event[];
      expect(events.length).to.equal(2);
      expect(events[0].event).to.equal("CastExecuted");

      console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS");
      console.log("(estimated gas)", estimateResult.toNumber().toLocaleString());
    });

    describe("castAuthorized() using Avocado directly with various signer counts", async () => {
      const testSignerCounts = [2, 3, 4, 5, 10, 20, 50, 90];

      for (const signerCount of testSignerCounts) {
        it(
          "castAuthorized() using Avocado directly with signer counts (=also set as requiredSigners): " + signerCount,
          async () => {
            let signers: Wallet[] = [];
            for (let i = 0; i < signerCount - 1; i++) {
              // only until signerCount - 1 because owner is already a signer
              signers[i] = Wallet.createRandom();
            }

            // add signers
            await testHelpersMultisig.executeActions(
              avocadoMultisig,
              user1,
              [
                (
                  await avocadoMultisig.populateTransaction.addSigners(
                    sortAddressesAscending(signers.map((signer) => signer.address)),
                    signerCount
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

            const signatureParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [];
            for (let i = 0; i < signerCount - 1; i++) {
              signatureParams[i] = {
                signature: await testHelpersMultisig.testSignatureAuthorized(
                  avocadoMultisig,
                  signers[i] as unknown as SignerWithAddress
                ),
                signer: signers[i].address,
              };
            }

            // push owner signature
            signatureParams.push({
              signature: await testHelpersMultisig.testSignatureAuthorized(avocadoMultisig, user1),
              signer: user1.address,
            });

            const result = await (
              await testHelpersMultisig.castAuthorized(
                avocadoMultisig,
                user1,
                testHelpersMultisig.sortSignaturesParamsAscending(signatureParams)
              )
            ).wait();

            const events = result.events as Event[];
            expect(events[events.length - 2].event).to.equal("CastExecuted");

            console.log(
              result.gasUsed.toNumber().toLocaleString(),
              "ACTUAL USED GAS for castAuthorized() with signers count: ",
              signerCount
            );
          }
        );
      }
    });

    describe("addSigners() using Avocado directly with various signer counts", async () => {
      const testSignerCounts = [1, 2, 3, 4, 5, 10, 20, 50, 89];

      let avoSignersListProxy: AvoSignersListProxy;

      before(async () => {
        const { proxyAdmin } = await setupSigners();
        avoSignersListProxy = await setupContract<AvoSignersListProxy>("AvoSignersListProxy", proxyAdmin, true);
      });

      for (const signerCount of testSignerCounts) {
        it(
          "addSigners() trackInStorage=true, via Avocado castAuthorized with signer counts:" + signerCount,
          async () => {
            let signers: Wallet[] = [];
            for (let i = 0; i < signerCount; i++) {
              signers[i] = Wallet.createRandom();
            }

            // add signers
            const result = await (
              await testHelpersMultisig.executeActions(
                avocadoMultisig,
                user1,
                [
                  (
                    await avocadoMultisig.populateTransaction.addSigners(
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
            expect(events[events.length - 2].event).to.equal("CastExecuted");

            console.log(
              result.gasUsed.toNumber().toLocaleString(),
              "ACTUAL USED GAS for add signers count (trackInStorage=true): ",
              signerCount
            );
          }
        );
      }

      for (const signerCount of testSignerCounts) {
        it(
          "addSigners() trackInStorage=false, via Avocado castAuthorized with signer counts:" + signerCount,
          async () => {
            // deploy AvoSignersList with trackInStorage = false
            const avoConfigV1 = await setupContract<AvoConfigV1>("AvoConfigV1", owner);
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
            expect(await avoSignersList.trackInStorage()).to.equal(false);

            let signers: Wallet[] = [];
            for (let i = 0; i < signerCount; i++) {
              signers[i] = Wallet.createRandom();
            }

            // add signers
            const result = await (
              await testHelpersMultisig.executeActions(
                avocadoMultisig,
                user1,
                [
                  (
                    await avocadoMultisig.populateTransaction.addSigners(
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
            expect(events[events.length - 2].event).to.equal("CastExecuted");

            console.log(
              result.gasUsed.toNumber().toLocaleString(),
              "ACTUAL USED GAS for add signers count (trackInStorage=false): ",
              signerCount
            );
          }
        );
      }

      context("when already 10 signers present", async () => {
        beforeEach(async () => {
          let signers: Wallet[] = [];
          for (let i = 0; i < 9; i++) {
            signers[i] = Wallet.createRandom();
          }

          // add signers
          await testHelpersMultisig.executeActions(
            avocadoMultisig,
            user1,
            [
              (
                await avocadoMultisig.populateTransaction.addSigners(
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
          );

          expect(await avocadoMultisig.signersCount()).to.equal(10);
        });

        for (let i = 0; i < 3; i++) {
          it("addSigners() add 1 signer when already 10 signers present", async () => {
            let signers: Wallet[] = [];
            signers[0] = Wallet.createRandom();

            // add signers
            const result = await (
              await testHelpersMultisig.executeActions(
                avocadoMultisig,
                user1,
                [
                  (
                    await avocadoMultisig.populateTransaction.addSigners(
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
            expect(events[events.length - 2].event).to.equal("CastExecuted");

            console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS for adding 1 signer");
          });

          it("removeSigners() remove 1 signer when already 10 signers present", async () => {
            let signers: string[] = [];
            signers[0] = (await avocadoMultisig.signers())[4];
            if (signers[0] == user1.address) {
              signers[0] = (await avocadoMultisig.signers())[3];
            }

            // add signers
            const result = await (
              await testHelpersMultisig.executeActions(
                avocadoMultisig,
                user1,
                [
                  (
                    await avocadoMultisig.populateTransaction.removeSigners(sortAddressesAscending(signers), 1)
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
            expect(events[events.length - 2].event).to.equal("CastExecuted");

            console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS for removing 1 signer");
          });
        }
      });
    });
  });

  describe("\n\nToken transfer comparison ----------------------- ", async () => {
    it("compare gas cost for token send cost for: EOA, Avocado (castAuthorized), AvoForwarder (cast), Avocado (castAuthorized). AvoForwarder (castMultisig)", async () => {
      console.log(
        "\nEOA, Avocado (Multisig, castAuthorized). AvoForwarder (Multisig, executeMultisig), token transfer cost_________"
      );

      // deploy mock token
      const mockERC20TokenFactory = (await ethers.getContractFactory(
        "MockERC20Token",
        user1
      )) as MockERC20Token__factory;
      const mockERC20Token = await mockERC20TokenFactory.connect(user2).deploy("MockERC20Token", "MOCK");
      await mockERC20Token.deployed();

      const eoaToAvoEstimate = await mockERC20Token
        .connect(user2)
        .estimateGas.transfer(avocadoMultisig.address, parseEther("800"));

      // user2 gets all the supply of MOCK, send some to Avo smart wallet and measure gas cost
      const eoaToAvoContract = await (
        await mockERC20Token.connect(user2).transfer(avocadoMultisig.address, parseEther("800"))
      ).wait();

      // multisig user 1 = 800
      expect((await mockERC20Token.balanceOf(avocadoMultisig.address)).eq(parseEther("800"))).to.eq(true);

      // action: send the MOCK tokens back to EOA and measure gas cost
      const actions: AvocadoMultisigStructs.ActionStruct[] = [
        {
          target: mockERC20Token.address,
          data: (await mockERC20Token.populateTransaction.transfer(user2.address, parseEther("300"))).data as any,
          value: 0,
          operation: 0,
        },
      ];

      const signature = await testHelpersMultisig.testSignature(avocadoMultisig, user1, {
        ...TestHelpers.testParams.params,
        actions,
      });

      const avoForwarderToEOAEstimate = await testHelpersMultisig.castEstimate(user1, signature, {
        ...TestHelpers.testParams.params,
        actions,
      });

      // multisig user 1 = 800-300 = 500
      const avoForwarderToEOA = await (
        await testHelpersMultisig.cast(
          user1,
          signature,
          {
            ...TestHelpers.testParams.params,
            actions,
          },
          {
            ...TestHelpers.testParams.forwardParams,
          },
          undefined,
          avoForwarderToEOAEstimate.add(castReserveGas).toNumber()
        )
      ).wait();

      const castChainAgnosticParams = [
        {
          ...TestHelpers.testParams.chainAgnosticParams(-1),
          params: {
            ...TestHelpers.testParams.chainAgnosticParams(-1).params,
            actions: actions,
          },
        },
        {
          ...TestHelpers.testParams.chainAgnosticParams(3),
        },
      ];
      const signatureChainAgnostic = await testHelpersMultisig.testSignatureChainAgnostic(
        avocadoMultisig,
        user1,
        castChainAgnosticParams
      );
      // multisig user 1 = 800-300 = 500
      const avoForwarderToEOAChainAgnostic = await (
        await testHelpersMultisig.castChainAgnostic(user1, signatureChainAgnostic, castChainAgnosticParams, 0)
      ).wait();

      // send some USDC to a new avocadoMultisig not yet deployed for user2
      const user2AvocadoMultisigAddress = await avoFactory.computeAvocado(user2.address, 0);
      await mockERC20Token.connect(user2).transfer(user2AvocadoMultisigAddress, parseEther("800"));

      // get data for transfer when avo smart wallet not yet deployed
      const signatureUser2 = await testHelpersMultisig.testSignature(
        { address: user2AvocadoMultisigAddress } as IAvocadoMultisigV1,
        user2,
        {
          ...TestHelpers.testParams.params,
          actions,
        }
      );

      const avoForwarderToEOAWithDeployEstimate = await testHelpersMultisig.castEstimate(user2, signatureUser2, {
        ...TestHelpers.testParams.params,
        actions,
      });

      // multisig user 2 = 800-300 = 500
      const avoForwarderToEOAWithDeploy = await (
        await testHelpersMultisig.cast(
          user2,
          signatureUser2,
          {
            ...TestHelpers.testParams.params,
            actions,
          },
          {
            ...TestHelpers.testParams.forwardParams,
          },
          undefined,
          avoForwarderToEOAWithDeployEstimate.add(castReserveGas).toNumber()
        )
      ).wait();

      const avocadoToEOAEstimate = await testHelpersMultisig.castAuthorizedEstimate(
        avocadoMultisig,
        user1,
        undefined,
        { ...TestHelpers.testParams.params, actions },
        {
          ...TestHelpers.testParams.authorizedParams,
          maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
        }
      );

      // multisig user 1 = 500-300 = 200
      const avocadoToEOA = await (
        await testHelpersMultisig.castAuthorized(
          avocadoMultisig,
          user1,
          undefined,
          { ...TestHelpers.testParams.params, actions },
          {
            ...TestHelpers.testParams.authorizedParams,
            maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
          },
          avocadoToEOAEstimate.add(castAuthorizedReserveGas).toNumber()
        )
      ).wait();

      // failing action -> try to transfer too much
      actions[0].data = (await mockERC20Token.populateTransaction.transfer(user2.address, parseEther("10000")))
        .data as any;
      const signatureFailingTransfer = await testHelpersMultisig.testSignature(avocadoMultisig, user1, {
        ...TestHelpers.testParams.params,
        actions,
      });

      const avoForwarderToEOAWithFailEstimate = await testHelpersMultisig.castEstimate(
        user1,
        signatureFailingTransfer,
        {
          ...TestHelpers.testParams.params,
          actions,
        }
      );

      const avoForwarderToEOAWithFail = await (
        await testHelpersMultisig.cast(
          user1,
          signatureFailingTransfer,
          {
            ...TestHelpers.testParams.params,
            actions,
          },
          {
            ...TestHelpers.testParams.forwardParams,
          },
          undefined,
          avoForwarderToEOAWithFailEstimate.add(castReserveGas).toNumber()
        )
      ).wait();

      console.log("\n");
      console.log(eoaToAvoContract.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS EOA -> Avocado ");
      console.log("(estimated gas EOA -> Avocado)", eoaToAvoEstimate.toString());

      console.log(
        avocadoToEOA.gasUsed.toNumber().toLocaleString(),
        "ACTUAL USED GAS Avocado (Multisig, castAuthorized) -> EOA"
      );
      console.log("(estimated gas Avocado -> EOA)", avocadoToEOAEstimate.toString());

      console.log(
        avoForwarderToEOA.gasUsed.toNumber().toLocaleString(),
        " ACTUAL USED GAS AvoForwarder (Multisig, execute) -> EOA"
      );
      console.log("(estimated gas AvoForwarder -> EOA)", avoForwarderToEOAEstimate.toString());

      console.log(
        avoForwarderToEOAChainAgnostic.gasUsed.toNumber().toLocaleString(),
        " ACTUAL USED GAS AvoForwarder CHAIN AGNOSTIC (Multisig, executeChainAgnostic) -> EOA"
      );

      console.log("\n");

      console.log(
        avocadoToEOA.gasUsed.sub(eoaToAvoContract.gasUsed).toString(),
        "GAS COST DIFFERENCE Avocado (Multisig, castAuthorized) <> EOA_____"
      );
      console.log(
        avoForwarderToEOA.gasUsed.sub(eoaToAvoContract.gasUsed).toString(),
        "GAS COST DIFFERENCE Forwarder (Multisig, execute) <> EOA_____"
      );
      console.log("\n");

      console.log(
        avoForwarderToEOAWithDeploy.gasUsed.toNumber().toLocaleString(),
        " ACTUAL USED GAS AvoForwarder (Multisig, execute) -> EOA WITH DEPLOY"
      );
      console.log(
        "(estimated gas AvoForwarder (Multisig, execute) -> EOA WITH DEPLOY)",
        avoForwarderToEOAWithDeployEstimate.toString()
      );
      console.log("\n");

      console.log(
        avoForwarderToEOAWithFail.gasUsed.toNumber().toLocaleString(),
        " ACTUAL USED GAS AvoForwarder (Multisig, execute) -> EOA WITH FAILING ACTION"
      );
      console.log(
        "(estimated gas AvoForwarder (Multisig, execute) -> EOA WITH FAILING ACTION)",
        avoForwarderToEOAWithFailEstimate.toString()
      );
      console.log("\n");

      // multisig of user 2 got 800, transferred 300 out for test with deployment, should have 500 now
      expect((await mockERC20Token.balanceOf(user2AvocadoMultisigAddress)).eq(ethers.utils.parseEther("500"))).to.eq(
        true
      );

      // multisig of user 1 got 800, transferred 300 out for test via execute + again for test via castAuthorized -> should have 200 now
      expect((await mockERC20Token.balanceOf(avocadoMultisig.address)).eq(ethers.utils.parseEther("200"))).to.eq(true);
    });
  });

  onlyForked(async () => {
    describe("\n\nAvocadoMultisig Flashloan", () => {
      const instaFlashAggregatorMainnet = "0x619Ad2D02dBeE6ebA3CDbDA3F98430410e892882";
      const instaFlashResolverMainnet = "0x10c7B513b7d37f40bdBCE77183b9112ec35CAec1";
      const wethMainnet = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
      const wethWhaleMainnet = "0x2feb1512183545f48f6b9c5b4ebfcaf49cfca6f3";

      let weth: IWETH9;
      let flResolver: Contract;
      let flAggregator: InstaFlashAggregatorInterface;
      let mockDeposit: MockDeposit;

      // flashloan depends on forked network, doesn't work in CI
      beforeEach(async () => {
        // connect to forked contracts
        flResolver = new ethers.Contract(
          instaFlashResolverMainnet,
          [
            "function getData(address[] _tokens,uint256[] _amounts) view returns(uint16[] routes_,uint256[] fees_,uint16[] bestRoutes_,uint256 bestFee_)",
          ],
          owner
        );
        flAggregator = InstaFlashAggregatorInterface__factory.connect(instaFlashAggregatorMainnet, owner);
        weth = IWETH9__factory.connect(wethMainnet, owner);

        // deploy mock deposit contract
        const mockDepositFactory = (await ethers.getContractFactory("MockDeposit", owner)) as MockDeposit__factory;
        mockDeposit = await mockDepositFactory.deploy(weth.address);
        await mockDeposit.deployed();

        // send weth from whale to user1
        await user1.sendTransaction({ to: wethWhaleMainnet, value: ethers.utils.parseEther("2") });
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [wethWhaleMainnet],
        });
        await weth
          .connect(await ethers.getSigner(wethWhaleMainnet))
          .transfer(user1.address, ethers.utils.parseEther("2000"));
      });

      it("flashloan gas cost (directly via AvocadoMultisig castAuthorized)", async () => {
        // deposit WETH in Avo smart wallet to cover flashloan fees for test case
        await weth.connect(user1).transfer(avocadoMultisig.address, ethers.utils.parseEther("50"));

        // get flashloan route data
        const flData = await flResolver.getData([weth.address], [ethers.utils.parseEther("3000")]);
        const flRoute = flData.bestRoutes_[1];
        const flFee = ethers.utils.parseEther("3000").div(10000).mul(flData.bestFee_);

        // prepare actions
        // actions to be executed in flashloan executeOperation callback
        const flashLoanActions: AvocadoMultisigStructs.ActionStruct[] = [
          // approve deposit into mock deposit contract
          {
            operation: 0,
            target: weth.address,
            data: (await weth.populateTransaction.approve(mockDeposit.address, parseEther("3000"))).data as any,
            value: 0,
          },
          // deposit flashloaned 1000 WETH into mock deposit contract
          {
            operation: 0,
            target: mockDeposit.address,
            data: new ethers.utils.Interface(MockDeposit__factory.abi).encodeFunctionData("deposit", [
              ethers.utils.parseEther("3000"),
            ]),
            value: 0,
          },
          // withdraw again from deposit contract
          {
            operation: 0,
            target: mockDeposit.address,
            data: new ethers.utils.Interface(MockDeposit__factory.abi).encodeFunctionData("withdraw", [
              ethers.utils.parseEther("3000"),
            ]),
            value: 0,
          },
          // repay flashloan + fees to flashloan aggregator
          {
            operation: 0,
            target: weth.address,
            data: new ethers.utils.Interface(IWETH9__factory.abi).encodeFunctionData("transfer", [
              flAggregator.address,
              ethers.utils.parseEther("3000").add(flFee),
            ]),
            value: 0,
          },
        ];

        const flashLoanActionsBytes = ethers.utils.defaultAbiCoder.encode(
          ["tuple(address target,bytes data,uint256 value,uint256 operation)[]"],
          [flashLoanActions]
        );

        const actions: AvocadoMultisigStructs.ActionStruct[] = [
          // get flashloan 1000 WETH
          {
            target: flAggregator.address,
            data: new ethers.utils.Interface(InstaFlashAggregatorInterface__factory.abi).encodeFunctionData(
              "flashLoan",
              [
                [weth.address], // tokens
                [ethers.utils.parseEther("3000")], // amounts
                flRoute, // route
                flashLoanActionsBytes, // calldata data (actions that will be executed in flashloan executeOperation callback)
                toUtf8Bytes(""),
              ]
            ),
            value: 0,
            operation: 2,
          },
          // some other action for testing actions after flashloan: send 1 WETH to user2
          {
            target: weth.address,
            data: new ethers.utils.Interface(IWETH9__factory.abi).encodeFunctionData("transfer", [
              user2.address,
              ethers.utils.parseEther("1"),
            ]),
            value: 0,
            operation: 0,
          },
        ];

        const estimateGas = await testHelpersMultisig.castAuthorizedEstimate(
          avocadoMultisig,
          user1,
          undefined,
          {
            ...TestHelpers.testParams.params,
            actions,
            id: 20, // flashloan call
          },
          {
            ...TestHelpers.testParams.authorizedParams,
            maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
          }
        );

        const result = await (
          await testHelpersMultisig.castAuthorized(
            avocadoMultisig,
            user1,
            undefined,
            {
              ...TestHelpers.testParams.params,
              id: 20, // flashloan call
              actions,
            },
            {
              ...TestHelpers.testParams.authorizedParams,
              maxFee: parseEther("100"), // set max fee to something high to get full maximum gas usage
            },
            estimateGas.add(estimateGas.mul(50).div(100)).toNumber()
          )
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - 2].event).to.equal("CastExecuted");

        console.log(result.gasUsed.toNumber().toLocaleString(), "ACTUAL USED GAS______\n");

        console.log("(estimated gas):", estimateGas.toString());
      });
    });
  });
});
