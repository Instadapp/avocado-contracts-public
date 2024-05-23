import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Event } from "ethers";
import { parseEther, toUtf8Bytes, LogDescription } from "ethers/lib/utils";

import {
  AvoFactory,
  IAvoFactory,
  IWETH9,
  InstaFlashAggregatorInterface,
  MockDeposit__factory,
  IWETH9__factory,
  InstaFlashAggregatorInterface__factory,
  MockDeposit,
  AvoRegistry__factory,
  AvocadoMultisig,
  IAvocadoMultisigV1,
  AvocadoMultisig__factory,
  MockDelegateCallTargetMultisig,
  MockDelegateCallTargetMultisig__factory,
} from "../../typechain-types";
import { expect, setupSigners, setupContract, onlyForked } from "../util";
import { TestHelpers } from "../TestHelpers";
import { AvocadoMultisigStructs } from "../../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";

const instaFlashAggregatorMainnet = "0x619Ad2D02dBeE6ebA3CDbDA3F98430410e892882";
const instaFlashResolverMainnet = "0x10c7B513b7d37f40bdBCE77183b9112ec35CAec1";
const wethMainnet = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const wethWhaleMainnet = "0x2feb1512183545f48f6b9c5b4ebfcaf49cfca6f3";

onlyForked(async () => {
  describe("AvocadoMultisig Flashloan (only local, not in CI)", () => {
    let avocadoMultisig: AvocadoMultisig & IAvocadoMultisigV1;
    let avoFactory: IAvoFactory & AvoFactory;
    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;

    let weth: IWETH9;
    let flResolver: Contract;
    let flAggregator: InstaFlashAggregatorInterface;
    let mockDeposit: MockDeposit;
    let mockDelegateCallTarget: MockDelegateCallTargetMultisig;

    // flashloan depends on forked network, doesn't work in CI
    beforeEach(async () => {
      ({ owner, user1, user2 } = await setupSigners());

      // setup contracts
      avoFactory = await setupContract<AvoFactory>("AvoFactoryProxy", owner);

      // avocadoMultisig for user 1 is already deployed through hardhat-deploy script local
      avocadoMultisig = AvocadoMultisig__factory.connect(
        await avoFactory.computeAvocado(user1.address, 0),
        user1
      ) as AvocadoMultisig & IAvocadoMultisigV1;

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

      // send weth from whale to user 1
      await user1.sendTransaction({ to: wethWhaleMainnet, value: ethers.utils.parseEther("2") });
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [wethWhaleMainnet],
      });
      await weth
        .connect(await ethers.getSigner(wethWhaleMainnet))
        .transfer(user1.address, ethers.utils.parseEther("2000"));

      // deploy mock delegate call contract
      const mockDelegateCallTargetFactory = (await ethers.getContractFactory(
        "MockDelegateCallTargetMultisig",
        owner
      )) as MockDelegateCallTargetMultisig__factory;
      mockDelegateCallTarget = await mockDelegateCallTargetFactory.deploy();
      await mockDelegateCallTarget.deployed();
    });

    it("should execute setup", async () => {
      expect((await weth.balanceOf(user1.address)).gt(ethers.utils.parseEther("1900"))).to.equal(true);
    });

    //#region local test helpers
    let testHelpers: TestHelpers;

    const flashloanActionsTypesTuple = "tuple(address target,bytes data,uint256 value,uint256 operation)[]";
    let flRoute: number;
    let flFee: BigNumber;
    let avoWethBalanceBefore: BigNumber;
    let avoContract: IAvocadoMultisigV1 & AvocadoMultisig;

    beforeEach(async () => {
      testHelpers = new TestHelpers();
      // deposit WETH in Avo smart wallet to cover flashloan fees for test case
      avoContract = avocadoMultisig;

      await weth.connect(user1).transfer(avoContract.address, ethers.utils.parseEther("50"));
      avoWethBalanceBefore = await weth.balanceOf(avoContract.address);

      // get flashloan route data
      const flData = await flResolver.getData([weth.address], [ethers.utils.parseEther("3000")]);
      flRoute = flData.bestRoutes_[1];
      flFee = ethers.utils.parseEther("3000").div(10000).mul(flData.bestFee_);
    });

    it("should execute flashloan via flashloan aggregator with call actions", async () => {
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
        [flashloanActionsTypesTuple],
        [flashLoanActions]
      );

      const actions: AvocadoMultisigStructs.ActionStruct[] = [
        // get flashloan 1000 WETH
        {
          target: flAggregator.address,
          data: new ethers.utils.Interface(InstaFlashAggregatorInterface__factory.abi).encodeFunctionData("flashLoan", [
            [weth.address], // tokens
            [ethers.utils.parseEther("3000")], // amounts
            flRoute, // route
            flashLoanActionsBytes, // calldata data (actions that will be executed in flashloan executeOperation callback)
            toUtf8Bytes(""),
          ]),
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

      const result = await (
        await testHelpers.executeActions(avoContract, user1, actions, {
          ...TestHelpers.testParams.params,
          actions,
          id: 20, // id = flashloan call
        })
      ).wait();

      const events = result.events as Event[];

      const parsedLogs: LogDescription[] = [];

      let intrfc;
      events.forEach((log: any, index: number) => {
        try {
          // try parse with WETH
          intrfc = new ethers.utils.Interface(IWETH9__factory.abi);
          let parsedLog = intrfc.parseLog(log);
          parsedLogs[index] = parsedLog;
        } catch (ex) {
          try {
            // try parse with MockDeposit
            intrfc = new ethers.utils.Interface(MockDeposit__factory.abi);
            let parsedLog = intrfc.parseLog(log);
            parsedLogs[index] = parsedLog;
          } catch (ex) {
            try {
              // try parse with InstaFlashAggregator
              intrfc = new ethers.utils.Interface(InstaFlashAggregatorInterface__factory.abi);
              let parsedLog = intrfc.parseLog(log);
              parsedLogs[index] = parsedLog;
            } catch (ex) {
              try {
                // try parse with InstaFlashAggregator
                intrfc = new ethers.utils.Interface(AvoRegistry__factory.abi);
                let parsedLog = intrfc.parseLog(log);
                parsedLogs[index] = parsedLog;
              } catch (ex) {}
            }
          }
        }
      });

      // events / logs should include:
      // 2 transfer before approval -> flashloan from fla provider to aggregator to Avo smart wallet
      // 1 approval to mock deposit contract
      // 1 transfer in mock deposit
      // 1 mock deposit
      // 1 transfer in mock withdrawal
      // 1 mock withdraw
      // 2 transfer -> flashloan plus fees from Avo smart wallet to aggregator to fla provider
      // 1 logflashloan
      // 1 transfer -> test transfer after flashloan to user 2
      // 1 CastExecuted
      // 1 FeePaid
      expect(parsedLogs.filter((x) => x.name === "Transfer").length).to.equal(7);
      expect(parsedLogs.filter((x) => x.name === "Approval").length).to.equal(1);
      expect(parsedLogs.filter((x) => x.name === "Deposit").length).to.equal(1);
      expect(parsedLogs.filter((x) => x.name === "Withdraw").length).to.equal(1);
      expect(parsedLogs.filter((x) => x.name === "LogFlashloan").length).to.equal(1);
      expect(events[events.length - 2].event).to.equal("CastExecuted");
      expect(events[events.length - 1].event).to.equal("FeePaid");

      const avoWethBalanceAfter = await weth.balanceOf(avocadoMultisig.address);

      expect(
        // avo smart wallet should spend fee + 1 WETH to user 2
        avoWethBalanceBefore.sub(avoWethBalanceAfter).eq(flFee.add(ethers.utils.parseEther("1")))
      ).to.equal(true);

      // user 2 should have received 1 WETH from last action
      expect((await weth.balanceOf(user2.address)).eq(ethers.utils.parseEther("1"))).to.equal(true);
    });

    it("should reset _transientAllowHash and _transientId in executeOperation() flashloan callback", async () => {
      // prepare actions
      let mockDelegateCallTarget: MockDelegateCallTargetMultisig;

      // deploy mock delegate call contract
      const mockDelegateCallTargetFactory = (await ethers.getContractFactory(
        "MockDelegateCallTargetMultisig",
        owner
      )) as MockDelegateCallTargetMultisig__factory;
      mockDelegateCallTarget = await mockDelegateCallTargetFactory.deploy();
      await mockDelegateCallTarget.deployed();

      // actions to be executed in flashloan executeOperation callback
      const flashLoanActions: AvocadoMultisigStructs.ActionStruct[] = [
        // revert if allowHash is not set to reset value
        {
          target: mockDelegateCallTarget.address,
          // in action 1, revert if allow hash is (still) set
          data: (await mockDelegateCallTarget.populateTransaction.revertIfTransientAllowHashSet()).data as any,
          value: 0,
          operation: 1,
        },
        {
          target: mockDelegateCallTarget.address,
          // in action 1, revert if transient id is (still) set
          data: (await mockDelegateCallTarget.populateTransaction.revertIfTransientIdSet()).data as any,
          value: 0,
          operation: 1,
        },
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
        [flashloanActionsTypesTuple],
        [flashLoanActions]
      );

      const actions: AvocadoMultisigStructs.ActionStruct[] = [
        // get flashloan 1000 WETH
        {
          target: flAggregator.address,
          data: new ethers.utils.Interface(InstaFlashAggregatorInterface__factory.abi).encodeFunctionData("flashLoan", [
            [weth.address], // tokens
            [ethers.utils.parseEther("3000")], // amounts
            flRoute, // route
            flashLoanActionsBytes, // calldata data (actions that will be executed in flashloan executeOperation callback)
            toUtf8Bytes(""),
          ]),
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

      const result = await (
        await testHelpers.executeActions(avoContract, user1, actions, {
          ...TestHelpers.testParams.params,
          actions,
          id: 21, // id = flashloan mixed
        })
      ).wait();

      const events = result.events as Event[];
      expect(events[events.length - 2].event).to.equal("CastExecuted");
    });

    it("should execute flashloan via flashloan aggregator with call and delegatecall actions", async () => {
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
        // delegate call action
        {
          operation: 1,
          target: mockDelegateCallTarget.address,
          data: new ethers.utils.Interface(MockDelegateCallTargetMultisig__factory.abi).encodeFunctionData(
            "emitCalled",
            []
          ),
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
        [flashloanActionsTypesTuple],
        [flashLoanActions]
      );

      const actions: AvocadoMultisigStructs.ActionStruct[] = [
        // get flashloan 1000 WETH
        {
          target: flAggregator.address,
          data: new ethers.utils.Interface(InstaFlashAggregatorInterface__factory.abi).encodeFunctionData("flashLoan", [
            [weth.address], // tokens
            [ethers.utils.parseEther("3000")], // amounts
            flRoute, // route
            flashLoanActionsBytes, // calldata data (actions that will be executed in flashloan executeOperation callback)
            toUtf8Bytes(""),
          ]),
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
        // delegate call action
        {
          operation: 1,
          target: mockDelegateCallTarget.address,
          data: new ethers.utils.Interface(MockDelegateCallTargetMultisig__factory.abi).encodeFunctionData(
            "emitCalled",
            []
          ),
          value: 0,
        },
      ];

      const result = await (
        await testHelpers.executeActions(avoContract, user1, actions, {
          ...TestHelpers.testParams.params,
          actions,
          id: 21, // id = flashloan mixed
        })
      ).wait();

      const events = result.events as Event[];

      // parse logs
      let parsedLogs: LogDescription[] = [];
      let intrfc;
      events.forEach((log: any, index: number) => {
        try {
          intrfc = new ethers.utils.Interface(MockDelegateCallTargetMultisig__factory.abi);
          let parsedLog = intrfc.parseLog(log);
          parsedLogs[index] = parsedLog;
        } catch (ex) {}
      });
      parsedLogs = parsedLogs.filter((x) => !!x);

      expect(parsedLogs.length).to.equal(2);
      // delegate call in flashloan callback is called with msg.sender flashloan aggregator...
      expect(parsedLogs[0].args?.sender).to.equal(instaFlashAggregatorMainnet);
      // delegate call after flashloan in normal actions is called with original msg.sender, txInitiator in this case
      expect(parsedLogs[1].args?.sender).to.equal(user1.address);

      expect(events[events.length - 2].event).to.equal("CastExecuted");
    });

    it("should emit CastFailed and revert actions if flashloan via flashloan aggregator reverts", async () => {
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
        // repay flashloan WITHOUT fees to flashloan aggregator
        {
          operation: 0,
          target: weth.address,
          data: new ethers.utils.Interface(IWETH9__factory.abi).encodeFunctionData("transfer", [
            flAggregator.address,
            ethers.utils.parseEther("3000"),
          ]),
          value: 0,
        },
      ];

      const flashLoanActionsBytes = ethers.utils.defaultAbiCoder.encode(
        [flashloanActionsTypesTuple],
        [flashLoanActions]
      );

      const actions: AvocadoMultisigStructs.ActionStruct[] = [
        // get flashloan 1000 WETH
        {
          target: flAggregator.address,
          data: new ethers.utils.Interface(InstaFlashAggregatorInterface__factory.abi).encodeFunctionData("flashLoan", [
            [weth.address], // tokens
            [ethers.utils.parseEther("3000")], // amounts
            flRoute, // route
            flashLoanActionsBytes, // calldata data (actions that will be executed in flashloan executeOperation callback)
            toUtf8Bytes(""),
          ]),
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

      const result = await (
        await testHelpers.executeActions(avoContract, user1, actions, {
          ...TestHelpers.testParams.params,
          actions,
          id: 20, // id = flashloan call
        })
      ).wait();

      const events = result.events as Event[];

      // first event is CastFailed + second event is FeePaid
      expect(events.length).to.equal(2);

      expect(events[0].event).to.equal("CastFailed");
      expect(events[0].args?.reason).to.equal("0_amount-paid-less");

      const avoWethBalanceAfter = await weth.balanceOf(avocadoMultisig.address);

      expect(
        // avo smart wallet should spend 0 because reverted
        avoWethBalanceBefore.eq(avoWethBalanceAfter)
      ).to.equal(true);

      // user 2 should not have received 1 WETH from last action
      expect((await weth.balanceOf(user2.address)).eq(0)).to.equal(true);
    });

    it("should revert if trying to execute flashloan operation when id is not 20, 21", async () => {
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
        // repay flashloan WITHOUT fees to flashloan aggregator
        {
          operation: 0,
          target: weth.address,
          data: new ethers.utils.Interface(IWETH9__factory.abi).encodeFunctionData("transfer", [
            flAggregator.address,
            ethers.utils.parseEther("3000"),
          ]),
          value: 0,
        },
      ];

      const flashLoanActionsBytes = ethers.utils.defaultAbiCoder.encode(
        [flashloanActionsTypesTuple],
        [flashLoanActions]
      );

      const actions: AvocadoMultisigStructs.ActionStruct[] = [
        // get flashloan 1000 WETH
        {
          target: flAggregator.address,
          data: new ethers.utils.Interface(InstaFlashAggregatorInterface__factory.abi).encodeFunctionData("flashLoan", [
            [weth.address], // tokens
            [ethers.utils.parseEther("3000")], // amounts
            flRoute, // route
            flashLoanActionsBytes, // calldata data (actions that will be executed in flashloan executeOperation callback)
            toUtf8Bytes(""),
          ]),
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

      // same test for ids 0, 1, 2, 19, 22
      for await (const id of [0, 1, 2, 19, 22]) {
        const result = await (
          await testHelpers.executeActions(avoContract, user1, actions, {
            ...TestHelpers.testParams.params,
            actions,
            id,
          })
        ).wait();

        const events = result.events as Event[];

        // first event is CastFailed + second event is FeePaid
        expect(events.length).to.equal(2);

        expect(events[0].event).to.equal("CastFailed");
        expect(events[0].args?.reason).to.equal("0_AVO__INVALID_ID_OR_OPERATION");

        const avoWethBalanceAfter = await weth.balanceOf(avocadoMultisig.address);
        expect(
          // avo smart wallet should spend 0 because reverted
          avoWethBalanceBefore.eq(avoWethBalanceAfter)
        ).to.equal(true);
        //   user 2 should not have received 1 WETH from last action
        expect((await weth.balanceOf(user2.address)).eq(0)).to.equal(true);
      }
    });

    it("should revert if trying to execute delegatecall in flashloan actions operation when id==20", async () => {
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
        // delegate call action
        {
          operation: 1,
          target: mockDelegateCallTarget.address,
          data: new ethers.utils.Interface(MockDelegateCallTargetMultisig__factory.abi).encodeFunctionData(
            "emitCalled",
            []
          ),
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
        [flashloanActionsTypesTuple],
        [flashLoanActions]
      );

      const actions: AvocadoMultisigStructs.ActionStruct[] = [
        // get flashloan 1000 WETH
        {
          target: flAggregator.address,
          data: new ethers.utils.Interface(InstaFlashAggregatorInterface__factory.abi).encodeFunctionData("flashLoan", [
            [weth.address], // tokens
            [ethers.utils.parseEther("3000")], // amounts
            flRoute, // route
            flashLoanActionsBytes, // calldata data (actions that will be executed in flashloan executeOperation callback)
            toUtf8Bytes(""),
          ]),
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
        // delegate call action
        {
          operation: 1,
          target: mockDelegateCallTarget.address,
          data: new ethers.utils.Interface(MockDelegateCallTargetMultisig__factory.abi).encodeFunctionData(
            "emitCalled",
            []
          ),
          value: 0,
        },
      ];

      const result = await (
        await testHelpers.executeActions(avoContract, user1, actions, {
          ...TestHelpers.testParams.params,
          actions,
          id: 20, // id = flashloan call
        })
      ).wait();

      const events = result.events as Event[];

      // first event is CastFailed + second event is FeePaid
      expect(events.length).to.equal(2);

      expect(events[0].event).to.equal("CastFailed");
      expect(events[0].args?.reason).to.equal("0_3_AVO__INVALID_ID_OR_OPERATION");

      const avoWethBalanceAfter = await weth.balanceOf(avocadoMultisig.address);
      expect(
        // avo smart wallet should spend 0 because reverted
        avoWethBalanceBefore.eq(avoWethBalanceAfter)
      ).to.equal(true);
      // user 2 should not have received 1 WETH from last action
      expect((await weth.balanceOf(user2.address)).eq(0)).to.equal(true);
    });
  });
});
