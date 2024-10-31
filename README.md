![1500x500 perennial](https://github.com/equilibria-xyz/perennial-v2/assets/747165/ef24cb94-b774-428f-9a5f-7ee7b347a36c)

🌸 Perennial V2 is a general-purpose synthetic derivatives primitive for decentralized finance.

![Twitter Follow](https://img.shields.io/twitter/follow/perenniallabs?style=for-the-badge)

## 📦 Packages

| Package                 | Description                       |                                                                                                                               Latest Version |
| ----------------------- | :-------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------: |
| `@perennial/core`       | Core perennial smart contracts.   |                                 [![npm version](https://badge.fury.io/js/@perennial%2Fcore.svg)](https://badge.fury.io/js/@perennial%2Fcore) |
| `@perennial/deploy`     | Deployment scripts and artifacts. |         [![npm version](https://badge.fury.io/js/@perennial%2Fperennial/deploy.svg)](https://badge.fury.io/js/@perennial%2Fperennial/deploy) |
| `@perennial/extensions` | Extension smart contracts.        | [![npm version](https://badge.fury.io/js/@perennial%2Fperennial/extensions.svg)](https://badge.fury.io/js/@perennial%2Fperennial/extensions) |
| `@perennial/oracle`     | Oracle provider smart contracts.  |         [![npm version](https://badge.fury.io/js/@perennial%2Fperennial/oracle.svg)](https://badge.fury.io/js/@perennial%2Fperennial/oracle) |
| `@perennial/vault`      | Vault smart contracts.            |           [![npm version](https://badge.fury.io/js/@perennial%2Fperennial/vault.svg)](https://badge.fury.io/js/@perennial%2Fperennial/vault) |

## 🔗 Resources

- Read the protocol [Documentation](https://docs.perennial.finance/).

## 👨‍💻 Usage

### Pre Requisites

Before running any command, make sure to install dependencies

```sh
$ yarn
```

### Compile

Compile the smart contracts for each package with Hardhat:

```sh
$ yarn workspaces run compile
```

This also generates the Typechain types

### Test

Perennial has 4 logic packages: `core`, `deploy`, `extensions`, `oracle`, and `vault`

Run the Mocha unit tests a specific package:

```sh
$ yarn workspace @equilibria/<package-name> run test
```

For example, to run the tests for the core package:

```sh
$ yarn workspace @perennial/core run test
```

To run tests against a Mainnet fork, set your `MAINNET_NODE_URL` in the root `.env` and run

```sh
$ yarn workspace run @equilibria/<package-name> test:integration
```

For example, to run the integration tests for the core package:

```sh
$ yarn workspace @perennial/core run test:integration
```

## 🔐 Security

- The perennial protocol is audited and insured by Sherlock and Zellic. Audit reports are available in [audits](audits)
- Un-discovered bugs may be reported to our [bug bounty program through Immunefi](https://immunefi.com/bounty/perennial/).

## 📜 License

The vast majority of the Perennial V2 codebase is licensed under the Apache 2.0 license to provide developers with the maximum amount of flexibility. A minimum subset of code was chosen to place under the Business Source License 1.1 so as not to permit a full protocol redeployment.

| License      | License                                                                               |
| ------------ | :------------------------------------------------------------------------------------ |
| `Apache-2.0` | All, unless stated otherwise.                                                         |
| `BUSL-1.1`   | Smart contracts: `Market.sol` and `MarketFactory.sol` in the `@perennial-v2` package. |
