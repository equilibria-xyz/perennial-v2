# Perennial V2 Collateral Accounts

Collateral accounts help users manage collateral across Perennial markets on a single chain. A user's EOA may deploy only one collateral account, whose address is deterministic. Actions are performed using [EIP-712](https://eips.ethereum.org/EIPS/eip-712) message payloads submitted to keepers through a relayer. Users may self-sign their messages or delegate one or more signers.

## Design

A single _Controller_ is deployed to a chain.  The controller serves as a factory to deploy _Account_ contracts, and manages interactions between accounts and multiple _Market_ contracts.

Users send signed messages to a _Relayer_ which queues them in a centralized database.  _Keepers_ dequeue messages from the relayer, and submit them to the controller to be compensated.  Keepers also  interact with the controller to find opportunities to rebalance accounts, and are compensated for performing successful rebalances.

## Usage

### Users (account owners)
Most operations may be performed in a gasless manner using signed messages.

#### Account creation
- Call the controller to determine your address.
- Before the account is created, transfer DSU to that address for keeper compensation.
- Send a message to the relayer requesting account creation.

// TODO: document how to deposit and configure rebalancing

### Keepers
// TODO: document interactions with relayer and controller

## Development

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

This also generates the Typechain types.

### Test

Run the Mocha tests:

```sh
$ yarn test
$ yarn test:integration
```

### Gas Report

To get a gas report based on unit test calls:

```sh
$ yarn gasReport
```