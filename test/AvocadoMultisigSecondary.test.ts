import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, constants } from "ethers";
import { FunctionFragment, toUtf8Bytes } from "ethers/lib/utils";
import { getNamedAccounts } from "hardhat";
import {
  IAvoFactory,
  AvoFactory,
  AvoRegistry,
  AvocadoMultisig,
  AvocadoMultisigSecondary,
  IAvocadoMultisigV1,
  AvocadoMultisig__factory,
  AvoSignersList,
  AvoForwarder,
  AvoConfigV1,
  AvoConfigV1__factory,
  AvocadoMultisigSecondary__factory,
} from "../typechain-types";
import { TestHelpers, defaultAuthorizedMinFee, defaultAuthorizedMaxFee } from "./TestHelpers";
import { setupSigners, setupContract } from "./util";

describe("AvocadoMultisigSecondary", () => {
  let avoContract: AvocadoMultisig & IAvocadoMultisigV1;
  let avoFactory: IAvoFactory & AvoFactory;
  let avoRegistry: AvoRegistry;
  let avoSignersList: AvoSignersList;
  let avoSecondary: AvocadoMultisigSecondary;
  let avoForwarder: AvoForwarder;
  let avoConfigV1: AvoConfigV1;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let backupFeeCollector: SignerWithAddress;

  let testHelpers: TestHelpers;

  beforeEach(async () => {
    ({ owner, user1, backupFeeCollector } = await setupSigners());

    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);

    avoRegistry = await setupContract<AvoRegistry>("AvoRegistryProxy", owner);

    avoSignersList = await setupContract<AvoSignersList>("AvoSignersListProxy", user1);

    avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", user1);

    avoConfigV1 = await setupContract<AvoConfigV1>("AvoConfigV1", owner);

    avoSecondary = await setupContract<AvocadoMultisigSecondary>("AvocadoMultisigSecondary", owner);

    // avocadoMultisig for user 1 is already deployed through hardhat-deploy script local
    avoContract = AvocadoMultisig__factory.connect(
      await avoFactory.computeAvocado(user1.address, 0),
      user1
    ) as AvocadoMultisig & IAvocadoMultisigV1;

    testHelpers = new TestHelpers(avoForwarder);

    await avoConfigV1.setConfig(
      {
        authorizedMinFee: defaultAuthorizedMinFee,
        authorizedMaxFee: defaultAuthorizedMaxFee,
        authorizedFeeCollector: backupFeeCollector.address,
      },
      { depositToken: await avoConfigV1.avoDepositManagerConfig() },
      { trackInStorage: await avoConfigV1.avoSignersListConfig() }
    );
  });

  describe("deployment", async () => {
    it("should have constants set", async () => {
      expect(await avoContract.DOMAIN_SEPARATOR_NAME()).to.equal(TestHelpers.domainSeparatorNameMultisig);
      expect(await avoContract.DOMAIN_SEPARATOR_VERSION()).to.equal(TestHelpers.domainSeparatorVersionMultisig);
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
        testHelpers.deployAvocadoMultisigSecondaryContract(
          deployer,
          constants.AddressZero,
          avoForwarder.address,
          avoConfigV1,
          avoSignersList.address
        )
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
    });

    it("should revert if avoForwarder is set to zero address at deployment", async () => {
      const { deployer } = await getNamedAccounts();

      await expect(
        testHelpers.deployAvocadoMultisigSecondaryContract(
          deployer,
          avoRegistry.address,
          constants.AddressZero,
          avoConfigV1,
          avoSignersList.address
        )
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
    });

    it("should revert if avoConfig is set to zero address at deployment", async () => {
      const { deployer } = await getNamedAccounts();

      avoConfigV1 = AvoConfigV1__factory.connect(constants.AddressZero, user1);

      await expect(
        testHelpers.deployAvocadoMultisigSecondaryContract(
          deployer,
          avoRegistry.address,
          avoForwarder.address,
          avoConfigV1,
          avoSignersList.address
        )
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
    });

    it("should revert if avoSignersList is set to zero address at deployment", async () => {
      const { deployer } = await getNamedAccounts();

      await expect(
        testHelpers.deployAvocadoMultisigSecondaryContract(
          deployer,
          avoRegistry.address,
          avoForwarder.address,
          avoConfigV1,
          constants.AddressZero
        )
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams");
    });

    it("should have avoRegistry address set", async () => {
      expect(await avoSecondary.avoRegistry()).to.equal(avoRegistry.address);
    });

    it("should have avoForwarder address set", async () => {
      expect(await avoSecondary.avoForwarder()).to.equal(avoForwarder.address);
    });

    it("should have avoSignersList address set", async () => {
      expect(await avoSecondary.avoSignersList()).to.equal(avoSignersList.address);
    });
  });

  describe("all non-view methods delegateCall only", async () => {
    it("should have no other public write methods than the ones covered here", async () => {
      let allPublicMethods = AvocadoMultisigSecondary__factory.createInterface().fragments.filter(
        (f) => f.type === "function"
      ) as FunctionFragment[];

      allPublicMethods = allPublicMethods.filter((f) => !f.constant && f.stateMutability !== "view");

      expect(allPublicMethods.length).to.equal(12);
    });

    it("should have initializer disabled on logic contract", async () => {
      // try to initialize, should fail because disabled
      await expect(avoSecondary.initialize()).to.be.revertedWith("AvocadoMultisig__Unauthorized"); // only delegate call allowed
    });

    it("should have upgradeTo as delegateCall only", async () => {
      await expect(avoSecondary.upgradeTo(ethers.constants.AddressZero, toUtf8Bytes(""))).to.be.revertedWith(
        "AvocadoMultisig__Unauthorized"
      );
    });
    it("should have occupyAvoNonces as delegateCall only", async () => {
      await expect(avoSecondary.occupyAvoNonces([])).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });
    it("should have occupyNonSequentialNonces as delegateCall only", async () => {
      await expect(avoSecondary.occupyNonSequentialNonces([])).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });

    it("should have removeSignedMessage as delegateCall only", async () => {
      await expect(avoSecondary.removeSignedMessage(ethers.constants.HashZero)).to.be.revertedWith(
        "AvocadoMultisig__Unauthorized"
      );
    });
    it("should have signMessage as delegateCall only", async () => {
      await expect(avoSecondary.signMessage(ethers.constants.HashZero)).to.be.revertedWith(
        "AvocadoMultisig__Unauthorized"
      );
    });

    it("should have payAuthorizedFee as delegateCall only", async () => {
      await expect(avoSecondary.payAuthorizedFee(0, 0)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });

    it("should have addSigners as delegateCall only", async () => {
      await expect(avoSecondary.addSigners([], 0)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });
    it("should have removeSigners as delegateCall only", async () => {
      await expect(avoSecondary.removeSigners([], 0)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });
    it("should have setRequiredSigners as delegateCall only", async () => {
      await expect(avoSecondary.setRequiredSigners(0)).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });

    it("should have _simulateExecuteActions as delegateCall only", async () => {
      await expect(avoSecondary._simulateExecuteActions([], 0, false)).to.be.revertedWith(
        "AvocadoMultisig__Unauthorized"
      );
    });
    it("should have simulateCast as delegateCall only", async () => {
      await expect(
        avoSecondary.simulateCast(TestHelpers.testParams.params, TestHelpers.testParams.forwardParams, [], [])
      ).to.be.revertedWith("AvocadoMultisig__Unauthorized");
    });
  });
});
