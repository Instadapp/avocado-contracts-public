import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Event } from "ethers";

import { AvocadoMultisigStructs } from "../../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";
import {
  AvoFactory,
  AvoForwarder,
  IAvocadoMultisigV1,
  AvocadoMultisig__factory,
  IAvoFactory,
  AvocadoMultisig,
} from "../../typechain-types";
import { expect, setupSigners, setupContract, dEaDAddress, sortAddressesAscending } from "../util";
import { TestHelpers } from "../TestHelpers";

describe("INTEGRATION_TEST: AvocadoMultisig initial signers setup", () => {
  let avoContract: AvocadoMultisig & IAvocadoMultisigV1;
  let avoFactory: IAvoFactory & AvoFactory;
  let avoForwarder: AvoForwarder;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let broadcaster: SignerWithAddress;
  let dEaDSigner: SignerWithAddress;
  let proxyAdmin: SignerWithAddress;

  let testHelpers: TestHelpers;

  const testSetup = async () => {
    ({ owner, user1, user2, user3, user4, broadcaster, proxyAdmin } = await setupSigners());

    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
    avoForwarder = await setupContract<AvoForwarder>("AvoForwarderProxy", broadcaster);

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
  };

  beforeEach(async () => {
    await testSetup();
  });

  describe("deployment with initial signers", async () => {
    it("should start with AvocadoMultisig not yet deployed for user2", async () => {
      const user2MultisigAddress = await avoFactory.computeAvocado(user2.address, 0);
      const deployedCode = await ethers.provider.getCode(user2MultisigAddress);
      expect(deployedCode).to.equal("0x");
    });

    it("should set up multiple signers right with deployment tx", async () => {
      // there is no AvocadoMultisig deployed for user2 yet
      const user2MultisigAddress = await avoFactory.computeAvocado(user2.address, 0);

      const addSigners = sortAddressesAscending([
        user1.address,
        user3.address,
        broadcaster.address,
        proxyAdmin.address,
      ]);

      const actions: AvocadoMultisigStructs.ActionStruct[] = [
        {
          target: user2MultisigAddress,
          data: (await avoContract.populateTransaction.addSigners(addSigners, 1)).data as any,
          value: 0,
          operation: 0,
        },
        {
          target: user2MultisigAddress,
          data: (await avoContract.populateTransaction.setRequiredSigners(3)).data as any,
          value: 0,
          operation: 0,
        },
      ];

      const avocadoMultisigUser2 = AvocadoMultisig__factory.connect(user2MultisigAddress, user2) as AvocadoMultisig &
        IAvocadoMultisigV1;

      const signature = await testHelpers.testSignature(avocadoMultisigUser2, user2, {
        ...TestHelpers.testParams.params,
        actions,
      });

      // execute via cast() through AvoForwarder which automatically deploys the AvocadoMultisig if needed
      await testHelpers.cast(
        user2,
        signature,
        { ...TestHelpers.testParams.params, actions },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ["signersCount", "requiredSigners"]
      );

      // check state of AvocadoMultisig after execution
      expect(await avocadoMultisigUser2.requiredSigners()).to.equal(3);

      const expectedSigners = sortAddressesAscending([
        user1.address,
        user2.address,
        user3.address,
        broadcaster.address,
        proxyAdmin.address,
      ]);

      const signers = await avocadoMultisigUser2.signers();
      expect(signers[0]).to.equal(expectedSigners[0]);
      expect(signers[1]).to.equal(expectedSigners[1]);
      expect(signers[2]).to.equal(expectedSigners[2]);
      expect(signers[3]).to.equal(expectedSigners[3]);
      expect(signers[4]).to.equal(expectedSigners[4]);
      expect(await avocadoMultisigUser2.signersCount()).to.equal(5);

      // make sure execution via just owner signature is not enough anymore and reverts
      const ownerSignature = await testHelpers.testSignature(avocadoMultisigUser2, user2);
      await expect(
        testHelpers.verify(avocadoMultisigUser2, user2, [{ signature: ownerSignature, signer: user2.address }])
      ).to.be.revertedWith("AvocadoMultisig__InvalidParams()");
      await expect(testHelpers.cast(user2, ownerSignature)).to.be.revertedWith("AvocadoMultisig__InvalidParams()");

      // make sure execution with invalid signature is not valid
      await expect(
        testHelpers.verify(
          avocadoMultisigUser2,
          user2,
          testHelpers.sortSignaturesParamsAscending([
            // enough signatures, but with an invalid one
            { signature: await testHelpers.testSignature(avocadoMultisigUser2, user4), signer: user4.address },
            {
              signature: await testHelpers.testSignature(
                avocadoMultisigUser2,
                await ethers.getSigner(expectedSigners[0])
              ),
              signer: expectedSigners[0],
            },
            {
              signature: await testHelpers.testSignature(
                avocadoMultisigUser2,
                await ethers.getSigner(expectedSigners[1])
              ),
              signer: expectedSigners[1],
            },
          ])
        )
      ).to.be.revertedWith("AvocadoMultisig__InvalidSignature()");
      await expect(
        testHelpers.cast(
          user2,
          "",
          undefined,
          undefined,
          testHelpers.sortSignaturesParamsAscending([
            // enough signatures, but with an invalid one
            { signature: await testHelpers.testSignature(avocadoMultisigUser2, user4), signer: user4.address },
            {
              signature: await testHelpers.testSignature(
                avocadoMultisigUser2,
                await ethers.getSigner(expectedSigners[0])
              ),
              signer: expectedSigners[0],
            },
            {
              signature: await testHelpers.testSignature(
                avocadoMultisigUser2,
                await ethers.getSigner(expectedSigners[1])
              ),
              signer: expectedSigners[1],
            },
          ])
        )
      ).to.be.revertedWith("AvocadoMultisig__InvalidSignature()");

      // make sure execution via quorum enough signers works
      const signature1 = await testHelpers.testSignature(
        avocadoMultisigUser2,
        await ethers.getSigner(expectedSigners[0])
      );
      const signature2 = await testHelpers.testSignature(
        avocadoMultisigUser2,
        await ethers.getSigner(expectedSigners[1])
      );
      const signature3 = await testHelpers.testSignature(
        avocadoMultisigUser2,
        await ethers.getSigner(expectedSigners[2])
      );
      expect(
        await testHelpers.verify(avocadoMultisigUser2, user2, [
          // signatures signers are automatically sorted ascending because expectedSigners are
          { signature: signature1, signer: expectedSigners[0] },
          { signature: signature2, signer: expectedSigners[1] },
          { signature: signature3, signer: expectedSigners[2] },
        ])
      ).to.equal(true);
      const resultEvents = (
        await (
          await testHelpers.cast(user2, "", undefined, undefined, [
            { signature: signature1, signer: expectedSigners[0] },
            { signature: signature2, signer: expectedSigners[1] },
            { signature: signature3, signer: expectedSigners[2] },
          ])
        ).wait()
      ).events as Event[];
      expect(resultEvents[resultEvents.length - 1].event).to.equal("Executed");
    });
  });
});
