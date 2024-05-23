import { deployments, ethers, getNamedAccounts } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { hexConcat, hexDataSlice, hexlify, hexZeroPad, toUtf8Bytes } from "ethers/lib/utils";

import { expect, setupContract, setupSigners } from "./util";
import {
  AvocadoMultisig,
  AvocadoMultisig__factory,
  AvoFactory,
  Avocado,
  Avocado__factory,
  AvoRegistry,
  IAvocadoMultisigV1,
  AvoConfigV1,
  AvocadoMultisigSecondary,
} from "../typechain-types";
import { TestHelpers } from "./TestHelpers";

describe("Avocado", () => {
  let avocadoMultisigProxy: Avocado;
  let avoFactory: AvoFactory;
  let avocadoMultisigLogicContract: AvocadoMultisig;
  let avoSecondary: AvocadoMultisigSecondary;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;

  let testHelpers: TestHelpers;

  beforeEach(async () => {
    ({ owner, user1 } = await setupSigners());
    // setup contracts
    avocadoMultisigLogicContract = await setupContract<AvocadoMultisig>("AvocadoMultisig", user1);
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
    avoSecondary = await setupContract<AvocadoMultisigSecondary>("AvocadoMultisigSecondary", owner);
    // avocadoMultisigProxy is not deployed by hardhat-deploy via script. just through factory, so it must be fetched "normally"
    // for local networks the deployment through factory is triggered automatically for user1
    avocadoMultisigProxy = Avocado__factory.connect(await avoFactory.computeAvocado(user1.address, 0), user1);

    testHelpers = new TestHelpers();
  });

  describe("compilation", async () => {
    it("should have expected compiled creationCode", async () => {
      // Avocado creation code is hardcoded in factory, so the Avocado contract should not be changed.
      const artifact = await deployments.getArtifact("Avocado");
      expect(artifact.bytecode).to.equal(
        "0x60a060405234801561001057600080fd5b5060408051808201825260048152638c65738960e01b60208201529051600091339161003c91906100b2565b600060405180830381855afa9150503d8060008114610077576040519150601f19603f3d011682016040523d82523d6000602084013e61007c565b606091505b506020810151604090910151608052600080546001600160a01b0319166001600160a01b03909216919091179055506100e19050565b6000825160005b818110156100d357602081860181015185830152016100b9565b506000920191825250919050565b6080516101476100fb6000396000600601526101476000f3fe60806040527f00000000000000000000000000000000000000000000000000000000000000006000357f4d42058500000000000000000000000000000000000000000000000000000000810161006f5773ffffffffffffffffffffffffffffffffffffffff821660005260206000f35b7f68beab3f0000000000000000000000000000000000000000000000000000000081036100a0578160005260206000f35b73ffffffffffffffffffffffffffffffffffffffff600054167f874095c60000000000000000000000000000000000000000000000000000000082036100ea578060005260206000f35b3660008037600080366000845af49150503d6000803e80801561010c573d6000f35b3d6000fdfea2646970667358221220bf171834b0948ebffd196d6a4208dbd5d0a71f76dfac9d90499de318c59558fc64736f6c63430008120033"
      );
    });
  });

  describe("deployment", async () => {
    it("should deploy Avocado", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const deployedCode = await ethers.provider.getCode(avocadoMultisigProxy.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    // should call transientDeployData, set version & owner tested through below tests
  });

  describe("proxy logic", async () => {
    it("should have set avoImpl address", async () => {
      const avoImplFromContract = await testHelpers.readAvoImplAddress(avocadoMultisigProxy.address);

      expect(avoImplFromContract.toLowerCase()).to.equal(avocadoMultisigLogicContract.address.toLowerCase());
    });

    it("should have set generic data slot", async () => {
      const iface = new ethers.utils.Interface(["function _data() view returns(uint256)"]);

      const _data = await ethers.provider.call({
        to: avocadoMultisigProxy.address,
        data: iface.encodeFunctionData("_data", []),
      });

      expect(_data.toLowerCase()).to.equal(hexZeroPad(user1.address.toLowerCase(), 32));
    });

    it("should return owner for _owner()", async () => {
      const iface = new ethers.utils.Interface(["function _owner() view returns(address)"]);

      const owner = hexDataSlice(
        await ethers.provider.call({
          to: avocadoMultisigProxy.address,
          data: iface.encodeFunctionData("_owner", []),
        }),
        12
      );

      expect(owner.toLowerCase()).to.equal(user1.address.toLowerCase());
    });

    it("should set index as part of data slot", async () => {
      // deploy another multisig with index != 0 to test properly
      await avoFactory.deploy(owner.address, 3);
      const expectedAddress = await avoFactory.computeAvocado(owner.address, 3);

      const iface = new ethers.utils.Interface(["function _data() view returns(uint256)"]);

      const _data = await ethers.provider.call({
        to: expectedAddress,
        data: iface.encodeFunctionData("_data", []),
      });

      expect(_data.toLowerCase()).to.equal(hexZeroPad(hexConcat([hexlify(3), owner.address.toLowerCase()]), 32));
    });

    it("should fallback -> forward to logic contract", async () => {
      // check if a constant from AvocadoMultisig logic contract is readable
      const avocadoMultisig = AvocadoMultisig__factory.connect(avocadoMultisigProxy.address, user1);
      expect(await avocadoMultisig.DOMAIN_SEPARATOR_NAME()).to.equal(TestHelpers.domainSeparatorNameMultisig);
    });

    it("should be upgradeable through avocadoMultisig logic contract", async () => {
      const avocadoMultisig = AvocadoMultisig__factory.connect(avocadoMultisigProxy.address, user1) as AvocadoMultisig &
        IAvocadoMultisigV1;

      // deploy another AvocadoMultisig logic contract
      const { deployer, avocadoMultisigContractsOwner } = await getNamedAccounts();

      const registry = await deployments.get("AvoRegistryProxy");
      const forwarder = await deployments.get("AvoForwarderProxy");
      const avoSignersList = await deployments.get("AvoSignersListProxy");

      const avocadoMultisigLogicContractNew = await testHelpers.deployAvocadoMultisigContract(
        deployer,
        registry.address,
        forwarder.address,
        await setupContract<AvoConfigV1>("AvoConfigV1", owner),
        avoSignersList.address,
        avoSecondary.address
      );

      // set it as valid version in registry
      const avoRegistry = (await ethers.getContractAt(
        "AvoRegistry",
        (
          await deployments.get("AvoRegistryProxy")
        ).address
      )) as AvoRegistry;

      await avoRegistry
        .connect(await ethers.getSigner(avocadoMultisigContractsOwner))
        .setAvoVersion(avocadoMultisigLogicContractNew.address, true, true);

      const avoImplBefore = await testHelpers.readAvoImplAddress(avocadoMultisig.address);

      // upgradeTo() must be executed through self-called
      await testHelpers.executeActions(
        avocadoMultisig,
        user1,
        [
          (
            await avocadoMultisig.populateTransaction.upgradeTo(
              avocadoMultisigLogicContractNew.address,
              toUtf8Bytes("")
            )
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

      // make sure the upgrade was executed
      expect(avoImplBefore).to.not.equal(avoImplAfter);
      expect(avoImplAfter).to.equal(avocadoMultisigLogicContractNew.address.toLowerCase());
    });
  });
});
