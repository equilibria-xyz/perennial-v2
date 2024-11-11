# Perennial V2 Oracle

Oracle systems for the Perennial V2 Protocol

## Usage

### Pre Requisites

Before running any command, make sure to install dependencies. Run this in the root workspace as well to capture package patches:

```sh
$ yarn
```

### Compile

Compile the smart contracts with Hardhat:

```sh
$ yarn compile
```

This also generates the Typechain types

### Tasks
#### get-vaa
Retrieves and decodes a Pyth Validator Action Approval (VAA) for a specific price feed. Useful for testing PythFactory and KeeperOracle.

Example invocation:
```sh
npx hardhat get-vaa --price-feed 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace --timestamp 1711425600
```

### Test

Run the Mocha tests:

```sh
$ yarn test
```

To run tests against a Mainnet fork, set your `MAINNET_NODE_URL` in the root `.env` and run

```sh
$ yarn test:integration
```

### Gas Report

To get a gas report based on unit test calls:

```sh
$ yarn gasReport
```

### Deploy contract to network (requires Mnemonic and infura API key)

```
npx hardhat run --network rinkeby ./scripts/deploy.ts
```

### Validate a contract with etherscan (requires API ke)

```
npx hardhat verify --network <network> <DEPLOYED_CONTRACT_ADDRESS> "Constructor argument 1"
```

### Added plugins

- Gas reporter [hardhat-gas-reporter](https://hardhat.org/plugins/hardhat-gas-reporter.html)
- Etherscan [hardhat-etherscan](https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html)
