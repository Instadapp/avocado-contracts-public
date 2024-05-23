import { deployments } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { toUtf8Bytes } from "ethers/lib/utils";

import {
  AvoFactory,
  AvoForwarder,
  AvoRegistry,
  IAvoFactory,
  AvocadoMultisig,
  IAvocadoMultisigV1,
  AvocadoMultisig__factory,
  AvoConfigV1,
  AvocadoMultisigSecondary,
} from "../../typechain-types";
import { expect, setupSigners, setupContract } from "../util";
import { TestHelpers } from "../TestHelpers";

describe("INTEGRATION_TEST: AvocadoMultisig deterministic address", () => {
  let avocadoMultisig: AvocadoMultisig & IAvocadoMultisigV1;
  let avoFactory: IAvoFactory & AvoFactory;
  let avoForwarder: AvoForwarder;
  let avoRegistry: AvoRegistry;
  let avoSecondary: AvocadoMultisigSecondary;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;

  beforeEach(async () => {
    ({ owner, user1 } = await setupSigners());

    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
    avoRegistry = await setupContract<AvoRegistry>("AvoRegistryProxy", owner);
    avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", owner);
    avoSecondary = await setupContract<AvocadoMultisigSecondary>("AvocadoMultisigSecondary", owner);

    // avocadoMultisig for user 1 is already deployed through hardhat-deploy script local
    avocadoMultisig = AvocadoMultisig__factory.connect(
      await avoFactory.computeAvocado(user1.address, 0),
      user1
    ) as AvocadoMultisig & IAvocadoMultisigV1;
  });

  describe("deterministic address (AvocadoMultisig)", async () => {
    it("should have the same deterministic address in forwarder & factory for Avocado after AvocadoMultisig logic contract is upgraded", async () => {
      const nonceBefore = await avocadoMultisig.avoNonce();

      const testHelpers = new TestHelpers();

      const avoImplBefore = await testHelpers.readAvoImplAddress(avocadoMultisig.address);
      expect((await avoFactory.avoImpl()).toLowerCase()).to.equal(avoImplBefore.toLowerCase());
      expect(avoImplBefore.toLowerCase()).to.equal((await deployments.get("AvocadoMultisig")).address.toLowerCase());

      const avoSignersList = await deployments.get("AvoSignersListProxy");

      // deploy another AvocadoMultisig logic contract
      const avocadoMultisigLogicContract = await testHelpers.deployAvocadoMultisigContract(
        owner.address,
        avoRegistry.address,
        avoForwarder.address,
        await setupContract<AvoConfigV1>("AvoConfigV1", owner),
        avoSignersList.address,
        avoSecondary.address
      );
      // set it as valid version in registry
      await avoRegistry.setAvoVersion(avocadoMultisigLogicContract.address, true, true);

      // execute upgradeTo(), must be executed through self-called
      await testHelpers.executeActions(
        avocadoMultisig,
        user1,
        [
          (
            await avocadoMultisig.populateTransaction.upgradeTo(avocadoMultisigLogicContract.address, toUtf8Bytes(""))
          ).data as string,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["_avoImpl"]
      );

      const avoImplAfter = await testHelpers.readAvoImplAddress(avocadoMultisig.address);

      // make sure the avoImpl address has changed
      expect(avoImplBefore).to.not.equal(avoImplAfter);
      expect(avoImplAfter).to.equal(avocadoMultisigLogicContract.address.toLowerCase());
      // make sure other values have not changed (to ensure storage slots were not messed up)
      expect(await avocadoMultisig.owner()).to.equal(user1.address);
      expect((await avocadoMultisig.avoNonce()).eq(nonceBefore.add(1))).to.equal(true);

      // expect deterministic address to still be the same even though avoImpl has changed
      expect((await avoFactory.avoImpl()).toLowerCase()).to.equal(avoImplAfter.toLowerCase());

      expect(await avoForwarder.computeAvocado(user1.address, 0)).to.equal(avocadoMultisig.address);
      expect(await avoFactory.computeAvocado(user1.address, 0)).to.equal(avocadoMultisig.address);
    });
  });
});
