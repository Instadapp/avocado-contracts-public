import { TypedDataDomain } from "@ethersproject/abstract-signer";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, constants, ContractTransaction } from "ethers";
import { formatBytes32String, hexDataSlice, parseEther, solidityKeccak256, toUtf8Bytes } from "ethers/lib/utils";
import { deployments, ethers } from "hardhat";

import {
  AvocadoMultisigStructs,
  IAvocadoMultisigV1,
} from "../typechain-types/contracts/interfaces/IAvocadoMultisigV1.sol/IAvocadoMultisigV1";
import { AvoForwarder, AvocadoMultisig__factory, IAvocadoMultisigV1__factory, AvoConfigV1 } from "../typechain-types";
import { expect, setupSigners } from "./util";

// CastFailed / CastExecuted is second last event position for `castAuthorized()` (last is FeePaid) -> events[events.length - 2]
export const castEventPosFromLastForAuthorized = 2;
// CastFailed / CastExecuted is last event position for `cast()` (last is Executed from Forwarder) -> events[events.length - 2]
export const castEventPosFromLastForSigned = 2;

export const EIP1271MagicValue = "0x1626ba7e";

export const defaultAuthorizedMinFee = 10;
export const defaultAuthorizedMaxFee = parseEther("1");

export type SkipBeforeChecks = "_transientAllowHash" | "_transientId" | "_initializing" | "nonSequentialNonce";

export const resetBytes31 = "0x00000000000000000000000000000000000000000000000000000000000001";

export type SkipAfterChecks =
  | "_avoImpl"
  | "avoNonce"
  | "owner"
  | "_initialized"
  | "_initializing"
  | "nonSequentialNonce"
  | "_transientId"
  | "_transientAllowHash"
  | "_signersPointer"
  | "requiredSigners"
  | "signersCount"
  | "signersState"
  | "authoritiesState"
  | "all";

interface AvoStorageSnapshot {
  _avoImpl: string;
  avoNonce: BigNumber;
  _transientAllowHash: string;
  _transientId: number;
  owner: string;
  _initialized: number;
  _initializing: boolean;
}

interface AvoStorageMultisigSnapshot {
  _signersPointer: string;
  requiredSigners: number;
  signersCount: number;
}

interface DefaultChecksData {
  storage: AvoStorageSnapshot;
  multisigStorage?: AvoStorageMultisigSnapshot;
  nonSequentialNonce: string;
  isNonSequentialNonce: boolean;
}

export class TestHelpers {
  domainSeparatorName: string;
  domainSeparatorVersion: string;

  avoForwarder: AvoForwarder;

  constructor(avoForwarder?: AvoForwarder) {
    this.avoForwarder = avoForwarder as AvoForwarder;

    this.domainSeparatorName = TestHelpers.domainSeparatorNameMultisig;
    this.domainSeparatorVersion = TestHelpers.domainSeparatorVersionMultisig;
  }

  public avoError(errorName: string) {
    return "AvocadoMultisig__" + errorName;
  }

  public async readAvoImplAddress(avoContract: string) {
    const iface = new ethers.utils.Interface(["function _avoImpl() view returns(address)"]);

    return hexDataSlice(
      await ethers.provider.call({
        to: avoContract,
        data: iface.encodeFunctionData("_avoImpl", []),
      }),
      12
    );
  }

  public async deployAvocadoMultisigContract(
    deployer: string,
    avoRegistry: string,
    avoForwarder: string,
    avoConfigV1: AvoConfigV1,
    avoSignersList: string,
    avoSecondary: string,
    authorizedMinFee = defaultAuthorizedMinFee,
    authorizedMaxFee = defaultAuthorizedMaxFee,
    backupFeeCollectorAddress?: string
  ) {
    if (!backupFeeCollectorAddress) {
      const { backupFeeCollector } = await setupSigners();
      backupFeeCollectorAddress = backupFeeCollector.address;
    }

    if (avoConfigV1.address != constants.AddressZero) {
      await avoConfigV1.setConfig(
        {
          authorizedMinFee,
          authorizedMaxFee,
          authorizedFeeCollector: backupFeeCollectorAddress,
        },
        { depositToken: await avoConfigV1.avoDepositManagerConfig() },
        { trackInStorage: await avoConfigV1.avoSignersListConfig() }
      );
    }

    const args = [avoRegistry, avoForwarder, avoSignersList, avoConfigV1.address, avoSecondary];

    const res = await deployments.deploy("AvocadoMultisig", {
      from: deployer,
      args,
    });

    return res;
  }

  public async deployAvocadoMultisigSecondaryContract(
    deployer: string,
    avoRegistry: string,
    avoForwarder: string,
    avoConfigV1: AvoConfigV1,
    avoSignersList: string,
    authorizedMinFee = defaultAuthorizedMinFee,
    authorizedMaxFee = defaultAuthorizedMaxFee,
    backupFeeCollectorAddress?: string
  ) {
    if (!backupFeeCollectorAddress) {
      const { backupFeeCollector } = await setupSigners();
      backupFeeCollectorAddress = backupFeeCollector.address;
    }

    if (avoConfigV1.address != constants.AddressZero) {
      await avoConfigV1.setConfig(
        {
          authorizedMinFee,
          authorizedMaxFee,
          authorizedFeeCollector: backupFeeCollectorAddress,
        },
        { depositToken: await avoConfigV1.avoDepositManagerConfig() },
        { trackInStorage: await avoConfigV1.avoSignersListConfig() }
      );
    }

    const args = [avoRegistry, avoForwarder, avoSignersList, avoConfigV1.address];

    const res = await deployments.deploy("AvocadoMultisigSecondary", {
      from: deployer,
      args,
    });

    return res;
  }

