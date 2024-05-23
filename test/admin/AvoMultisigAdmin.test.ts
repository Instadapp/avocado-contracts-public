import { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { MockERC20Token, MockERC20Token__factory, AvoMultisigAdmin } from "../../typechain-types";

describe("AvoMultisigAdmin", function () {
  let AvoMultisigAdmin: AvoMultisigAdmin;
  let AvoMultisigAdminAddress: string;
  let mockERC20: MockERC20Token;
  let signers: Signer[];
  let signerAddresses: string[];

  // This function deploys the ReserveContract with a single authority and rebalancer
  async function deployAvoMultisigAdmin(): Promise<AvoMultisigAdmin> {
    const _AvoMultisigAdminFactory = await ethers.getContractFactory("AvoMultisigAdmin");
    const _AvoMultisigAdmin = await _AvoMultisigAdminFactory.deploy(
      signerAddresses[0],
      signerAddresses[1],
      signerAddresses[2],
      signerAddresses[3],
      signerAddresses[4],
      signerAddresses[5],
      3
    );
    return _AvoMultisigAdmin as AvoMultisigAdmin;
  }

  before(async function () {
    signerAddresses = [];
    signers = await ethers.getSigners();
    for (let i = 0; i < 6; i++) {
      signerAddresses.push(await signers[i].getAddress());
    }

    const mockERC20TokenFactory = (await ethers.getContractFactory(
      "MockERC20Token",
      signers[0]
    )) as MockERC20Token__factory;
    mockERC20 = await mockERC20TokenFactory.deploy("MockERC20Token", "MOCK");
    await mockERC20.deployed();
  });

  let targetAddress: string;
  let data: string;
  let salt: string;
  let hash: string;

  beforeEach(async function () {
    AvoMultisigAdmin = await deployAvoMultisigAdmin();
    AvoMultisigAdminAddress = AvoMultisigAdmin.address;

    targetAddress = mockERC20.address;
    data = mockERC20.interface.encodeFunctionData("approve", [AvoMultisigAdminAddress, 100]);
    salt = ethers.utils.keccak256("0x01");

    const encodePacked = ethers.utils.solidityPack(["address", "bytes", "bytes32"], [targetAddress, data, salt]);
    hash = ethers.utils.keccak256(encodePacked);
    hash = hash.slice(0, hash.length - 4);
  });

  describe("deploy", function () {
    it("should have signers set", async function () {
      expect(await AvoMultisigAdmin.SIGNER_1()).to.equal(signerAddresses[0]);
      expect(await AvoMultisigAdmin.SIGNER_2()).to.equal(signerAddresses[1]);
      expect(await AvoMultisigAdmin.SIGNER_3()).to.equal(signerAddresses[2]);
      expect(await AvoMultisigAdmin.SIGNER_4()).to.equal(signerAddresses[3]);
      expect(await AvoMultisigAdmin.SIGNER_5()).to.equal(signerAddresses[4]);
      expect(await AvoMultisigAdmin.SIGNER_6()).to.equal(signerAddresses[5]);
    });

    it("should have required confirmations set", async function () {
      expect(await AvoMultisigAdmin.REQUIRED_CONFIRMATIONS()).to.equal(3);
    });
  });

  describe("create", function () {
    it("should create a transaction", async function () {
      await expect(AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt))
        .to.emit(AvoMultisigAdmin, "TransactionCreated")
        .withArgs(hash, signerAddresses[0], targetAddress, data, salt);
    });

    it("should create the same transaction twice with different salt", async function () {
      await AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt);
      salt = ethers.utils.keccak256("0x02");
      const encodePacked = ethers.utils.solidityPack(["address", "bytes", "bytes32"], [targetAddress, data, salt]);
      hash = ethers.utils.keccak256(encodePacked);
      hash = hash.slice(0, hash.length - 4);
      await expect(AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt))
        .to.emit(AvoMultisigAdmin, "TransactionCreated")
        .withArgs(hash, signerAddresses[0], targetAddress, data, salt);
    });

    it("should not let a non-signer create", async function () {
      await expect(AvoMultisigAdmin.connect(signers[6]).create(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__InvalidSigner"
      );
    });

    it("should revert when transaction already exists", async function () {
      await AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__TransactionAlreadyCreated"
      );
    });
  });

  describe("confirm", function () {
    beforeEach(async function () {
      await AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt);
    });

    it("should confirm a transaction", async function () {
      await expect(AvoMultisigAdmin.connect(signers[1]).confirm(targetAddress, data, salt))
        .to.emit(AvoMultisigAdmin, "TransactionConfirmed")
        .withArgs(hash, signerAddresses[1], 2);
    });

    it("should execute a transaction after confirmations", async function () {
      await AvoMultisigAdmin.connect(signers[1]).confirm(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[2]).confirm(targetAddress, data, salt))
        .to.emit(mockERC20, "Approval")
        .to.emit(AvoMultisigAdmin, "TransactionExecuted")
        .withArgs(hash, signerAddresses[2]);
    });

    it("should emit an event when the transaction execution fails", async function () {
      data = mockERC20.interface.encodeFunctionData("transferFrom", [AvoMultisigAdminAddress, signerAddresses[1], 100]);
      await AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt);
      await AvoMultisigAdmin.connect(signers[1]).confirm(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[2]).confirm(targetAddress, data, salt)).to.emit(
        AvoMultisigAdmin,
        "TransactionFailed"
      );
    });

    it("should not let a non-signer confirm", async function () {
      await expect(AvoMultisigAdmin.connect(signers[6]).confirm(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__InvalidSigner"
      );
    });

    it("should revert when transaction does not exist", async function () {
      await expect(
        AvoMultisigAdmin.connect(signers[0]).confirm(targetAddress, data, ethers.utils.keccak256("0x02"))
      ).to.be.revertedWith("AvoMultisigAdmin__TransactionNotFoundError");
    });

    it("should revert when transaction is already confirmed", async function () {
      await AvoMultisigAdmin.connect(signers[1]).confirm(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[1]).confirm(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__TransactionAlreadyConfirmed"
      );
    });

    it("should revert when transaction is already revoked", async function () {
      await AvoMultisigAdmin.connect(signers[1]).revoke(targetAddress, data, salt);
      await AvoMultisigAdmin.connect(signers[2]).revoke(targetAddress, data, salt);
      await AvoMultisigAdmin.connect(signers[3]).revoke(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[3]).confirm(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__TransactionError"
      );
    });
  });

  describe("revoke", function () {
    beforeEach(async function () {
      await AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt);
    });

    it("should revoke a transaction", async function () {
      await expect(AvoMultisigAdmin.connect(signers[1]).revoke(targetAddress, data, salt))
        .to.emit(AvoMultisigAdmin, "TransactionRevoked")
        .withArgs(hash, signerAddresses[1], 1);
    });

    it("should not let a non-signer revoke", async function () {
      await expect(AvoMultisigAdmin.connect(signers[6]).revoke(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__InvalidSigner"
      );
    });

    it("should revert when transaction does not exist", async function () {
      await expect(
        AvoMultisigAdmin.connect(signers[0]).revoke(targetAddress, data, ethers.utils.keccak256("0x02"))
      ).to.be.revertedWith("AvoMultisigAdmin__TransactionNotFoundError");
    });

    it("should revert if signer revokes the same transaction twice", async function () {
      await AvoMultisigAdmin.connect(signers[1]).revoke(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[1]).revoke(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__TransactionAlreadyRevoked"
      );
    });

    it("should revert after 3 revokations have been made", async function () {
      await AvoMultisigAdmin.connect(signers[1]).revoke(targetAddress, data, salt);
      await AvoMultisigAdmin.connect(signers[2]).revoke(targetAddress, data, salt);
      await AvoMultisigAdmin.connect(signers[3]).revoke(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[4]).revoke(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__TransactionError"
      );
    });

    it("should revert after 3 confirmations have been made", async function () {
      await AvoMultisigAdmin.connect(signers[1]).confirm(targetAddress, data, salt);
      await AvoMultisigAdmin.connect(signers[2]).confirm(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[3]).revoke(targetAddress, data, salt)).to.be.revertedWith(
        "AvoMultisigAdmin__TransactionError"
      );
    });
  });

  describe("aggregate3", () => {
    beforeEach(async () => {
      data = (
        await AvoMultisigAdmin.populateTransaction.aggregate3([
          {
            allowFailure: false,
            callData: mockERC20.interface.encodeFunctionData("approve", [signerAddresses[2], 100]),
            target: targetAddress,
          },
          {
            allowFailure: false,
            callData: mockERC20.interface.encodeFunctionData("approve", [signerAddresses[2], 0]),
            target: targetAddress,
          },
          {
            allowFailure: false,
            callData: mockERC20.interface.encodeFunctionData("approve", [signerAddresses[2], 222]),
            target: targetAddress,
          },
        ])
      ).data as string;
      targetAddress = AvoMultisigAdminAddress;

      const encodePacked = ethers.utils.solidityPack(["address", "bytes", "bytes32"], [targetAddress, data, salt]);
      hash = ethers.utils.keccak256(encodePacked);
      hash = hash.slice(0, hash.length - 4);

      await AvoMultisigAdmin.connect(signers[0]).create(targetAddress, data, salt);
    });

    it("should execute a transaction after confirmations", async function () {
      await AvoMultisigAdmin.connect(signers[1]).confirm(targetAddress, data, salt);
      await expect(AvoMultisigAdmin.connect(signers[2]).confirm(targetAddress, data, salt))
        .to.emit(mockERC20, "Approval")
        .to.emit(mockERC20, "Approval")
        .to.emit(mockERC20, "Approval")
        .to.emit(AvoMultisigAdmin, "TransactionExecuted")
        .withArgs(hash, signerAddresses[2]);
    });

    it("should revert if called directly", async function () {
      await expect(AvoMultisigAdmin.aggregate3([])).to.be.revertedWith("AvoMultisigAdmin__Unauthorized");
    });
  });
});
