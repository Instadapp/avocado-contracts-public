import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { AvoConfigV1 } from "../../typechain-types";
import { expect, setupContract, setupSigners } from "../util";

describe("AvoConfigV1", () => {
  let avoConfigV1: AvoConfigV1;
  let owner: SignerWithAddress;

  beforeEach(async () => {
    ({ owner } = await setupSigners());

    // setup contracts
    avoConfigV1 = await setupContract<AvoConfigV1>("AvoConfigV1", owner);
  });

  describe("deployment", async () => {
    it("should deploy AvoConfigV1", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const deployedCode = await ethers.provider.getCode(avoConfigV1.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });
  });

  describe("setConfig", async () => {
    it("should revert if depositToken is set to zero address at deployment", async () => {
      await expect(
        avoConfigV1.setConfig(
          await avoConfigV1.avocadoMultisigConfig(),
          { depositToken: ethers.constants.AddressZero },
          { trackInStorage: await avoConfigV1.avoSignersListConfig() }
        )
      ).to.be.revertedWith("AvoConfig__InvalidConfig()");
    });

    it("should revert if authorizedMinFee is set to zero at deployment", async () => {
      await expect(
        avoConfigV1.setConfig(
          {
            ...(await avoConfigV1.avocadoMultisigConfig()),
            authorizedMinFee: 0,
          },
          { depositToken: await avoConfigV1.avoDepositManagerConfig() },
          { trackInStorage: await avoConfigV1.avoSignersListConfig() }
        )
      ).to.be.revertedWith("AvoConfig__InvalidConfig()");
    });

    it("should revert if authorizedMaxFee is set to zero at deployment", async () => {
      await expect(
        avoConfigV1.setConfig(
          {
            ...(await avoConfigV1.avocadoMultisigConfig()),
            authorizedMaxFee: 0,
          },
          { depositToken: await avoConfigV1.avoDepositManagerConfig() },
          { trackInStorage: await avoConfigV1.avoSignersListConfig() }
        )
      ).to.be.revertedWith("AvoConfig__InvalidConfig()");
    });

    it("should revert if authorizedMaxFee is set < authorizedMinFee at deployment", async () => {
      await expect(
        avoConfigV1.setConfig(
          {
            ...(await avoConfigV1.avocadoMultisigConfig()),
            authorizedMaxFee: 1,
            authorizedMinFee: 10,
          },
          { depositToken: await avoConfigV1.avoDepositManagerConfig() },
          { trackInStorage: await avoConfigV1.avoSignersListConfig() }
        )
      ).to.be.revertedWith("AvoConfig__InvalidConfig()");
    });

    it("should revert if authorizedFeeCollector is set to zero address at deployment", async () => {
      await expect(
        avoConfigV1.setConfig(
          {
            ...(await avoConfigV1.avocadoMultisigConfig()),
            authorizedFeeCollector: ethers.constants.AddressZero,
          },
          { depositToken: await avoConfigV1.avoDepositManagerConfig() },
          { trackInStorage: await avoConfigV1.avoSignersListConfig() }
        )
      ).to.be.revertedWith("AvoConfig__InvalidConfig()");
    });
  });
});
