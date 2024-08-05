# Perennial V2 Trigger Orders

Trigger Orders allow users to submit an order to increase or decrease a position when the market price moves above or below a user-chosen limit price. This is accomplished by storing the trigger order onchain, and allowing keepers to execute trigger orders whose entry conditions have been met.

## Design

A single _Manager_ is created for each Perennial deployment, accompianied by an `OrderVerifier` contract to handle signed messages. Users add the _Manager_ as an operator for their account. Trigger Orders are only compatible with markets which use [DSU](https://www.dsu.money/) as collateral.

For executing orders and handling signed messages, keepers are compensated from the market in which the order was placed.

## Usage

### Users (account owners)
All operations may be performed in a gasless manner using signed messages. Users must first deposit collateral into the market in which they wish to interact. This can be done directly or through an extension like _Collateral Accounts_.

#### Actions

##### Place Order
- Ensure your target market has sufficient collateral to support the order. For long or short orders, ensure there is sufficient funding for the order.
- Choose parameters for your order; see `contracts/types/TriggerOrder` documentation for details.
- Choose a unique-to-you order nonce and record it. Either call `placeOrder` directly on the `Manager`, or sign and send a `PlaceOrderAction` message to a relayer.

##### Replace Order
- To replace an unexecuted order, call `placeOrder` or send a `PlaceOrderAction` using the same order nonce as the unexecuted order you wish to replace. This will overwrite the unexecuted order in storage.

##### Cancel Order
- Find the order nonce you recorded when the order was placed.
- If the order was placed directly, or your `PlaceOrderAction` message was handled, call `cancelOrder` directly on the `Manager`, or sign and send a `CancelOrderAction` message to a relayer.
- If you placed the order using a signed message, and this request has not been processed, cancel the message nonce (different than the order nonce) directly with the `OrderVerifier` contract.

#### Messages

##### Domains
Message domain should be set to the `Manager` contract address.

##### Nonces
Note the message nonce works independently from the order nonce. If you choose to set message nonce equal to order nonce, you'll need a different scheme to assign nonces to cancellation and replacement messages. For example, you could use a serial order/message nonce, incrementing from 0. But for non-placement messages, you could decrement the serial nonce from `type(uint256).max`.

Nonces are hashed into each request to ensure the same signed action cannot be replayed. Two types of nonces are specified in every message:
- __nonce__ - used only once, automatically invalidated when message is verified
- __group__ - may be reused across messages, only cancelled manually

The _group_ nonce may be used to atomically cancel multiple actions. Let's explore a few use cases:
1. User doesn't care about _group_, so leaves it 0 for all actions. Their trading bot malfunctions, spraying relayers with many actions. User may send a message to cancel group 0 to make them all go away. For all future messages, user must specify a nonzero group.
1. User submits several related actions under the same _group_, enabling them to cancel any unfulfilled actions with a single message.
1. User formats the current UTC date as an integer and uses this for their _group_ nonce. This allows the user to send a single message to cancel all pending actions submitted on the specified date. Granularity could be reduced by formatting year and week number, or increased by including hour with the date.

### Keepers
Keepers should:
- Monitor their own relayers looking for EIP712 user messages to handle.
- Watch _Manager_ events and market price changes for opportunities to execute orders. _Manager_ exposes a `checkOrder` facility which may be called offchain prior to executing. Alternatively, keeper can use a transaction simulation API to confirm the execution will be successful and ensure they will be paid appropriately for transacting.

## Deployment
`Manager_Arbitrum` and `Verifier` will be deployed to the target chain.

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

### Coverage

Unit (not integration) tests for this extension are expected to have 100% coverage. To check test coverage:

```sh
$ yarn coverage
$ yarn coverage:integration
```

### Gas Report

To get a gas report based on unit test calls:

```sh
$ yarn gasReport
```