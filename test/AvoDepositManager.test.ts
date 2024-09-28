import { deployments, ethers, getNamedAccounts, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { LogDescription, toUtf8Bytes } from "ethers/lib/utils";
import { BigNumber, Event } from "ethers";

import {
  AvoDepositManager,
  AvoDepositManager__factory,
  AvoFactory,
  AvocadoMultisig,
  AvocadoMultisig__factory,
  IAvoFactory,
  IAvocadoMultisigV1,
  MockERC20Token,
  AvoConfigV1,
} from "../typechain-types";
import { expect, setupContract, setupSigners } from "./util";
import { TestHelpers } from "./TestHelpers";
import { AvocadoMultisigStructs } from "../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";

describe("AvoDepositManager", () => {
  let avocadoMultisig: AvocadoMultisig & IAvocadoMultisigV1;
  let avoFactory: IAvoFactory & AvoFactory;
  let avoDepositManager: AvoDepositManager;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let mockUSDC: MockERC20Token;
  let proxyAdmin: SignerWithAddress;
  let avoConfigV1: AvoConfigV1;

  let testHelpers: TestHelpers;

  const initialWithdrawLimit = BigNumber.from(10000).mul(ethers.utils.parseEther("1"));
  const defaultDepositAmount = ethers.utils.parseEther("20000");
  const initialMinWithdrawAmount = ethers.utils.parseEther("10"); // min withdraw amount 10 mock usdc
  const initialWithdrawFee = ethers.utils.parseEther("1"); // withdraw fee 1 mock usdc

  beforeEach(async () => {
    ({ owner, user1, user2, user3, proxyAdmin } = await setupSigners());

    // setup contracts
    avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);
    avoDepositManager = await setupContract<AvoDepositManager>("AvoDepositManagerProxy", owner);
    avoConfigV1 = await setupContract<AvoConfigV1>("AvoConfigV1", owner);
    // avocadoMultisig for user 1 is already deployed through hardhat-deploy script local
    avocadoMultisig = AvocadoMultisig__factory.connect(
      await avoFactory.computeAvocado(user1.address, 0),
      user1
    ) as AvocadoMultisig & IAvocadoMultisigV1;

    const mockUSDCContractAddress = (await deployments.fixture(["MockERC20Token"]))["MOCK_USDC"]?.address;
    const mockUSDCContract = (await ethers.getContractAt("MockERC20Token", mockUSDCContractAddress)) as MockERC20Token;
    mockUSDC = mockUSDCContract.connect(user1);

    testHelpers = new TestHelpers();
  });

  describe("deployment", async () => {
    it("should deploy AvoDepositManager", async () => {
      // already deployed through hardhat-deploy script, just look if it worked
      const deployedCode = await ethers.provider.getCode(avoDepositManager.address);
      expect(deployedCode).to.not.equal("");
      expect(deployedCode).to.not.equal("0x");
    });

    it("should revert if avoFactory is set to zero address at deployment", async () => {
      const { deployer } = await getNamedAccounts();

      await expect(
        deployments.deploy("AvoDepositManager", {
          from: deployer,
          args: [ethers.constants.AddressZero, avoConfigV1.address],
        })
      ).to.be.revertedWith("");
    });

    it("should have depositToken address set", async () => {
      expect(await avoDepositManager.depositToken()).to.equal(mockUSDC.address);
    });

    it("should be paused per default", async () => {
      expect(await avoDepositManager.paused()).to.equal(true);
    });

    it("should have initializer disabled on logic contract", async () => {
      const logicContractAddress = (await deployments.fixture(["AvoDepositManager"]))["AvoDepositManager"]
        ?.address as string;

      const logicContract = (await ethers.getContractAt(
        "AvoDepositManager",
        logicContractAddress
      )) as AvoDepositManager;

      // try to initialize, should fail because disabled
      await expect(
        logicContract.initialize(
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000001",
          10,
          0,
          0
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("initialize", async () => {
    it("should revert if already initialized", async () => {
      await expect(
        avoDepositManager.initialize(
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000001",
          10,
          0,
          0
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("should set owner at initialize", async () => {
      expect(await avoDepositManager.owner()).to.equal(owner.address);
    });

    it("should set initial withdraw limit at initialize", async () => {
      expect((await avoDepositManager.systemWithdrawLimit()).eq(initialWithdrawLimit)).to.equal(true);
    });

    it("should set initial min withdraw amount at initialize", async () => {
      expect((await avoDepositManager.minWithdrawAmount()).eq(initialMinWithdrawAmount)).to.equal(true);
    });

    it("should set initial withdraw fee at initialize", async () => {
      expect((await avoDepositManager.withdrawFee()).eq(initialWithdrawFee)).to.equal(true);
    });

    it("should set initial withdraw address at initialize", async () => {
      expect(await avoDepositManager.systemWithdrawAddress()).to.equal(owner.address);
    });

    it("should revert if initialized with owner set to zero address", async () => {
      // custom deployment with proxy
      const { deployer } = await getNamedAccounts();

      const logicContractAddress = (await deployments.fixture(["AvoDepositManager"]))["AvoDepositManager"]
        ?.address as string;

      // deploy proxy uninitialized
      const newProxyDeployment = await deployments.deploy("AvoDepositManagerProxy", {
        from: deployer,
        args: [logicContractAddress, proxyAdmin.address, toUtf8Bytes("")],
      });

      const newContract = AvoDepositManager__factory.connect(newProxyDeployment.address, owner);

      await expect(
        newContract.initialize(ethers.constants.AddressZero, "0x0000000000000000000000000000000000000001", 10, 0, 0)
      ).to.be.revertedWith("AvoDepositManager__InvalidParams");
    });

    it("should revert if initialized with withdraw address set to zero address", async () => {
      // custom deployment with proxy
      const { deployer } = await getNamedAccounts();

      const logicContractAddress = (await deployments.fixture(["AvoDepositManager"]))["AvoDepositManager"]
        ?.address as string;

      // deploy proxy uninitialized
      const newProxyDeployment = await deployments.deploy("AvoDepositManagerProxy", {
        from: deployer,
        args: [logicContractAddress, proxyAdmin.address, toUtf8Bytes("")],
      });

      const newContract = AvoDepositManager__factory.connect(newProxyDeployment.address, owner);

      await expect(
        newContract.initialize("0x0000000000000000000000000000000000000001", ethers.constants.AddressZero, 10, 0, 0)
      ).to.be.revertedWith("AvoDepositManager__InvalidParams");
    });

    it("should revert if initialized with min withdraw amount < withdraw fee", async () => {
      // custom deployment with proxy
      const { deployer } = await getNamedAccounts();

      const logicContractAddress = (await deployments.fixture(["AvoDepositManager"]))["AvoDepositManager"]
        ?.address as string;

      // deploy proxy uninitialized
      const newProxyDeployment = await deployments.deploy("AvoDepositManagerProxy", {
        from: deployer,
        args: [logicContractAddress, proxyAdmin.address, toUtf8Bytes("")],
      });

      const newContract = AvoDepositManager__factory.connect(newProxyDeployment.address, owner);

      await expect(
        newContract.initialize(
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000001",
          10,
          1, // min withdraw amount
          2 // withdraw fee
        )
      ).to.be.revertedWith("AvoDepositManager__InvalidParams");
    });
  });

  context("when initial unpaused", async () => {
    beforeEach(async () => {
      // unpause contract
      await avoDepositManager.unpause();
      expect(await avoDepositManager.paused()).to.equal(false);
    });

    context("owner only actions", async () => {
      describe("renounceOwnerhsip", async () => {
        it("should revert if called", async () => {
          await expect(avoDepositManager.connect(owner).renounceOwnership()).to.be.revertedWith(
            "AvoDepositManager__Unsupported()"
          );
        });
      });

      describe("setWithdrawLimit", async () => {
        it("should setWithdrawLimit", async () => {
          const newWithdrawLimit = 2567;
          await avoDepositManager.setSystemWithdrawLimit(newWithdrawLimit);
          expect(await avoDepositManager.systemWithdrawLimit()).to.equal(newWithdrawLimit);
        });

        it("should emit event SetSystemWithdrawLimit", async () => {
          const newWithdrawLimit = 2567;
          const result = await (await avoDepositManager.setSystemWithdrawLimit(newWithdrawLimit)).wait();
          const events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("SetSystemWithdrawLimit");
          expect(events[events.length - 1].args?.systemWithdrawLimit.eq(newWithdrawLimit)).to.equal(true);
        });

        it("should revert if called by NOT owner", async () => {
          await expect(avoDepositManager.connect(user1).setSystemWithdrawLimit(325)).to.be.revertedWith(
            "Ownable: caller is not the owner"
          );
        });
      });

      describe("setWithdrawFee", async () => {
        it("should setWithdrawFee", async () => {
          const newWithdrawFee = 2567;
          await avoDepositManager.setWithdrawFee(newWithdrawFee);
          expect(await avoDepositManager.withdrawFee()).to.equal(newWithdrawFee);
        });

        it("should emit event SetWithdrawFee", async () => {
          const newWithdrawFee = 2567;
          const result = await (await avoDepositManager.setWithdrawFee(newWithdrawFee)).wait();
          const events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("SetWithdrawFee");
          expect(events[events.length - 1].args?.withdrawFee.eq(newWithdrawFee)).to.equal(true);
        });

        it("should revert if min withdraw amount < withdraw fee", async () => {
          await expect(avoDepositManager.setWithdrawFee(ethers.utils.parseEther("10000"))).to.be.revertedWith(
            "AvoDepositManager__InvalidParams"
          );
        });

        it("should revert if called by NOT owner", async () => {
          await expect(avoDepositManager.connect(user1).setWithdrawFee(325)).to.be.revertedWith(
            "Ownable: caller is not the owner"
          );
        });
      });

      describe("setMinWithdrawAmount", async () => {
        it("should setMinWithdrawAmount", async () => {
          const newMinWithdrawAmount = ethers.utils.parseEther("25667");
          await avoDepositManager.setMinWithdrawAmount(newMinWithdrawAmount);
          expect(await avoDepositManager.minWithdrawAmount()).to.equal(newMinWithdrawAmount);
        });

        it("should emit event SetMinWithdrawAmount", async () => {
          const newMinWithdrawAmount = ethers.utils.parseEther("25667");
          const result = await (await avoDepositManager.setMinWithdrawAmount(newMinWithdrawAmount)).wait();
          const events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("SetMinWithdrawAmount");
          expect(events[events.length - 1].args?.minWithdrawAmount.eq(newMinWithdrawAmount)).to.equal(true);
        });

        it("should revert if min withdraw amount < withdraw fee", async () => {
          await expect(avoDepositManager.setMinWithdrawAmount(1000)).to.be.revertedWith(
            "AvoDepositManager__InvalidParams"
          );
        });

        it("should revert if called by NOT owner", async () => {
          await expect(avoDepositManager.connect(user1).setSystemWithdrawLimit(325)).to.be.revertedWith(
            "Ownable: caller is not the owner"
          );
        });
      });

      describe("setSystemWithdrawAddress", async () => {
        it("should setSystemWithdrawAddress", async () => {
          expect(await avoDepositManager.systemWithdrawAddress()).to.not.equal(user2.address);
          await avoDepositManager.setSystemWithdrawAddress(user2.address);
          expect(await avoDepositManager.systemWithdrawAddress()).to.equal(user2.address);
        });

        it("should emit event SetSystemWithdrawAddress", async () => {
          const result = await (await avoDepositManager.setSystemWithdrawAddress(user2.address)).wait();
          const events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("SetSystemWithdrawAddress");
          expect(events[events.length - 1].args?.systemWithdrawAddress).to.equal(user2.address);
        });

        it("should revert if called by NOT owner", async () => {
          await expect(avoDepositManager.connect(user1).setSystemWithdrawAddress(user2.address)).to.be.revertedWith(
            "Ownable: caller is not the owner"
          );
        });

        it("should revert if set to invalid address (zero address)", async () => {
          await expect(avoDepositManager.setSystemWithdrawAddress(ethers.constants.AddressZero)).to.be.revertedWith(
            "AvoDepositManager__InvalidParams"
          );
        });
      });

      describe("setAuth", async () => {
        it("should setAuth:enable", async () => {
          expect(await avoDepositManager.isAuth(user2.address)).to.equal(false);
          await avoDepositManager.setAuth(user2.address, true);
          expect(await avoDepositManager.isAuth(user2.address)).to.equal(true);
        });

        it("should setAuth:disable", async () => {
          await avoDepositManager.setAuth(user2.address, true);
          expect(await avoDepositManager.isAuth(user2.address)).to.equal(true);
          await avoDepositManager.setAuth(user2.address, false);
          expect(await avoDepositManager.isAuth(user2.address)).to.equal(false);
        });

        it("should emit event SetAuth", async () => {
          const result = await (await avoDepositManager.setAuth(user2.address, true)).wait();
          const events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("SetAuth");
          expect(events[events.length - 1].args?.auth).to.equal(user2.address);
          expect(events[events.length - 1].args?.allowed).to.equal(true);
        });

        it("should revert if called by NOT owner", async () => {
          await expect(avoDepositManager.connect(user1).setAuth(user2.address, true)).to.be.revertedWith(
            "Ownable: caller is not the owner"
          );
        });

        it("should revert if setting for invalid address (zero address)", async () => {
          await expect(avoDepositManager.setAuth(ethers.constants.AddressZero, true)).to.be.revertedWith(
            "AvoDepositManager__InvalidParams"
          );
        });
      });

      describe("unpause", async () => {
        beforeEach(async () => {
          await avoDepositManager.pause();
        });

        it("should unpause", async () => {
          expect(await avoDepositManager.paused()).to.equal(true);
          await avoDepositManager.unpause();
          expect(await avoDepositManager.paused()).to.equal(false);
        });

        it("should revert if called by NOT owner", async () => {
          await expect(avoDepositManager.connect(user1).unpause()).to.be.revertedWith(
            "Ownable: caller is not the owner"
          );
        });

        it("should revert if called by auth", async () => {
          await avoDepositManager.setAuth(user2.address, true);
          await expect(avoDepositManager.connect(user2).unpause()).to.be.revertedWith(
            "Ownable: caller is not the owner"
          );
        });
      });
    });

    context("auth only actions", async () => {
      beforeEach(async () => {
        await avoDepositManager.setAuth(user2.address, true);
      });

      describe("isAuth", async () => {
        it("should owner is auth by default", async () => {
          expect(await avoDepositManager.isAuth(owner.address)).to.equal(true);
        });

        // @dev rest of functionality is tested indirectly through other tests
      });

      describe("pause", async () => {
        it("should pause", async () => {
          expect(await avoDepositManager.paused()).to.equal(false);
          await avoDepositManager.connect(user2).pause();
          expect(await avoDepositManager.paused()).to.equal(true);
        });

        it("should pause as owner", async () => {
          expect(await avoDepositManager.paused()).to.equal(false);
          await avoDepositManager.pause();
          expect(await avoDepositManager.paused()).to.equal(true);
        });

        it("should revert if called by NOT auth", async () => {
          await expect(avoDepositManager.connect(user1).pause()).to.be.revertedWith("AvoDepositManager__Unauthorized");
        });
      });

      describe("systemWithdraw", async () => {
        beforeEach(async () => {
          // deposit
          await mockUSDC.approve(avoDepositManager.address, defaultDepositAmount.mul(2));
          await avoDepositManager.connect(user1).depositOnBehalf(avocadoMultisig.address, defaultDepositAmount.mul(2));

          // set withdraw address
          await avoDepositManager.connect(owner).setSystemWithdrawAddress(user2.address);
        });

        it("should systemWithdraw", async () => {
          // 1. set withdraw limit
          await avoDepositManager.setSystemWithdrawLimit(0);

          // 2. withdraw to user2
          expect((await mockUSDC.balanceOf(user2.address)).eq(0)).to.equal(true);
          await avoDepositManager.connect(user2).systemWithdraw();

          // 3. assert results
          expect((await mockUSDC.balanceOf(avoDepositManager.address)).eq(0)).to.equal(true);
          expect((await mockUSDC.balanceOf(user2.address)).eq(defaultDepositAmount.mul(2))).to.equal(true);
        });

        it("should systemWithdraw down to withdrawLimit", async () => {
          // 2. withdraw to user2
          expect((await mockUSDC.balanceOf(user2.address)).eq(0)).to.equal(true);
          await avoDepositManager.systemWithdraw();

          // 3. assert results
          expect((await mockUSDC.balanceOf(avoDepositManager.address)).eq(initialWithdrawLimit)).to.equal(true);
          expect(
            (await mockUSDC.balanceOf(user2.address)).eq(defaultDepositAmount.mul(2).sub(initialWithdrawLimit))
          ).to.equal(true);
        });

        it("should execute if paused", async () => {
          await avoDepositManager.pause();
          await avoDepositManager.systemWithdraw();
          expect((await mockUSDC.balanceOf(avoDepositManager.address)).eq(initialWithdrawLimit)).to.equal(true);
        });

        it("should revert if called by NOT auth", async () => {
          await expect(avoDepositManager.connect(user1).systemWithdraw()).to.be.revertedWith(
            "AvoDepositManager__Unauthorized"
          );
        });
      });
    });

    describe("depositOnBehalf", async () => {
      it("should depositOnBehalf", async () => {
        expect((await mockUSDC.balanceOf(avoDepositManager.address)).toNumber()).to.equal(0);

        await mockUSDC.approve(avoDepositManager.address, defaultDepositAmount);
        await avoDepositManager.connect(user1).depositOnBehalf(avocadoMultisig.address, defaultDepositAmount);

        expect((await mockUSDC.balanceOf(avoDepositManager.address)).eq(defaultDepositAmount)).to.equal(true);
      });

      it("should emit event Deposit", async () => {
        await mockUSDC.approve(avoDepositManager.address, defaultDepositAmount);
        const result = await (
          await avoDepositManager.connect(user1).depositOnBehalf(avocadoMultisig.address, defaultDepositAmount)
        ).wait();

        const events = result.events as Event[];
        expect(events[events.length - 1].event).to.equal("Deposit");

        expect(events[events.length - 1].args?.sender).to.equal(user1.address);
        expect(events[events.length - 1].args?.avocado).to.equal(avocadoMultisig.address);
        expect(events[events.length - 1].args?.amount).to.equal(defaultDepositAmount);
      });

      it("should execute if paused", async () => {
        await avoDepositManager.pause();

        await mockUSDC.approve(avoDepositManager.address, defaultDepositAmount);
        await avoDepositManager.connect(user1).depositOnBehalf(avocadoMultisig.address, defaultDepositAmount);

        expect((await mockUSDC.balanceOf(avoDepositManager.address)).eq(defaultDepositAmount)).to.equal(true);
      });
    });

    context("withdraw functionalities", async () => {
      beforeEach(async () => {
        // deposit
        await mockUSDC.approve(avoDepositManager.address, defaultDepositAmount.mul(2));
        await avoDepositManager.connect(user1).depositOnBehalf(avocadoMultisig.address, defaultDepositAmount.mul(2));

        // set withdraw address
        await avoDepositManager.connect(owner).setSystemWithdrawAddress(user2.address);
      });

      describe("requestWithdraw", async () => {
        const subject = async (amount = defaultDepositAmount) => {
          // request withdraw must come from an Avocado
          const actions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: avoDepositManager.address,
              data: (await avoDepositManager.populateTransaction.requestWithdraw(amount)).data as any,
              value: 0,
              operation: 0,
            },
          ];

          return testHelpers.executeActions(avocadoMultisig, user1, actions);
        };

        it("should requestWithdraw", async () => {
          const result = await (await subject()).wait();

          const events = result.events as Event[];
          const parsedLog: LogDescription = new ethers.utils.Interface(AvoDepositManager__factory.abi).parseLog(
            events[0]
          );
          const uniqueId = parsedLog.args?.id;

          const withdrawRequest = await avoDepositManager.withdrawRequests(uniqueId);
          expect(withdrawRequest.to).to.equal(avocadoMultisig.address);
          expect(withdrawRequest.amount).to.equal(defaultDepositAmount);
        });

        it("should requestWithdraw for a MultiSig", async () => {
          // request withdraw must come from an Avocado
          const actions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: avoDepositManager.address,
              data: (await avoDepositManager.populateTransaction.requestWithdraw(defaultDepositAmount)).data as any,
              value: 0,
              operation: 0,
            },
          ];

          // AvocadoMultisig for user1 is already deployed through hardhat-deploy script local
          const avocadoMultisig = AvocadoMultisig__factory.connect(
            await avoFactory.computeAvocado(user1.address, 0),
            user1
          ) as AvocadoMultisig & IAvocadoMultisigV1;

          const testHelpersMultiSig = new TestHelpers();
          const result = await (await testHelpersMultiSig.executeActions(avocadoMultisig, user1, actions)).wait();

          const events = result.events as Event[];
          const parsedLog: LogDescription = new ethers.utils.Interface(AvoDepositManager__factory.abi).parseLog(
            events[0]
          );
          const uniqueId = parsedLog.args?.id;

          const withdrawRequest = await avoDepositManager.withdrawRequests(uniqueId);
          expect(withdrawRequest.to).to.equal(avocadoMultisig.address);
          expect(withdrawRequest.amount).to.equal(defaultDepositAmount);
        });

        it("should emit Event WithdrawRequested", async () => {
          const result = await (await subject()).wait();

          const events = result.events as Event[];
          expect(events[events.length - 2].event).to.equal("CastExecuted");

          // parse log to get AvoDepositManager events
          const parsedLog: LogDescription = new ethers.utils.Interface(AvoDepositManager__factory.abi).parseLog(
            events[0]
          );
          expect(parsedLog.name).to.equal("WithdrawRequested");

          expect(parsedLog.args?.avocado).to.equal(avocadoMultisig.address);
          expect(parsedLog.args?.amount.eq(defaultDepositAmount)).to.equal(true);

          const uniqueId = parsedLog.args?.id;
          expect(uniqueId).to.not.equal("");
          expect(uniqueId).to.not.equal("0x");
        });

        it("should create unique ids", async () => {
          const result = await (await subject()).wait();
          let events = result.events as Event[];
          let parsedLog: LogDescription = new ethers.utils.Interface(AvoDepositManager__factory.abi).parseLog(
            events[0]
          );
          const uniqueId1 = parsedLog.args?.id;

          const result2 = await (await subject()).wait();
          events = result2.events as Event[];
          parsedLog = new ethers.utils.Interface(AvoDepositManager__factory.abi).parseLog(events[0]);
          const uniqueId2 = parsedLog.args?.id;

          expect(uniqueId1).to.not.equal(uniqueId2);
        });

        it("should revert if id non-unique", async () => {
          const actions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: avoDepositManager.address,
              data: (await avoDepositManager.populateTransaction.requestWithdraw(defaultDepositAmount)).data as any,
              value: 0,
              operation: 0,
            },
            {
              target: avoDepositManager.address,
              data: (await avoDepositManager.populateTransaction.requestWithdraw(defaultDepositAmount)).data as any,
              value: 0,
              operation: 0,
            },
          ];
          const result = await (await testHelpers.executeActions(avocadoMultisig, user1, actions)).wait();

          const events = result.events as Event[];
          expect(events.length).to.equal(2);
          // event at position 1 is FeePaid event of Avo smart wallet
          expect(events[0].event).to.equal("CastFailed");

          // 1_CUSTOM_ERROR: 0xde39979e keccak256 selector of AvoDepositManager__RequestAlreadyExist()
          expect(events[0].args?.reason).to.equal("1_CUSTOM_ERROR: 0xde39979e. PARAMS_RAW: ");
        });

        it("should revert if paused", async () => {
          await avoDepositManager.pause();

          const result = await (await subject()).wait();
          const events = result.events as Event[];
          expect(events.length).to.equal(2);
          // event at position 1 is FeePaid event of Avo smart wallet
          expect(events[0].event).to.equal("CastFailed");
          expect(events[0].args?.reason).to.equal("0_Pausable: paused");
        });

        it("should revert if amount is 0", async () => {
          await avoDepositManager.setWithdrawFee(0);
          await avoDepositManager.setMinWithdrawAmount(0);

          const result = await (await subject(BigNumber.from(0))).wait();
          const events = result.events as Event[];
          expect(events.length).to.equal(2);
          // event at position 1 is FeePaid event of Avo smart wallet
          expect(events[0].event).to.equal("CastFailed");
          // 0_CUSTOM_ERROR: 0xab557dc8 keccak256 selector of AvoDepositManager__MinWithdraw()
          expect(events[0].args?.reason).to.equal("0_CUSTOM_ERROR: 0xab557dc8. PARAMS_RAW: ");
        });

        it("should revert if amount is < min withdraw amount", async () => {
          const result = await (await subject((await avoDepositManager.minWithdrawAmount()).sub(1))).wait();
          const events = result.events as Event[];
          expect(events.length).to.equal(2);
          // event at position 1 is FeePaid event of Avo smart wallet
          expect(events[0].event).to.equal("CastFailed");
          // 0_CUSTOM_ERROR: 0xab557dc8 keccak256 selector of AvoDepositManager__MinWithdraw()
          expect(events[0].args?.reason).to.equal("0_CUSTOM_ERROR: 0xab557dc8. PARAMS_RAW: ");
        });

        it("should revert if msg.sender is not an Avocado", async () => {
          await expect(avoDepositManager.requestWithdraw(defaultDepositAmount)).to.be.revertedWith(
            "AvoDepositManager__Unauthorized"
          );
        });
      });

      describe("requestSourceWithdraw", async () => {
        const subject = async (amount = defaultDepositAmount) => {
          return avoDepositManager.connect(user2).requestSourceWithdraw(amount, { gasLimit: 400000 });
        };

        it("should requestSourceWithdraw", async () => {
          const result = await (await subject()).wait();

          const events = result.events as Event[];
          const event = events[events.length - 1];
          const uniqueId = event.args?.id;

          const withdrawRequest = await avoDepositManager.withdrawRequests(uniqueId);
          expect(withdrawRequest.to).to.equal(user2.address);
          expect(withdrawRequest.amount).to.equal(defaultDepositAmount);
        });

        it("should emit Event SourceWithdrawRequested", async () => {
          const result = await (await subject()).wait();

          const events = result.events as Event[];
          const event = events[events.length - 1];
          expect(event.event).to.equal("SourceWithdrawRequested");
          expect(event.args?.user).to.equal(user2.address);
          expect(event.args?.amount.eq(defaultDepositAmount)).to.equal(true);
        });

        it("should create unique ids", async () => {
          const result = await (await subject()).wait();
          let events = result.events as Event[];
          let event = events[events.length - 1];
          const uniqueId1 = event.args?.id;

          const result2 = await (await subject()).wait();
          events = result2.events as Event[];
          event = events[events.length - 1];
          const uniqueId2 = event.args?.id;

          expect(uniqueId1).to.not.equal(uniqueId2);
        });

        it("should revert if id non-unique", async () => {
          // switch to manual block mining to include two txs in the same block
          await network.provider.send("evm_setAutomine", [false]);
          await network.provider.send("evm_setIntervalMining", [0]);

          const tx1 = await subject();
          const tx2 = await subject();

          // trigger mining the block
          await network.provider.send("evm_mine");

          await tx1.wait();

          try {
            await tx2.wait();

            // force catch block, as expected tx2 should revert
            expect(true).to.equal(false);
          } catch (ex: any) {
            // can not use expect to be revertedWith for this case with manual mining
            expect(ex.code).to.equal("CALL_EXCEPTION");
          }

          // re-enable automatic mining
          await network.provider.send("evm_setAutomine", [true]);
        });

        it("should revert if paused", async () => {
          await avoDepositManager.pause();

          await expect(subject()).to.be.revertedWith("Pausable: paused");
        });

        it("should revert if amount is 0", async () => {
          await avoDepositManager.setWithdrawFee(0);
          await avoDepositManager.setMinWithdrawAmount(0);

          await expect(subject(BigNumber.from(0))).to.be.revertedWith("AvoDepositManager__MinWithdraw()");
        });

        it("should revert if amount is < min withdraw amount", async () => {
          await expect(subject((await avoDepositManager.minWithdrawAmount()).sub(1))).to.be.revertedWith(
            "AvoDepositManager__MinWithdraw()"
          );
        });
      });

      describe("processWithdraw", async () => {
        let withdrawRequestId: string;
        beforeEach(async () => {
          // create withdraw request
          const actions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: avoDepositManager.address,
              data: (await avoDepositManager.populateTransaction.requestWithdraw(defaultDepositAmount)).data as any,
              value: 0,
              operation: 0,
            },
          ];

          const result = await (await testHelpers.executeActions(avocadoMultisig, user1, actions)).wait();

          const events = result.events as Event[];
          const parsedLog = new ethers.utils.Interface(AvoDepositManager__factory.abi).parseLog(events[0]);
          withdrawRequestId = parsedLog.args?.id;

          // set auth
          await avoDepositManager.connect(owner).setAuth(user1.address, true);
        });

        it("should processWithdraw (by auth)", async () => {
          expect((await mockUSDC.balanceOf(avocadoMultisig.address)).eq(0)).to.equal(true);
          expect((await mockUSDC.balanceOf(avoDepositManager.address)).eq(defaultDepositAmount.mul(2))).to.equal(true);

          await avoDepositManager.connect(user1).processWithdraw(withdrawRequestId);

          expect(
            (await mockUSDC.balanceOf(avocadoMultisig.address)).eq(defaultDepositAmount.sub(initialWithdrawFee))
          ).to.equal(true);
          expect(
            (await mockUSDC.balanceOf(avoDepositManager.address)).eq(defaultDepositAmount.add(initialWithdrawFee))
          ).to.equal(true);
        });

        it("should processWithdraw triggered by owner", async () => {
          await avoDepositManager.connect(owner).processWithdraw(withdrawRequestId);

          expect(
            (await mockUSDC.balanceOf(avocadoMultisig.address)).eq(defaultDepositAmount.sub(initialWithdrawFee))
          ).to.equal(true);
          expect(
            (await mockUSDC.balanceOf(avoDepositManager.address)).eq(defaultDepositAmount.add(initialWithdrawFee))
          ).to.equal(true);
        });

        it("should emit Event WithdrawProcessed", async () => {
          const result = await (
            await avoDepositManager.connect(owner).processWithdraw(withdrawRequestId, { gasLimit: 16000000 })
          ).wait();

          const events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("WithdrawProcessed");

          expect(events[events.length - 1].args?.user).to.equal(avocadoMultisig.address);
          expect(events[events.length - 1].args?.amount).to.equal(defaultDepositAmount.sub(initialWithdrawFee));
          expect(events[events.length - 1].args?.id).to.equal(withdrawRequestId);
          expect(events[events.length - 1].args?.fee).to.equal(initialWithdrawFee);
        });

        it("should revert if paused", async () => {
          await avoDepositManager.pause();
          await expect(
            avoDepositManager.processWithdraw("0x13db99e3472e9f8f992cf71f14c520f7e410ca21766670c39d7775f3f39bab8f")
          ).to.be.revertedWith("Pausable: paused");
        });

        it("should revert if fee is not covered by withdraw amount", async () => {
          // set fee to be higher than withdraw amount
          await avoDepositManager.setMinWithdrawAmount(defaultDepositAmount.add(10));
          await avoDepositManager.setWithdrawFee(defaultDepositAmount.add(1));

          await expect(avoDepositManager.processWithdraw(withdrawRequestId)).to.be.revertedWith(
            "AvoDepositManager__FeeNotCovered"
          );
        });

        it("should revert if request id does not exist", async () => {
          await expect(
            avoDepositManager.processWithdraw("0x13db99e3472e9f8f992cf71f14c520f7e410ca21766670c39d7775f3f39bab8f")
          ).to.be.revertedWith("AvoDepositManager__RequestNotExist");
        });

        it("should revert if called by NOT auth", async () => {
          await expect(avoDepositManager.connect(user2).processWithdraw(withdrawRequestId)).to.be.revertedWith(
            "AvoDepositManager__Unauthorized"
          );
        });
      });

      describe("removeWithdrawRequest", async () => {
        let withdrawRequestId: string;
        beforeEach(async () => {
          // create withdraw request
          const actions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: avoDepositManager.address,
              data: (await avoDepositManager.populateTransaction.requestWithdraw(defaultDepositAmount)).data as any,
              value: 0,
              operation: 0,
            },
          ];

          const result = await (await testHelpers.executeActions(avocadoMultisig, user1, actions)).wait();

          const events = result.events as Event[];
          const parsedLog = new ethers.utils.Interface(AvoDepositManager__factory.abi).parseLog(events[0]);
          withdrawRequestId = parsedLog.args?.id;

          // set auth
          await avoDepositManager.connect(owner).setAuth(user1.address, true);
        });

        it("should removeWithdrawRequest", async () => {
          let withdrawRequest = await avoDepositManager.withdrawRequests(withdrawRequestId);
          expect(withdrawRequest.amount.eq(defaultDepositAmount)).to.equal(true);
          expect(withdrawRequest.to).to.equal(avocadoMultisig.address);
          await avoDepositManager.connect(user1).removeWithdrawRequest(withdrawRequestId);
          withdrawRequest = await avoDepositManager.withdrawRequests(withdrawRequestId);
          expect(withdrawRequest.amount.eq(0)).to.equal(true);
          expect(withdrawRequest.to).to.equal(ethers.constants.AddressZero);
        });

        it("should removeWithdrawRequest triggered by owner", async () => {
          let withdrawRequest = await avoDepositManager.withdrawRequests(withdrawRequestId);
          expect(withdrawRequest.amount.eq(defaultDepositAmount)).to.equal(true);
          expect(withdrawRequest.to).to.equal(avocadoMultisig.address);
          await avoDepositManager.connect(owner).removeWithdrawRequest(withdrawRequestId);
          withdrawRequest = await avoDepositManager.withdrawRequests(withdrawRequestId);
          expect(withdrawRequest.amount.eq(0)).to.equal(true);
          expect(withdrawRequest.to).to.equal(ethers.constants.AddressZero);
        });

        it("should removeWithdrawRequest triggered by withdraw receiver", async () => {
          let withdrawRequest = await avoDepositManager.withdrawRequests(withdrawRequestId);
          expect(withdrawRequest.amount.eq(defaultDepositAmount)).to.equal(true);
          expect(withdrawRequest.to).to.equal(avocadoMultisig.address);

          // create withdraw request
          const actions: AvocadoMultisigStructs.ActionStruct[] = [
            {
              target: avoDepositManager.address,
              data: (await avoDepositManager.populateTransaction.removeWithdrawRequest(withdrawRequestId)).data as any,
              value: 0,
              operation: 0,
            },
          ];

          await testHelpers.executeActions(avocadoMultisig, user1, actions);

          withdrawRequest = await avoDepositManager.withdrawRequests(withdrawRequestId);
          expect(withdrawRequest.amount.eq(0)).to.equal(true);
          expect(withdrawRequest.to).to.equal(ethers.constants.AddressZero);
        });

        it("should emit Event WithdrawRemoved", async () => {
          const result = await (await avoDepositManager.connect(owner).removeWithdrawRequest(withdrawRequestId)).wait();

          const events = result.events as Event[];
          expect(events[events.length - 1].event).to.equal("WithdrawRemoved");
          expect(events[events.length - 1].args?.id).to.equal(withdrawRequestId);
        });

        it("should revert if request id does not exist", async () => {
          await expect(
            avoDepositManager.removeWithdrawRequest(
              "0x13db99e3472e9f8f992cf71f14c520f7e410ca21766670c39d7775f3f39bab8f"
            )
          ).to.be.revertedWith("AvoDepositManager__RequestNotExist");
        });

        it("should revert if called by NOT auth, owner or withdraw receiver", async () => {
          await expect(avoDepositManager.connect(user3).removeWithdrawRequest(withdrawRequestId)).to.be.revertedWith(
            "AvoDepositManager__Unauthorized"
          );
        });

        it("should execute if paused", async () => {
          await avoDepositManager.pause();

          let withdrawRequest = await avoDepositManager.withdrawRequests(withdrawRequestId);
          expect(withdrawRequest.amount.eq(defaultDepositAmount)).to.equal(true);
          expect(withdrawRequest.to).to.equal(avocadoMultisig.address);
          await avoDepositManager.connect(owner).removeWithdrawRequest(withdrawRequestId);
          withdrawRequest = await avoDepositManager.withdrawRequests(withdrawRequestId);
          expect(withdrawRequest.amount.eq(0)).to.equal(true);
          expect(withdrawRequest.to).to.equal(ethers.constants.AddressZero);
        });
      });
    });
  });
});
