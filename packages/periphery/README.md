# Perennial V2 Periphery

Extension systems and periphery contracts for the Perennial V2 Protocol


## Collateral Accounts

Collateral accounts help users manage collateral across Perennial markets on a single chain. A user's EOA may deploy only one collateral account, whose address is deterministic. Actions are performed using [EIP-712](https://eips.ethereum.org/EIPS/eip-712) message payloads submitted to keepers through a relayer. Users may self-sign their messages or delegate one or more signers.

Users may also relay requests through this extention to compensate keepers from their collateral account.

### Design

A single _Controller_ is deployed to a chain.  The controller serves as a factory to deploy _Account_ contracts, and manages interactions between accounts and multiple _Market_ contracts.  Collateral accounts are only compatible with markets which use [DSU](https://www.dsu.money/) as collateral.

_Account_ offers facilities to deposit and withdraw tokens, and to transfer collateral into and out of markets. _Controller_ employs these facilities to perform actions requested by the account owner or a delegated signer, such as rebalancing collateral across markets.

Users send signed messages to a _Relayer_ which queues them in a centralized database.  _Keepers_ dequeue messages from the relayer, and submit them to the controller to be compensated.  Keepers also  interact with the controller to find opportunities to rebalance accounts, and are compensated for performing successful rebalances.

### Usage

#### Users (account owners)
Most operations may be performed in a gasless manner using signed messages.

##### Actions

###### Account creation
- Call the controller to determine your address.
- Before the account is created, transfer DSU or USDC to that address for keeper compensation.
- Send a message to the relayer requesting account creation.

###### Depositing and withdrawing funds
- DSU or USDC may be deposited into an account using a native ERC20 transfer
- USDC may also be deposited by executing the `Account.deposit` function

All USDC in the account is implicitly wrapped to DSU when transferring an amount greater than the account's DSU balance into a market. Funds transferred out of markets are not unwrapped until withdrawal. These behaviors minimize gas cost when rebalancing.

When withdrawing funds from the account, a flag allows the caller to explicitly control unwrapping behavior.

###### Rebalancing
After the account owner has configured a rebalance group, keepers may call `Controller.checkGroup` offchain to determine if the group may be rebalanced. Assuming state does not change beforehand, the keeper may then call `Controller.rebalanceGroup` to perform a rebalance.

To build a list of rebalance groups to check, keepers may watch for `RebalanceGroupConfigured` events emitted by the Controller. An event with an empty _markets_ collection indicates the group was deleted.

##### Messages

###### Domains
With respect to domains, messages fall into three categories. Here's how to set your domain for each:
| Message type | Message domain |
| ------------ | -------------- |
| __Messages involving Collateral Account actions__ | Collateral Accounts Controller |
| __Nonce cancellation requests__                   | Validator used for intents     |
| __Market access requests__                        | Market Factory                 |

###### Nonces
Nonces are hashed into each request to ensure the same signed action cannot be replayed. Two types of nonces are specified in every message:
- __nonce__ - used only once, automatically invalidated when message is verified
- __group__ - may be reused across messages, only cancelled manually

The _group_ nonce may be used to atomically cancel multiple actions. Let's explore a few use cases:
1. User doesn't care about _group_, so leaves it 0 for all actions. Their trading bot malfunctions, spraying relayers with many actions. User may send a message to cancel group 0 to make them all go away. For all future messages, user must specify a nonzero group.
1. User submits several related actions under the same _group_, enabling them to cancel any unfulfilled actions with a single message.
1. User formats the current UTC date as an integer and uses this for their _group_ nonce. This allows the user to send a single message to cancel all pending actions submitted on the specified date. Granularity could be reduced by formatting year and week number, or increased by including hour with the date.

###### Relaying
Messages may be relayed to `MarketFactory` and other extensions for purposes of compensating keepers using funds in your collateral account.  "Inner" relayed messages are wrapped with an "Outer" message which identifies your collateral account and a maximum fee to compensate the keeper.  Both inner and outer message require separate signatures against different domains (discussed above).

#### Keepers
// TODO: document interactions with relayer and controller

### Deployment
Generally a subclass such as `Controller_Arbitrum` will be deployed to the target chain. The base `Controller` has no facilities for keeper compensation or message relaying but is not abstract. It may be deployed for testing purposes or to self-process signed messages.

## Trigger Orders

Trigger Orders allow users to submit an order to increase or decrease a position when the market price moves above or below a user-chosen limit price. This is accomplished by storing the trigger order onchain, and allowing keepers to execute trigger orders whose entry conditions have been met.

### Design

A single _Manager_ is created for each Perennial deployment, accompianied by an `OrderVerifier` contract to handle signed messages. Users add the _Manager_ as an operator for their account. Trigger Orders are only compatible with markets which use [DSU](https://www.dsu.money/) as collateral.

For executing orders and handling signed messages, keepers are compensated from the market in which the order was placed.

### Usage

#### Users
All operations may be performed in a gasless manner using signed messages. Users must create and fund a _Collateral Account_, which will be used to compensate keepers for processing signed messages and for executing orders.  Users must also approve the trigger order _Manager_ contract as an operator for themselves (not for their collateral account).

##### Actions

###### Place Order
- Ensure your target market has sufficient collateral to support the order. For long or short orders, ensure there is sufficient funding for the order.
- Choose parameters for your order; see `contracts/types/TriggerOrder` documentation for details.
- Choose a unique-to-you order nonce and record it. Either call `placeOrder` directly on the `Manager`, or sign and send a `PlaceOrderAction` message to a relayer.

###### Replace Order
- To replace an unexecuted order, call `placeOrder` or send a `PlaceOrderAction` using the same order nonce as the unexecuted order you wish to replace. This will overwrite the unexecuted order in storage.

###### Cancel Order
- Find the order nonce you recorded when the order was placed.
- If the order was placed directly, or your `PlaceOrderAction` message was handled, call `cancelOrder` directly on the `Manager`, or sign and send a `CancelOrderAction` message to a relayer.
- If you placed the order using a signed message, and this request has not been processed, cancel the message nonce (different than the order nonce) directly with the `OrderVerifier` contract.

##### Messages

###### Domains
Message domain should be set to the `Manager` contract address.

###### Nonces
Note the message nonce works independently from the order nonce. If you choose to set message nonce equal to order nonce, you'll need a different scheme to assign nonces to cancellation and replacement messages. For example, you could use a serial order/message nonce, incrementing from 0. But for non-placement messages, you could decrement the serial nonce from `type(uint256).max`.

Nonces are hashed into each request to ensure the same signed action cannot be replayed. Two types of nonces are specified in every message:
- __nonce__ - used only once, automatically invalidated when message is verified
- __group__ - may be reused across messages, only cancelled manually

The _group_ nonce may be used to atomically cancel multiple actions. Let's explore a few use cases:
1. User doesn't care about _group_, so leaves it 0 for all actions. Their trading bot malfunctions, spraying relayers with many actions. User may send a message to cancel group 0 to make them all go away. For all future messages, user must specify a nonzero group.
1. User submits several related actions under the same _group_, enabling them to cancel any unfulfilled actions with a single message.
1. User formats the current UTC date as an integer and uses this for their _group_ nonce. This allows the user to send a single message to cancel all pending actions submitted on the specified date. Granularity could be reduced by formatting year and week number, or increased by including hour with the date.

#### Keepers
Keepers should:
- Monitor their own relayers looking for EIP712 user messages to handle.
- Watch _Manager_ events and market price changes for opportunities to execute orders. _Manager_ exposes a `checkOrder` facility which may be called offchain prior to executing. Alternatively, keeper can use a transaction simulation API to confirm the execution will be successful and ensure they will be paid appropriately for transacting.
- Handle requests in a meaningful order:
    - Cancel order requests
    - Execute orders which add liquidity/reduce skew
    - Execute orders which remove liquidity/increase skew
    - Place order requests

### Deployment
`Manager_Arbitrum` and `Verifier` will be deployed to the target chain.


## Coordinator
( to be documented )

## MultiInvoker
( to be documented )




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

This also generates the Typechain types

### Test

Run the Mocha tests:

```sh
$ yarn test
$ yarn test:integration
$ yarn test:integrationArbitrum
$ yarn test:integrationBase
```

Ensure JSON-RPC node URLs have been defined in your root `.env` file.


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
