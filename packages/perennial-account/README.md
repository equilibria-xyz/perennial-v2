# Perennial V2 Collateral Accounts

Collateral accounts help users manage collateral across Perennial markets on a single chain. A user's EOA may deploy only one collateral account, whose address is deterministic. Actions are performed using [EIP-712](https://eips.ethereum.org/EIPS/eip-712) message payloads submitted to keepers through a relayer. Users may self-sign their messages or delegate one or more signers.

Users may also relay requests through this extention to compensate keepers from their collateral account.

## Design

A single _Controller_ is deployed to a chain.  The controller serves as a factory to deploy _Account_ contracts, and manages interactions between accounts and multiple _Market_ contracts.  Collateral accounts are only compatible with markets which use [DSU](https://www.dsu.money/) as collateral.

_Account_ offers facilities to deposit and withdraw tokens, and to transfer collateral into and out of markets. _Controller_ employs these facilities to perform actions requested by the account owner or a delegated signer, such as rebalancing collateral across markets.

Users send signed messages to a _Relayer_ which queues them in a centralized database.  _Keepers_ dequeue messages from the relayer, and submit them to the controller to be compensated.  Keepers also  interact with the controller to find opportunities to rebalance accounts, and are compensated for performing successful rebalances.

## Usage

### Users (account owners)
Most operations may be performed in a gasless manner using signed messages.

#### Actions

##### Account creation
- Call the controller to determine your address.
- Before the account is created, transfer DSU or USDC to that address for keeper compensation.
- Send a message to the relayer requesting account creation.

##### Depositing and withdrawing funds
- DSU or USDC may be deposited into an account using a native ERC20 transfer
- USDC may also be deposited by executing the `Account.deposit` function

All USDC in the account is implicitly wrapped to DSU when transferring an amount greater than the account's DSU balance into a market. Funds transferred out of markets are not unwrapped until withdrawal. These behaviors minimize gas cost when rebalancing.

When withdrawing funds from the account, a flag allows the caller to explicitly control unwrapping behavior.

##### Rebalancing
After the account owner has configured a rebalance group, keepers may call `Controller.checkGroup` offchain to determine if the group may be rebalanced. Assuming state does not change beforehand, the keeper may then call `Controller.rebalanceGroup` to perform a rebalance.

To build a list of rebalance groups to check, keepers may watch for `RebalanceGroupConfigured` events emitted by the Controller. An event with an empty _markets_ collection indicates the group was deleted.

#### Messages

##### Domains
With respect to domains, messages fall into three categories. Here's how to set your domain for each:
| Message type | Message domain |
| ------------ | -------------- |
| __Messages involving Collateral Account actions__ | Collateral Accounts Controller |
| __Nonce cancellation requests__                   | Validator used for intents     |
| __Market access requests__                        | Market Factory                 |


##### Nonces
Nonces are hashed into each request to ensure the same signed action cannot be replayed. Two types of nonces are specified in every message:
- __nonce__ - used only once, automatically invalidated when message is verified
- __group__ - may be reused across messages, only cancelled manually

The _group_ nonce may be used to atomically cancel multiple actions. Let's explore a few use cases:
1. User doesn't care about _group_, so leaves it 0 for all actions. Their trading bot malfunctions, spraying relayers with many actions. User may send a message to cancel group 0 to make them all go away. For all future messages, user must specify a nonzero group.
1. User submits several related actions under the same _group_, enabling them to cancel any unfulfilled actions with a single message.
1. User formats the current UTC date as an integer and uses this for their _group_ nonce. This allows the user to send a single message to cancel all pending actions submitted on the specified date. Granularity could be reduced by formatting year and week number, or increased by including hour with the date.

### Keepers
// TODO: document interactions with relayer and controller

## Deployment
Generally a subclass such as `Controller_Arbitrum` will be deployed to the target chain. The base `Controller` has no facilities for keeper compensation or message relaying but is not abstract. It may be deployed for testing purposes or to self-process signed messages.

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