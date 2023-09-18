# Perennial V2

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

Perennial has 5 logic packages: `perennial-v2`, `perennial-v2-extensions`, `perennial-v2-oracle`, `perennial-v2-payoff`, and `perennial-v2-vault`

Run the Mocha unit tests a specific package:

```sh
$ yarn workspace @equilibria/<package-name> run test
```

For example, to run the tests for the core package:

```sh
$ yarn workspace @equilibria/perennial-v2 run test
```

To run tests against a Mainnet fork, set your `MAINNET_NODE_URL` in the root `.env` and run

```sh
$ yarn workspace run @equilibria/<package-name> test:integration
```

For example, to run the integration tests for the core package:

```sh
$ yarn workspace @equilibria/perennial-v2 run test:integration
```
