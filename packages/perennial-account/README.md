# Perennial V2 Collateral Accounts

Collateral accounts help users manage collateral across Perennial markets on a single chain. An EOA may deploy only one collateral account. Actions are performed using ERC712 payloads submitted to keepers through a relayer. As such, users must delegate a signer for their actions.

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
```