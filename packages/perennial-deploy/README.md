# Perennial V2 Deployment

Deployment scripts, migration scripts and verification tests for Perennial V2 Protocol

## Usage

### Prerequisites

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

### Test

Run verification tests:

```sh
$ yarn test:verification:arbitrum
$ yarn test:verification:base
```

### Deploy

#### To local fork (for testing)
In one terminal, create a hardhat fork from the desired chain, skipping deployment:
```sh
yarn node:fork:arbitrumSepolia --no-deploy
```
Hardhat should report that the JSON-RPC server has started, and provide a list of funded accounts on the fork.

In another terminal, run the deployment pointing at _localhost_:
```sh
$ yarn deploy:fork:arbitrumSepolia
```

#### To target chain
```sh
$ yarn deploy
```

### Validate a contract with etherscan (requires API key)

```
npx hardhat verify --network <network> <DEPLOYED_CONTRACT_ADDRESS> "Constructor argument 1"
```

### Added plugins

- Etherscan [hardhat-etherscan](https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html)
