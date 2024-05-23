import { deployments, ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

import {
  IAvoFactory,
  AvoFactory,
  IAvocadoMultisigV1,
  AvocadoMultisig__factory,
  AvoGasEstimationsHelper,
  AvoForwarder,
} from "../../typechain-types";
import { expect, setupSigners, setupContract, sortAddressesAscending, dEaDAddress } from "../util";
import { TestHelpers } from "../TestHelpers";
import { AvocadoMultisigStructs } from "../../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";

describe("AvoGasEstimationsHelper", () => {
  let avoFactory: IAvoFactory;
  let avoForwarder: AvoForwarder;
  let avoGasEstimationsHelper: AvoGasEstimationsHelper;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let broadcaster: SignerWithAddress;

  let testHelpers: TestHelpers;

  beforeEach(async () => {
    ({ owner, user1, user2, user3, broadcaster } = await setupSigners());

    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
    avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", broadcaster);
    avoGasEstimationsHelper = await setupContract<AvoGasEstimationsHelper>("AvoGasEstimationsHelper", owner);

    testHelpers = new TestHelpers(avoForwarder);
  });

  describe("deployment", async () => {
    it("should deploy AvoGasEstimationsHelper", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const AvoGasEstimationsHelperDeployment = await deployments.get("AvoGasEstimationsHelper");
      const deployedCode = await ethers.provider.getCode(AvoGasEstimationsHelperDeployment.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });
  });

  describe("simulate", async () => {
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

      // use signature from some user that is not a signer
      const signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [
        {
          signature: await testHelpers.testSignature(verifyingContract as unknown as IAvocadoMultisigV1, user3, params),
          signer: user3.address,
        },
      ];

      // set up 0x0_0000_0000_0000_0000_0000_0000_0000_0000_000dEaD signer
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [dEaDAddress],
      });
      const dEaD = await ethers.getSigner(dEaDAddress);

      if (estimateGas) {
        const previousBlockGasLimit = (await user1.provider?.getBlock(await user1.provider.getBlockNumber()))?.gasLimit;

        return avoGasEstimationsHelper
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
        return avoGasEstimationsHelper
          .connect(dEaD)
          .callStatic.simulateV1(user1.address, index, params, TestHelpers.testParams.forwardParams, signaturesParams);
      }
    };

    it("should estimate addSigners", async () => {
      const estimation = (await subject()) as BigNumber;
      expect(estimation.gt(0)).to.equal(true);
    });

    it("should estimate addSigners with a higher nonce", async () => {
      const estimation = (await subject(0, true, 155)) as BigNumber;
      expect(estimation.gt(0)).to.equal(true);
    });

    it("should estimate when actions revert", async () => {
      const estimation = (await subject(1, true, 0, undefined, true)) as BigNumber;
      expect(estimation.gte(180_000)).to.equal(true);
    });

    it("should return expected values when already deployed", async () => {
      const result = (await subject(0, false)) as AvoGasEstimationsHelper.SimulateResultStruct;

      expect(result.isDeployed).to.equal(true);
      expect(result.success).to.equal(true);
      expect((result.deploymentGasUsed as BigNumber).lte(10_000)).to.equal(true);
      expect((result.castGasUsed as BigNumber).gte(10_000)).to.equal(true);
      expect((result.totalGasUsed as BigNumber).gte(50_000)).to.equal(true);
    });

    it("should return expected values when not yet deployed", async () => {
      const result = (await subject(1, false)) as AvoGasEstimationsHelper.SimulateResultStruct;
      expect(result.isDeployed).to.equal(false);
      expect(result.success).to.equal(true);
      expect((result.deploymentGasUsed as BigNumber).gte(10_0000)).to.equal(true);
      expect((result.castGasUsed as BigNumber).gte(10_000)).to.equal(true);
      expect((result.totalGasUsed as BigNumber).gte(20_0000)).to.equal(true);
    });

    it("should return expected values when actions revert", async () => {
      const result = (await subject(0, false, 0, undefined, true)) as AvoGasEstimationsHelper.SimulateResultStruct;

      expect(result.isDeployed).to.equal(true);
      expect(result.success).to.equal(false);
      expect((result.deploymentGasUsed as BigNumber).lte(10_000)).to.equal(true);
      expect(result.revertReason).to.equal("0_AVO__INVALID_ID_OR_OPERATION");
      expect((result.castGasUsed as BigNumber).gte(10_000)).to.equal(true);
      expect((result.totalGasUsed as BigNumber).gte(20_000)).to.equal(true);
    });
  });
});
