# Avocado contracts

This repository contains the core contracts for Instadapp Avocado.

There are 5 main parts to the Avo architecture:

- AvocadoMultisig: logic contract that executes arbitrary actions for signers based on auth logic such as EIP712 signature
- Avocado: minimalistic simple proxy that falls back to AvocadoMultisig
- AvoFactory: deploys Avocado contracts with implementation set to AvocadoMultisig logic contract deterministcally and computes deterministic address. Avocado address depends on: owner & index.
- AvoForwarder: main interaction point, especially for broadcasters. Forwards transactions with signatures and list of actions to Avocado for execution. Deploys Avocado if necessary.
- AvoRegistry: holds valid implementation versions for Avocados and AvoForwarder & sets fee config for gas cost markup for direct authorized transactions (Configurable by owner).

Helpers:

- AvoDepositManager: Handles USDC deposits to pay for multichain gas fees
- AvoSignersList: tracks the mappings of Avocado <> allowed signers
- Administrative contracts: AvoAdmin (proxy admin), AvoMultisigAdmin (static multisig used as initial owner), AvoConfig (holds config vars to remove deterministic address dependency on constructor args)

**For deployments see [avocado-deployment-cli](https://github.com/Instadapp/avocado-deployment-cli).**

## Development

#### Important information for new implementations & changes

Please read the comments in the file and the lines of code you are changing carefully, the codebase is well commented.

#### New implementations: Contract changes / upgrades

For Upgrades to **AvocadoMultisig** contract (in contracts/AvocadoMultisig/\*\*):

- any new implementation **MUST** have the upgrade method in the implementation itself, otherwise it can't upgrade again.
- any new implementation **MUST** have the `address internal _avoImpl_;` variable at storage slot 0. Do not move it down below other variables unless the Avocado logic is changed too and you know exactly what you are doing. Upgrading the `_avoImpl_` works by overwriting storage slot 0, if this is changed the Avocado will not be upgradeable anymore and probably other things break too.
- all storage variables **MUST** go in the AvocadoMultisigVariables contract. Changing already used storage slots must be carefully considered for new versions and potentially needed changes implemented to happen during the upgrade, e.g. in the `_afterUpgradeHook()`.
- If parameters for the `cast()` / `castAuthorized` method change, make sure to adjust the type hashes constants accordingly.
- If code that after execution of actions in the separate execution frame changes, hardcoded gas buffer amounts must be adjusted accordingly, see comments in code itself.

---

### ⚠ DO NOT CHANGE Avocado CODE AND DEPLOY A NEW AvoFactory BEFORE READING THIS

---

- If the Avocado (proxy) changes, the bytecode for it changes. When you deploy a new AvoFactory and upgrade via the AvoFactoryProxy, **the address will not be the same deterministic like before anymore**! The Create2 uses the Avocado bytecode as part of the differentiator! If such changes are needed, some sort of versioning would have to be introduced, e.g. passing in a parameter `version` to all methods in forwarder factory etc. and based on that `version` the correct AvoFactory can be used...
- The Avocado creation code is hardcoded at the AvoFactory. If the Avocado should really change, this hardcoded value must be adjusted (along with `avocadoBytecode` values in other contracts).
- any new implementation **MUST** have the `address internal _avoImpl_;` variable at storage slot 0. See above for explanation.

#### Keep tests up to date

If you introduce new changes make sure tests still work and implement new tests if needed! You can run tests with `npm run test`.

Also update the gas-usage-report script (`./scripts/gas-usage-report.ts`) if necessary, see docs below for what it tests.

#### Keep docs and comments up to date

Change comments if you change code. Use NatSpec format https://docs.soliditylang.org/en/latest/natspec-format.html.

Docs can be generated with `npm run docs` and are used in avocado-docs (https://github.com/Instadapp/avocado-docs) so it is important to keep that in mind when writing NatSpec comments.

Note that the templates for the docs generation are customized, see the README.md file in `/docs-templates`.

#### Consistent Formatting

Make sure your changes use the same formatting as the codebase to avoid whitespace changes etc.
Install the prettier extension in VSCode and make sure you format files before committing or automate it by setting automatically format on save. For example see this guide https://www.alphr.com/auto-format-vs-code/.

#### Reports

reports can be generated for:

- gas usage (`npm run gas-report`)
- contracts storage layout (`npm run storage-report`)
- contracts size (`npm run contract-size-report`)

add `:store` to the command to write them to the default file instead of as console output.

Generate all reports at once (recommended before a PR is marked as ready) with

```
npm run reports
```

#### Installation

1. Install NPM Packages

```javascript
npm i
```

2. Create a `.env` file in the root directory and use the format like in `.env.example` file.

#### Commands:

Run the local node

```
npx hardhat node
```

Compile contracts

```
npm run compile
```

Run the testcases

```
npm run test
```

or to run a specific test

```
npm run test ./test/test-name.test.ts
```

#### Gas usage

There is a script to measure gas usage of multiple interactions such as:

- AvocadoMultisig `cast()` / `castOwner()` / `upgradeTo()`
- AvocadoMultisig `addSigners()` (for various counts)
- AvoFactory `deploy()` / `deployWithVersion()` / `computeAddress()`
- AvoForwarder `execute()`
- compare gas cost for token send from EOA vs Avocado
- Flashloan actions
- failure cases of some methods mentioned

You can run it with `npm run gas-report`, and store it in the file `.gas-report` e.g. after changes with `npm run gas-report:store`.

#### Deploy

This repo uses the [hardhat-deploy plugin](https://github.com/wighawag/hardhat-deploy) for deployment of contracts for local development.

Deployment is only supported for local network forks. Production (& staging) deplyoments (and upgrades etc.) are handled by the specifically [designed CLI tool](https://github.com/Instadapp/avocado-deployment-cli).

Add or modify deployment scripts if necessary in `./scripts/deploy`.
Scripts are executed alphabetically so make sure to name new scripts with a number prefix like current scripts are.
For more, see the docs of the `hardhat-deploy` plugin (https://github.com/wighawag/hardhat-deploy).

## Releases

Releases follow [semantic versioning](https://semver.org/).

The first two versions of Avocado have been renamed

- "v1" -> "v1-legacy"
- "v2" -> "v2-legacy"

The version that would have technically been referred to as "v3" has been renamed to "v1", with a fresh unrelated deployment setup.

Every release has a separate release branch, as well as a matching staging branch.
