# Perennial v2.2 Migration Runbook

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Pre-upgrade action items

- Deploy v2.2 implementations
- Deploy new Pyth implementation w/ all oracles
  - Including separate oracles for power perp markets
- Update Vault parameters
- Ensure latest is valid for all oracles

## Checklist

0. Pre-upgrade action items
1. Upgrade to v2.1.1
2. Enter `settle-only` mode
3. Settle all accounts on all live markets / vaults
4. Upgrade to v2.2

### Update Vault parameters

Vault weights must be reset to sum to one in order to satisfy the variant prior to upgrade.

see: https://github.com/equilibria-xyz/perennial-v2/pull/203.

### Ensure latest is valid for all oracles

Latest has been moved from the Market into the oracle layer. We must ensure that all latest oracle versions are valid on each oracle before upgrading.

see: https://github.com/equilibria-xyz/perennial-v2/pull/222.

## Upgrade to v2.1.1

Upgrade the protocol contracts to [v2.1.1](https://github.com/equilibria-xyz/perennial-v2/pull/257), to add *settle only* mode.

This is upgrade-safe since the new `settleOnly` field in the risk parameters defaults to `false`.

## Enter settle only mode

Next we turn on the `settleOnly` parameter to `true`. This pauses all new updates to the markets, while still allowing settlement.

## Settle all accounts on all live markets / vaults

We must then go through and settle every single account that has an unsettled position present in each market. This can be batched via a multicall contract.

This has multiple effects for the migration:

### Pending Position / Order

We are migrating off the pending position standard onto orders in v2.2.

This ensures that all pending position have been fully processed, so that it is safe to ignore them going forward.

see: https://github.com/equilibria-xyz/perennial-v2/pull/208.

### Checkpoint

Moves the `fee`, `keeper`, `delta`, and `collateral` fields out of the local pending `Position` and into a new `Checkpoint` type since the position fees are no longer known at time of position update.

see: https://github.com/equilibria-xyz/perennial-v2/pull/208.

### Oracle

Payoff is moved from the `Market` into the oracle. This requires us to update the oracle of the live power perp markets. In order to do this seemlessly, we need there to be no outstanding requested versions on the existing oracles prior to the upgrade.

This ensures that all new requests can safely go directly to the new oracle implementation without needing to go through the switchover process.

see: https://github.com/equilibria-xyz/perennial-v2/pull/200.

### Vault

The Vault uses the collateral stamp from the pending position / checkpoint in order to calculate the settled state of its balance in its underlying markets.

We must ensure that the every account in each Vault is also fully settled so that we no longer need any prior pending position.

see: https://github.com/equilibria-xyz/perennial-v2/pull/233.

## Upgrade to v2.2

The upgrade to v2.2 must be processed atomically, similarly to the upgrade to v2.1:

- Upgrade implementations to v2.2
- Update Risk / Market / Protocol Parameters to new format
- Update sub-oracles to v2.2-based oracles
- Update oracles of power perp markets from linear to payoff oracles

### Update Risk / Market / Protocol Parameters to new format

All parameter sets have a new format. Each needs to be updated for all markets.

### Update sub-oracles to v2.2-based oracles

A new PythOracle implementation will be deployed with this release. A standard update is required on each market to transition to the new oracles.

### Update oracles of power perp markets from linear to payoff oracles

Since we are moving payoffs to the oracle layer, we must update the oracles of the power perp markets specifically.