  //#region signature helpers
  public static defaultChainId = 634;
  public static domainSeparatorNameMultisig = "Avocado-Multisig";
  public static domainSeparatorVersionMultisig = "1.1.0";

  // The named list of all type definitions for Multisig cast() signatures
  static castTypes = {
    Cast: [
      { name: "params", type: "CastParams" },
      { name: "forwardParams", type: "CastForwardParams" },
    ],
    CastParams: [
      { name: "actions", type: "Action[]" },
      { name: "id", type: "uint256" },
      { name: "avoNonce", type: "int256" },
      { name: "salt", type: "bytes32" },
      { name: "source", type: "address" },
      { name: "metadata", type: "bytes" },
    ],
    Action: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
      { name: "value", type: "uint256" },
      { name: "operation", type: "uint256" },
    ],
    CastForwardParams: [
      { name: "gas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validUntil", type: "uint256" },
      { name: "value", type: "uint256" },
    ],
  };

  // The named list of all type definitions for Multisig castAuthorized() signatures
  static castAuthorizedTypes = {
    CastAuthorized: [
      { name: "params", type: "CastParams" },
      { name: "authorizedParams", type: "CastAuthorizedParams" },
    ],
    CastParams: [
      { name: "actions", type: "Action[]" },
      { name: "id", type: "uint256" },
      { name: "avoNonce", type: "int256" },
      { name: "salt", type: "bytes32" },
      { name: "source", type: "address" },
      { name: "metadata", type: "bytes" },
    ],
    Action: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
      { name: "value", type: "uint256" },
      { name: "operation", type: "uint256" },
    ],
    CastAuthorizedParams: [
      { name: "maxFee", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validUntil", type: "uint256" },
    ],
  };

  // types to create EIP1271 isValidSignature() signatures
  static eip1271Types = {
    AvocadoHash: [{ name: "hash", type: "bytes32" }],
  };

  public static testAction: AvocadoMultisigStructs.ActionStruct = {
    target: constants.AddressZero,
    data: toUtf8Bytes("test"),
    value: 0,
    operation: 0,
  };

  public static testParams: {
    params: AvocadoMultisigStructs.CastParamsStruct;
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct;
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct;
    chainAgnosticParams: (chainId: number) => AvocadoMultisigStructs.CastChainAgnosticParamsStruct;
  } = {
    params: {
      actions: [TestHelpers.testAction],
      id: 0,
      avoNonce: 0,
      salt: formatBytes32String("0x0"),
      source: "0x0000000000000000000000000000000000000001",
      metadata: toUtf8Bytes("metadata"),
    },
    forwardParams: {
      gas: 1000,
      gasPrice: 0,
      validAfter: 0,
      validUntil: 0,
      value: 0,
    },
    authorizedParams: {
      maxFee: 0,
      gasPrice: 0,
      validAfter: 0,
      validUntil: 0,
    },
    chainAgnosticParams: (chainId: number) =>
      ({
        params: {
          actions: [TestHelpers.testAction],
          id: 0,
          avoNonce: 0,
          salt: formatBytes32String("0x0"),
          source: "0x0000000000000000000000000000000000000001",
          metadata: toUtf8Bytes("metadata"),
        },
        forwardParams: {
          gas: 1000,
          gasPrice: 0,
          validAfter: 0,
          validUntil: 0,
          value: 0,
        },
        chainId,
      } as AvocadoMultisigStructs.CastChainAgnosticParamsStruct),
  };

  public static nonSequentialTestParams: {
    params: AvocadoMultisigStructs.CastParamsStruct;
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct;
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct;
  } = {
    ...TestHelpers.testParams,
    params: {
      ...TestHelpers.testParams.params,
      avoNonce: -1,
    },
  };

  public async typedDataDomain(
    verifyingContract: IAvocadoMultisigV1,
    chainId = TestHelpers.defaultChainId
  ): Promise<TypedDataDomain> {
    return {
      name: this.domainSeparatorName,
      version: this.domainSeparatorVersion,
      chainId,
      verifyingContract: verifyingContract.address,
      // salt contains the actual chain id, solidityKeccak256 replicates keccak256(abi.encodePacked())
      salt: solidityKeccak256(["uint256"], [(await ethers.provider.getNetwork()).chainId]),
    };
  }

  public async signEIP1271(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    hash: string,
    chainId = TestHelpers.defaultChainId
  ) {
    return await signer._signTypedData(
      await this.typedDataDomain(verifyingContract, chainId),
      TestHelpers.eip1271Types,
      { hash }
    );
  }

  public async getEIP1271SigDigest(
    verifyingContract: IAvocadoMultisigV1,
    hash: string,
    chainId = TestHelpers.defaultChainId
  ) {
    return ethers.utils._TypedDataEncoder.hash(
      await this.typedDataDomain(verifyingContract, chainId),
      TestHelpers.eip1271Types,
      { hash }
    );
  }

  public async testSignature(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams,
    chainId = TestHelpers.defaultChainId
  ) {
    // breaking change soon: will be renamed to signTypedData in a future ether.js version
    // see https://docs.ethers.io/v5/api/signer/#Signer-signTypedData
    return await signer._signTypedData(
      await this.typedDataDomain(verifyingContract, chainId),
      TestHelpers.castTypes,
      await this.valueToSign(verifyingContract, signer, params, forwardParams)
    );
  }

  public async testSignatureAuthorized(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams,
    chainId = TestHelpers.defaultChainId
  ) {
    // breaking change soon: will be renamed to signTypedData in a future ether.js version
    // see https://docs.ethers.io/v5/api/signer/#Signer-signTypedData
    return await signer._signTypedData(
      await this.typedDataDomain(verifyingContract, chainId),
      TestHelpers.castAuthorizedTypes,
      await this.valueToSignAuthorized(verifyingContract, signer, params, authorizedParams)
    );
  }

  public async invalidNonceTestSignature(verifyingContract: IAvocadoMultisigV1, signer: SignerWithAddress) {
    return this.testSignature(verifyingContract, signer, {
      ...TestHelpers.testParams.params,
      avoNonce: 2777, // random avoNonce
    });
  }

  public async nonSequentialNonceTestSignature(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.nonSequentialTestParams.params,
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.nonSequentialTestParams.forwardParams
  ) {
    return this.testSignature(verifyingContract, signer, params, forwardParams);
  }

  public async getSigDigest(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams,
    chainId = TestHelpers.defaultChainId
  ) {
    // @dev uncomment this to debug the CAST_TYPE_HASH
    // console.log("CAST_TYPE_HASH built by ethers.js", ethers.utils._TypedDataEncoder.from(TestHelpers.castTypes).encodeType("Cast"));

    return ethers.utils._TypedDataEncoder.hash(
      await this.typedDataDomain(verifyingContract, chainId),
      TestHelpers.castTypes,
      await this.valueToSign(verifyingContract, signer, params, forwardParams)
    );
  }

  public async getSigDigestAuthorized(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams,
    chainId = TestHelpers.defaultChainId
  ) {
    // @dev uncomment this to debug the CAST_AUTHORIZED_TYPE_HASH
    // console.log(
    //   "CAST_AUTHORIZED_TYPE_HASH built by ethers.js",
    //   ethers.utils._TypedDataEncoder.from(TestHelpers.castAuthorizedTypes).encodeType("CastDirect")
    // );

    return ethers.utils._TypedDataEncoder.hash(
      await this.typedDataDomain(verifyingContract, chainId),
      TestHelpers.castAuthorizedTypes,
      await this.valueToSignAuthorized(verifyingContract, signer, params, authorizedParams)
    );
  }

  public async valueToSign(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastParamsStruct,
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct
  ) {
    params = await this.adjustNonceToWallet(verifyingContract, signer, params);

    // The data to sign, must match types
    return {
      params,
      forwardParams,
    };
  }

  public async valueToSignAuthorized(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastParamsStruct,
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct
  ) {
    params = await this.adjustNonceToWallet(verifyingContract, signer, params);

    // The data to sign, must match types
    return {
      params,
      authorizedParams,
    };
  }
  //#endregion

  //#region cast chain agnostic

  // The named list of all type definitions for Multisig castChainAgnostic() signatures
  static castChainAgnosticTypes = {
    CastChainAgnostic: [
      { name: "params", type: "CastChainAgnosticParams[]" },
      { name: "chainIds", type: "uint256[]" },
    ],
    CastChainAgnosticParams: [
      { name: "params", type: "CastParams" },
      { name: "forwardParams", type: "CastForwardParams" },
      { name: "chainId", type: "uint256" },
    ],
    CastParams: [
      { name: "actions", type: "Action[]" },
      { name: "id", type: "uint256" },
      { name: "avoNonce", type: "int256" },
      { name: "salt", type: "bytes32" },
      { name: "source", type: "address" },
      { name: "metadata", type: "bytes" },
    ],
    Action: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
      { name: "value", type: "uint256" },
      { name: "operation", type: "uint256" },
    ],
    CastForwardParams: [
      { name: "gas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validUntil", type: "uint256" },
      { name: "value", type: "uint256" },
    ],
  };

  public async typedDataDomainChainAgnostic(
    verifyingContract: IAvocadoMultisigV1,
    chainId = TestHelpers.defaultChainId
  ): Promise<TypedDataDomain> {
    return {
      name: this.domainSeparatorName,
      version: this.domainSeparatorVersion,
      chainId, // 634
      verifyingContract: verifyingContract.address,
      // salt contains the chain id too (usually default chain id, which is 634). for chainAgnostic, actual chainId is in params
      // solidityKeccak256 replicates keccak256(abi.encodePacked())
      salt: solidityKeccak256(["uint256"], [chainId]),
    };
  }

  public async getSigDigestChainAgnostic(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[],
    chainId = TestHelpers.defaultChainId
  ) {
    // @dev uncomment this to debug the CAST_CHAIN_AGNOSTIC_TYPE_HASH
    // console.log(
    //   "CAST_CHAIN_AGNOSTIC_TYPE_HASH built by ethers.js",
    //   ethers.utils._TypedDataEncoder.from(TestHelpers.castChainAgnosticTypes).encodeType("CastChainAgnostic")
    // );

    return ethers.utils._TypedDataEncoder.hash(
      await this.typedDataDomainChainAgnostic(verifyingContract, chainId),
      TestHelpers.castChainAgnosticTypes,
      await this.valueToSignChainAgnostic(verifyingContract, signer, params)
    );
  }

  public async testSignatureChainAgnostic(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[],
    chainId = TestHelpers.defaultChainId
  ) {
    // for execute, we use getChainAgnosticHashes() passed in

    // user signs full struct of data for nice UX in metamask signing data view
    return await signer._signTypedData(
      await this.typedDataDomainChainAgnostic(verifyingContract, chainId),
      TestHelpers.castChainAgnosticTypes,
      await this.valueToSignChainAgnostic(verifyingContract, signer, params)
    );
  }

  public async valueToSignChainAgnostic(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[]
  ) {
    await Promise.all(
      params.map(async (param) => {
        param.chainId = param.chainId == -1 ? (await ethers.provider.getNetwork()).chainId : param.chainId;
        param.params = await this.adjustNonceToWallet(verifyingContract, signer, param.params);
      })
    );

    const chainIds = params.map((param) => param.chainId);

    // The data to sign, must match types
    return {
      params,
      chainIds,
    };
  }

  public async getChainAgnosticHashes(
    from: SignerWithAddress,
    params: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[],
    index = 0
  ) {
    const verifyingContract = IAvocadoMultisigV1__factory.connect(
      await this.avoForwarder.computeAvocado(from.address, index),
      from
    );

    // go through forwarder, deploys Avocado if necessary
    return await this.avoForwarder.callStatic.getAvocadoChainAgnosticHashes(
      from.address,
      index,
      (
        await this.valueToSignChainAgnostic(verifyingContract, from, params)
      ).params
    );
  }

  verifyChainAgnostic = async (
    avoWallet: IAvocadoMultisigV1,
    caller: SignerWithAddress,
    params: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[],
    paramsIndexToCast = 0,
    signaturesParams?: AvocadoMultisigStructs.SignatureParamsStruct[],
    index = 0
  ) => {
    params = (await this.valueToSignChainAgnostic(avoWallet, caller, params)).params;

    if (!signaturesParams?.length) {
      signaturesParams = [
        {
          signature: await this.testSignatureChainAgnostic(avoWallet, caller, params),
          signer: caller.address,
        },
      ];
    }

    signaturesParams = this.sortSignaturesParamsAscending(signaturesParams);

    const paramsToCast = params[paramsIndexToCast];

    const chainAgnosticHashes = await this.getChainAgnosticHashes(caller, params, index);

    return (avoWallet as IAvocadoMultisigV1)
      .connect(caller)
      .verifyChainAgnostic(paramsToCast, signaturesParams, chainAgnosticHashes);
  };

  castChainAgnostic = async (
    from: SignerWithAddress,
    signature: string,
    params: AvocadoMultisigStructs.CastChainAgnosticParamsStruct[],
    paramsIndexToCast = 0,
    signaturesParams?: AvocadoMultisigStructs.SignatureParamsStruct[],
    gasLimit: number = 16000000,
    value: BigNumber = BigNumber.from(0),
    skipBeforeChecks: SkipBeforeChecks[] = [],
    skipAfterChecks: SkipAfterChecks[] = [],
    index = 0
  ) => {
    if (!signaturesParams?.length) {
      signaturesParams = [{ signature: signature, signer: from.address }];
    }

    signaturesParams = this.sortSignaturesParamsAscending(signaturesParams);

    const verifyingContract = IAvocadoMultisigV1__factory.connect(
      await this.avoForwarder.computeAvocado(from.address, index),
      from
    );

    params = (await this.valueToSignChainAgnostic(verifyingContract, from, params)).params;

    const chainAgnosticHashes = await this.getChainAgnosticHashes(from, params, index);

    const paramsToCast = params[paramsIndexToCast];

    await this.beforeEachDefaultChecks(
      verifyingContract,
      paramsToCast.params,
      paramsToCast.forwardParams,
      undefined,
      skipBeforeChecks,
      await this.getSigDigestChainAgnostic(verifyingContract, from, params)
    );

    const res = await this.avoForwarder.executeChainAgnosticV1(
      from.address,
      index,
      paramsToCast,
      signaturesParams,
      chainAgnosticHashes,
      {
        gasLimit,
        value,
      }
    );

    await this.afterEachDefaultChecks(verifyingContract, skipAfterChecks);

    return res;
  };
  //#endregion

  //#region execution helpers
  executeActions = async (
    avoContract: IAvocadoMultisigV1,
    caller: SignerWithAddress,
    actions: string[] | AvocadoMultisigStructs.ActionStruct[],
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams,
    gasLimit: number = 16000000,
    value: BigNumber = BigNumber.from(0),
    skipBeforeChecks: SkipBeforeChecks[] = [],
    skipAfterChecks: SkipAfterChecks[] = []
  ) => {
    if (actions.length > 0 && typeof actions[0] === "string") {
      actions = (actions as string[]).map((calldata) => ({
        target: avoContract.address,
        data: calldata,
        value: 0,
        operation: 0,
      }));
    }

    actions = actions as AvocadoMultisigStructs.ActionStruct[];

    const singaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [
      {
        signer: caller.address,
        signature: await this.testSignatureAuthorized(
          avoContract as IAvocadoMultisigV1,
          caller,
          { ...params, actions },
          authorizedParams
        ),
      },
    ];

    return this.castAuthorized(
      avoContract as IAvocadoMultisigV1,
      caller,
      singaturesParams,
      { ...params, actions },
      authorizedParams,
      gasLimit,
      value,
      skipBeforeChecks,
      skipAfterChecks
    );
  };

  verify = async (
    avoWallet: IAvocadoMultisigV1,
    caller: SignerWithAddress,
    signaturesParams?: AvocadoMultisigStructs.SignatureParamsStruct[],
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams
  ) => {
    params = await this.adjustNonceToWallet(avoWallet, caller, params);

    if (!signaturesParams?.length) {
      signaturesParams = [
        {
          signature: await this.testSignature(avoWallet, caller, params, forwardParams),
          signer: caller.address,
        },
      ];
    }

    signaturesParams = this.sortSignaturesParamsAscending(signaturesParams);

    return (avoWallet as IAvocadoMultisigV1).connect(caller).verify(params, forwardParams, signaturesParams);
  };

  verifyAuthorized = async (
    avocadoMultisig: IAvocadoMultisigV1,
    caller: SignerWithAddress,
    signaturesParams?: AvocadoMultisigStructs.SignatureParamsStruct[],
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams
  ) => {
    params = await this.adjustNonceToWallet(avocadoMultisig, caller, params);

    if (!signaturesParams?.length) {
      signaturesParams = [
        {
          signature: await this.testSignatureAuthorized(avocadoMultisig, caller, params, authorizedParams),
          signer: caller.address,
        },
      ];
    }

    signaturesParams = this.sortSignaturesParamsAscending(signaturesParams);

    return (avocadoMultisig as IAvocadoMultisigV1)
      .connect(caller)
      .verifyAuthorized(params, authorizedParams, signaturesParams);
  };

  cast = async (
    from: SignerWithAddress,
    signature: string,
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams,
    signaturesParams?: AvocadoMultisigStructs.SignatureParamsStruct[],
    gasLimit: number = 16000000,
    value: BigNumber = BigNumber.from(0),
    skipBeforeChecks: SkipBeforeChecks[] = [],
    skipAfterChecks: SkipAfterChecks[] = [],
    index = 0
  ) => {
    if (!signaturesParams?.length) {
      signaturesParams = [{ signature: signature, signer: from.address }];
    }

    signaturesParams = this.sortSignaturesParamsAscending(signaturesParams);

    const verifyingContract = IAvocadoMultisigV1__factory.connect(
      await this.avoForwarder.computeAvocado(from.address, index),
      from
    );

    params = await this.adjustNonceToWallet(verifyingContract, from, params);

    await this.beforeEachDefaultChecks(verifyingContract, params, forwardParams, undefined, skipBeforeChecks);

    const res = await this.avoForwarder.executeV1(from.address, index, params, forwardParams, signaturesParams, {
      gasLimit,
      value,
    });

    await this.afterEachDefaultChecks(verifyingContract, skipAfterChecks);

    return res;
  };

  castEstimate = async (
    from: SignerWithAddress,
    signature: string,
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    forwardParams: AvocadoMultisigStructs.CastForwardParamsStruct = TestHelpers.testParams.forwardParams,
    signaturesParams?: AvocadoMultisigStructs.SignatureParamsStruct[],
    gasLimit: number = 16000000,
    value: BigNumber = BigNumber.from(0),
    index = 0
  ) => {
    if (!signaturesParams?.length) {
      signaturesParams = [{ signature: signature, signer: from.address }];
    }

    signaturesParams = this.sortSignaturesParamsAscending(signaturesParams);

    const verifyingContract = IAvocadoMultisigV1__factory.connect(
      await this.avoForwarder.computeAvocado(from.address, index),
      from
    );
    params = await this.adjustNonceToWallet(verifyingContract, from, params);

    return this.avoForwarder.estimateGas.executeV1(from.address, index, params, forwardParams, signaturesParams, {
      gasLimit,
      value,
    });
  };

  castAuthorized = async (
    avoContract: IAvocadoMultisigV1,
    from: SignerWithAddress,
    signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [],
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams,
    gasLimit: number = 16000000,
    value: BigNumber = BigNumber.from(0),
    skipBeforeChecks: SkipBeforeChecks[] = [],
    skipAfterChecks: SkipAfterChecks[] = []
  ) => {
    params = await this.adjustNonceToWallet(avoContract, from, params);

    await this.beforeEachDefaultChecks(avoContract, params, undefined, authorizedParams, skipBeforeChecks);

    let res: ContractTransaction;
    if (!signaturesParams?.length) {
      signaturesParams = [
        {
          signature: await this.testSignatureAuthorized(
            avoContract as IAvocadoMultisigV1,
            from,
            params,
            authorizedParams
          ),
          signer: from.address,
        },
      ];
    }

    signaturesParams = this.sortSignaturesParamsAscending(signaturesParams);

    res = await (avoContract as IAvocadoMultisigV1).castAuthorized(params, authorizedParams, signaturesParams, {
      gasLimit,
      value,
    });

    await this.afterEachDefaultChecks(avoContract, skipAfterChecks);

    return res;
  };

  castAuthorizedEstimate = async (
    avoContract: IAvocadoMultisigV1,
    from: SignerWithAddress,
    signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[] = [],
    params: AvocadoMultisigStructs.CastParamsStruct = TestHelpers.testParams.params,
    authorizedParams: AvocadoMultisigStructs.CastAuthorizedParamsStruct = TestHelpers.testParams.authorizedParams,
    gasLimit: number = 16000000,
    value: BigNumber = BigNumber.from(0)
  ) => {
    params = await this.adjustNonceToWallet(avoContract, from, params);

    if (!signaturesParams?.length) {
      signaturesParams = [
        {
          signature: await this.testSignatureAuthorized(
            avoContract as IAvocadoMultisigV1,
            from,
            params,
            authorizedParams
          ),
          signer: from.address,
        },
      ];
    }

    signaturesParams = this.sortSignaturesParamsAscending(signaturesParams);

    return (avoContract as IAvocadoMultisigV1).estimateGas.castAuthorized(params, authorizedParams, signaturesParams, {
      gasLimit,
      value,
    });
  };

  //#endregion

  //#region default checks
  defaultChecksData!: DefaultChecksData;
  /**
   * To be called before any execution on an avo wallet contract to register the state pre-execution.
   * This snapshot will be used in the afterEachDefaultChecks to check expected state, e.g. invariants such as
   * owner must always stay the same etc.
   */
  beforeEachDefaultChecks = async (
    avoContract: IAvocadoMultisigV1,
    params: AvocadoMultisigStructs.CastParamsStruct,
    forwardParams?: AvocadoMultisigStructs.CastForwardParamsStruct,
    authorizedParams?: AvocadoMultisigStructs.CastAuthorizedParamsStruct,
    skipChecks: SkipBeforeChecks[] = [],
    sigDigestChainAgnostic = ""
  ) => {
    // check if contract is deployed
    if ((await avoContract.provider.getCode(avoContract.address)) == "0x") {
      // no before checks if contract is not deployed yet
      return;
    }

    // store all storage vars to check expected state in the afterEachDefaultChecks method

    // get expected nonce that will be occupied
    const sequentialNonce = await avoContract.avoNonce();
    let nonSequentialNonce: string;
    if (sigDigestChainAgnostic) {
      nonSequentialNonce = sigDigestChainAgnostic;
    } else if (forwardParams) {
      nonSequentialNonce = await avoContract.getSigDigest(params, forwardParams);
    } else if (authorizedParams) {
      nonSequentialNonce = await (avoContract as IAvocadoMultisigV1).getSigDigestAuthorized(params, authorizedParams);
    } else {
      throw new Error("must define either forwardParams or authorizedParams for beforeEachDefaultChecks");
    }

    //  must directly read from storage slots to get internal vars
    // for AvocadoMultisig, storage slot 0 contains initialized vars
    const storageSlot0 = await avoContract.provider?.getStorageAt(avoContract.address, 0);
    // for AvoWallet, signersRelatedStorageSlot contains owner & initialized vars
    const signersRelatedStorageSlot = await avoContract.provider?.getStorageAt(avoContract.address, 1);
    // transient storage (_transientAllowHash) is in slot 54
    const transientStorageSlot = await avoContract.provider?.getStorageAt(avoContract.address, 54);

    this.defaultChecksData = {
      storage: {
        _avoImpl: await this.readAvoImplAddress(avoContract.address),
        avoNonce: sequentialNonce,
        _transientAllowHash: transientStorageSlot?.slice(0, -2),
        _transientId: parseInt(transientStorageSlot?.slice(-2)),
        owner: await avoContract.owner(),
        _initialized: parseInt(storageSlot0?.slice(4, 6) as string, 16),
        _initializing: parseInt(storageSlot0?.slice(2, 4) as string, 16) == 1,
      },
      multisigStorage: {
        _signersPointer: hexDataSlice(signersRelatedStorageSlot, 12),
        requiredSigners: await AvocadoMultisig__factory.connect(
          avoContract.address,
          avoContract.signer
        ).requiredSigners(),
        signersCount: await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).signersCount(),
      },
      nonSequentialNonce,
      isNonSequentialNonce: params.avoNonce == -1,
    };

    if (!skipChecks.includes("_transientAllowHash")) {
      expect("0x" + transientStorageSlot?.slice(4)).to.equal(
        resetBytes31,
        "beforeEachDefaultChecks: _transientAllowHash is not reset value"
      );
    }

    if (!skipChecks.includes("_transientId")) {
      expect(parseInt(transientStorageSlot?.slice(0, 4), 16)).to.equal(
        0,
        "beforeEachDefaultChecks: _transientId is not 0"
      );
    }

    if (!skipChecks.includes("_initializing")) {
      expect(this.defaultChecksData.storage._initializing).to.equal(
        false,
        "beforeEachDefaultChecks: _initializing is true"
      );
    }

    if (!skipChecks.includes("nonSequentialNonce")) {
      expect(
        await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).nonSequentialNonces(
          this.defaultChecksData.nonSequentialNonce
        )
      ).to.equal(0, "beforeEachDefaultChecks: expected non sequential nonce is already used before the tx");
    }
  };

  /**
   * default checks to be executed for after EVERY test call that executes anything on an avo smart wallet contract
   */
  afterEachDefaultChecks = async (avoContract: IAvocadoMultisigV1, skipChecks: SkipAfterChecks[] = []) => {
    if (skipChecks.includes("all")) {
      return;
    }
    //  must directly read from storage slot to get internal vars
    const storageSlot0 = await avoContract.provider?.getStorageAt(avoContract.address, 0);
    const signersRelatedStorageSlot = await avoContract.provider?.getStorageAt(avoContract.address, 1);
    const storageSlot2 = await avoContract.provider?.getStorageAt(avoContract.address, 2);
    const storageSlot3 = await avoContract.provider?.getStorageAt(avoContract.address, 3);
    // transient storage (_transientAllowHash) is in slot 54
    const transientStorageSlot = await avoContract.provider?.getStorageAt(avoContract.address, 54);

    expect(storageSlot2).to.equal(ethers.constants.HashZero, "afterEachDefaultChecks: storageSlot2 is not 0");
    expect(storageSlot3).to.equal(ethers.constants.HashZero, "afterEachDefaultChecks: storageSlot3 is not 0");

    if (!skipChecks.includes("_avoImpl")) {
      if (!this.defaultChecksData) {
        expect(await this.readAvoImplAddress(avoContract.address)).to.not.equal(ethers.constants.AddressZero);
      } else {
        expect(await this.readAvoImplAddress(avoContract.address)).to.equal(
          this.defaultChecksData.storage._avoImpl,
          "afterEachDefaultChecks: _avoImpl changed"
        );
      }
    }

    if (!skipChecks.includes("avoNonce")) {
      const previousNonce = !this.defaultChecksData ? BigNumber.from(0) : this.defaultChecksData.storage.avoNonce;

      if (this.defaultChecksData?.isNonSequentialNonce) {
        expect(await avoContract.avoNonce()).to.equal(previousNonce, "afterEachDefaultChecks: avoNonce changed");
      } else {
        expect(await avoContract.avoNonce()).to.equal(
          previousNonce.add(1),
          "afterEachDefaultChecks: avoNonce not increased"
        );
      }
    }

    if (!skipChecks.includes("_transientAllowHash")) {
      expect("0x" + transientStorageSlot?.slice(4)).to.equal(
        resetBytes31,
        "afterEachDefaultChecks: _transientAllowHash is not reset value"
      );
    }

    if (!skipChecks.includes("_transientId")) {
      expect(parseInt(transientStorageSlot?.slice(0, 4), 16)).to.equal(
        0,
        "afterEachDefaultChecks: _transientId is not 0"
      );
    }

    if (!skipChecks.includes("owner")) {
      if (!this.defaultChecksData) {
        expect(await avoContract.owner()).to.not.equal(
          ethers.constants.AddressZero,
          "afterEachDefaultChecks: owner is address zero"
        );
      } else {
        expect(await avoContract.owner()).to.equal(
          this.defaultChecksData.storage.owner,
          "afterEachDefaultChecks: owner changed"
        );
      }

      // for avocadoMultisig check that owner equals value on proxy
      const iface = new ethers.utils.Interface(["function _owner() view returns(address)"]);

      const ownerAtProxy = hexDataSlice(
        await ethers.provider.call({
          to: avoContract.address,
          data: iface.encodeFunctionData("_owner", []),
        }),
        12
      );

      const ownerAtSafe = (await avoContract.owner()).toLowerCase();

      expect(ownerAtProxy).to.equal(ownerAtSafe, "afterEachDefaultChecks: owner() does not match value at proxy");
    }

    if (!skipChecks.includes("_initialized")) {
      const initialized_ = parseInt(storageSlot0?.slice(4, 6) as string, 16);

      if (!this.defaultChecksData) {
        expect(initialized_).to.equal(1, "afterEachDefaultChecks: _initialized is not 1");
      } else {
        expect(initialized_).to.equal(
          this.defaultChecksData.storage._initialized,
          "afterEachDefaultChecks: _initialized changed"
        );
      }
    }

    if (!skipChecks.includes("_initializing")) {
      const _initializing = parseInt(storageSlot0?.slice(2, 4) as string, 16) == 1;

      expect(_initializing).to.equal(false, "afterEachDefaultChecks: _initializing is true");
    }

    if (!skipChecks.includes("nonSequentialNonce") && this.defaultChecksData) {
      if (this.defaultChecksData.isNonSequentialNonce) {
        // check non sequential nonce has been occupied
        expect(
          await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).nonSequentialNonces(
            this.defaultChecksData.nonSequentialNonce
          )
        ).to.equal(1, "afterEachDefaultChecks: nonSequentialNonce is not occupied");
      } else {
        // check that the non sequential nonce is still free
        expect(
          await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).nonSequentialNonces(
            this.defaultChecksData.nonSequentialNonce
          )
        ).to.equal(0, "afterEachDefaultChecks: nonSequentialNonce is occupied");
      }
    }

    if (!skipChecks.includes("_signersPointer")) {
      if ((await avoContract.signersCount()) > 1) {
        if (!this.defaultChecksData) {
          expect(hexDataSlice(signersRelatedStorageSlot, 12)).to.not.equal(
            ethers.constants.AddressZero,
            "afterEachDefaultChecks: _signersPointer is address zero"
          );
        } else {
          expect(hexDataSlice(signersRelatedStorageSlot, 12)).to.equal(
            this.defaultChecksData.multisigStorage?._signersPointer,
            "afterEachDefaultChecks: _signersPointer changed"
          );
        }
      }
    }

    if (!skipChecks.includes("requiredSigners")) {
      if ((await avoContract.signersCount()) > 1) {
        if (!this.defaultChecksData) {
          expect(
            await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).requiredSigners()
          ).to.equal(1, "afterEachDefaultChecks: requiredSigners is not 1");
        } else {
          expect(
            await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).requiredSigners()
          ).to.equal(
            this.defaultChecksData.multisigStorage?.requiredSigners,
            "afterEachDefaultChecks: requiredSigners changed"
          );
        }
      }
    }

    if (!skipChecks.includes("signersCount")) {
      if (hexDataSlice(signersRelatedStorageSlot, 12) != ethers.constants.AddressZero) {
        if (!this.defaultChecksData) {
          expect(
            await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).signersCount()
          ).to.equal(1, "afterEachDefaultChecks: signersCount is not 1");
        } else {
          expect(
            await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).signersCount()
          ).to.equal(
            this.defaultChecksData.multisigStorage?.signersCount,
            "afterEachDefaultChecks: signersCount changed"
          );
        }
      }
    }

    if (!skipChecks.includes("signersState")) {
      // for multisig check signersCount > 1 & signersCount > requiredSigners & signersCount < Max signers
      const requiredSigners = await AvocadoMultisig__factory.connect(
        avoContract.address,
        avoContract.signer
      ).requiredSigners();
      const signersCount = await AvocadoMultisig__factory.connect(
        avoContract.address,
        avoContract.signer
      ).signersCount();
      const maxSigners = (
        await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).MAX_SIGNERS_COUNT()
      ).toNumber();

      expect(signersCount).to.be.greaterThan(0, "afterEachDefaultChecks: invalid state signersCount is 0");
      expect(requiredSigners).to.be.lessThanOrEqual(
        signersCount,
        "afterEachDefaultChecks: invalid state signersCount is < requiredSigners"
      );
      expect(signersCount).to.be.lessThanOrEqual(
        maxSigners,
        "afterEachDefaultChecks: invalid state signersCount is > max signers"
      );

      const owner = await avoContract.owner();

      // check owner is always present in signers
      expect(await AvocadoMultisig__factory.connect(avoContract.address, avoContract.signer).isSigner(owner)).to.equal(
        true,
        "afterEachDefaultChecks: owner is not present as signer"
      );
    }

    // reset data
    this.defaultChecksData = null as any;
  };
  //#endregion

  sortSignaturesParamsAscending = (
    signaturesParams: AvocadoMultisigStructs.SignatureParamsStruct[]
  ): AvocadoMultisigStructs.SignatureParamsStruct[] => {
    return signaturesParams.sort((a, b) => {
      const aSigner = BigNumber.from(a.signer);
      const bSigner = BigNumber.from(b.signer);

      return aSigner.sub(bSigner).isNegative() ? -1 : aSigner.eq(bSigner) ? 0 : 1;
    });
  };

  private async adjustNonceToWallet(
    verifyingContract: IAvocadoMultisigV1,
    signer: SignerWithAddress,
    params: AvocadoMultisigStructs.CastParamsStruct
  ) {
    // if avoNonce is not set to use non-sequential nonce, make sure it matches contract avoNonce
    if (params.avoNonce != -1) {
      // if wallet is not deployed yet, avoNonce stays 0
      if (params.avoNonce == 0 && (await signer.provider?.getCode(verifyingContract.address)) !== "0x") {
        params = { ...params };
        params.avoNonce = (await verifyingContract.avoNonce()).toNumber();
      }
    }

    return params;
  }
}
