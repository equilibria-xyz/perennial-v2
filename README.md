# Perennial V2 Vault

Monorepo for the Perennial V2 Protocol

## Usage

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

Run the Mocha unit tests for each package:

```sh
$ yarn workspaces run test
```

To run unit tests for a specific package:

```sh
$ yarn workspace @equilibria/perennial-v2 run test
```

To run tests against a Mainnet fork, set your `MAINNET_NODE_URL` in the root `.env` and run

```sh
$ yarn workspaces run test:integration
```

or

```sh
$ yarn workspace @equilibria/perennial-v2 run test:integration
```
