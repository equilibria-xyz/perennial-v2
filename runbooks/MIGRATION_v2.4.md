# Perennial v2.3 Migration Runbook

## Checklist

0. [Pre-upgrade action items](#pre-upgrade-action-items)
2. [Enter *settle only* mode, and settle all accounts on all markets / vaults](#enter-settle-only-mode-and-settle-all-accounts-on-all-markets--vaults)
3. [Upgrade to v2.4](#upgrade-to-v24)

## Pre-upgrade action items

- Deploy v2.4 protocol implementations
  - `Vault` has been renamed `MakerVault`
  - Deploy a second `VaultFactory` for the `SolverVault` implementation
- [Clean up v2.3 migration](#clean-up-v23-migration)

### Clean up v2.3 migration

- Settle all local positions
- Claim DSU in OracleFactory

See https://github.com/equilibria-xyz/perennial-v2/pull/496.

## Enter *settle only* mode, and settle all accounts on all markets / vaults

Next we turn on the `settle` parameter to `true`. This pauses all new updates to the markets, while still allowing settlement.

We must then go through and settle every account that has a pending position present in each market and vault. This can be batched via a multicall contract.

This has multiple effects for the migration:

### Order

Small changes to the Order storage layout require there to be no pending orders at time of migration.

see: https://github.com/equilibria-xyz/perennial-v2/pull/538.

### Guarantee

Small changes to the Guarantee storage layout require there to be no pending orders w/ guarantees at time of migration.

see:
- https://github.com/equilibria-xyz/perennial-v2/pull/523.
- https://github.com/equilibria-xyz/perennial-v2/pull/527.

### Invariant

Changes to the invariant's handling of pending orders requires there to be no pending orders at time of migration.

see: https://github.com/equilibria-xyz/perennial-v2/pull/539.

## Upgrade to v2.4

The upgrade to v2.4 must be processed atomically, similarly to the upgrade to v2.3:

- Upgrade implementations to v2.4

Note: there are no changes to parameters, like in prior upgrades.
