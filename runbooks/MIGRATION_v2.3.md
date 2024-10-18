# Perennial v2.3 Migration Runbook

## Checklist

0. [Pre-upgrade action items](#pre-upgrade-action-items)
2. [Enter *settle only* mode, and settle all accounts on all markets / vaults](#enter-settle-only-mode-and-settle-all-accounts-on-all-markets--vaults)
3. [Upgrade to v2.3](#upgrade-to-v23)

## Pre-upgrade action items

- Deploy v2.3 protocol implementations
  - Including new GasOracle and Verifier externalized helper contracts
- Deploy MultiCall4 instance
- Deploy fresh v2.3 Pyth oracle instance
- [Clean up v2.2 Checkpoint migration](#checkpoint-migration)

### Checkpoint Migration

If not otherwise complete, settle all accounts on all markets (with a fresh price), to trigger the post-v2.2 Checkpoint migration logic.

see: https://github.com/equilibria-xyz/perennial-v2/pull/284.

## Enter *settle only* mode, and settle all accounts on all markets / vaults

Next we turn on the `settle` parameter to `true`. This pauses all new updates to the markets, while still allowing settlement.

We must then go through and settle every single account that has an unsettled position present in each market. This can be batched via a multicall contract.

This has multiple effects for the migration:

### Version

Version has a considerable amount of new fields.

Each of these new fields is non-aggregating, i.e. is reset each version and only use to track things like position fees for the specified version.

This is upgrade safe since the legacy aggregated fields are unchanged in their storage position, and the new fields are reset to zero upon preparing a new version.

see: https://github.com/equilibria-xyz/perennial-v2/pull/291

### Oracle

`IOracleProvider.at()` now has a new return type, returning a `OracleReceipt` in addition to the `OracleVersion`.

To ensure that the first settlement after the switchover processes correctly, we must settle up the latest global version after entering settle only mode.

see: https://github.com/equilibria-xyz/perennial-v2/pull/373.

## Upgrade to v2.3

The upgrade to v2.3 must be processed atomically, similarly to the upgrade to v2.2:

- Upgrade implementations to v2.3
- [Run the global Position migration](#position-migration)
- [Update Risk / Market / Protocol Parameters to new format](#update-risk--market--protocol-parameters-to-new-format)
- [Update sub-oracles to v2.3-based oracles](#update-sub-oracles-to-v23-based-oracles-implementations)

### Position Migration

- Call `.migrate()` on each market to migrate the storage pattern of the global `Position` of each market.

see: https://github.com/equilibria-xyz/perennial-v2/pull/424

### Update Risk / Market / Protocol Parameters to new format

All parameter sets have a new format. Each needs to be updated for all markets.
- Oracle
  - OracleParameter
  - KeeperOracleParameter
- Market
  - ProtocolParameter
  - RiskParameter (per market)
  - MarketParameter (per market)
- Vault
  - VaultParameter (per vault)

Notable fields changes for reference:
- MarketParameter
  - removes `.oracleFee` and `.settlementFee`, see: https://github.com/equilibria-xyz/perennial-v2/pull/373.
  - replaces `.positionFee` with `.makerFee` and `.takerFee`, see: https://github.com/equilibria-xyz/perennial-v2/pull/291.
- RiskParameter removes `.makerFee.adiabaticFee`, see: https://github.com/equilibria-xyz/perennial-v2/pull/317.
- ProtocolParameter adds `minScale`, see: https://github.com/equilibria-xyz/perennial-v2/pull/362.
- VaultParameter adds `minDeposit`, see: https://github.com/equilibria-xyz/perennial-v2/pull/373.

### Update sub-oracles to v2.3-based oracles implementations

New PythFactory and CryptexFactory implementations will be deployed with this release. A standard sub-oracle update is required on each market's oracle to transition to the new sub-oracles.

Must also register each market with its oracle via `Oracle.register(market)`. This step must be done whenever launching a new oracle going forward as well.

see:
  - https://github.com/equilibria-xyz/perennial-v2/pull/372
  - https://github.com/equilibria-xyz/perennial-v2/pull/379

## Post Upgrade Cleanup

### Instance Metadata

We've added a few new metadata fields to the oracle system. These should be populated after the migration to aid with off-chain discovery, however are not required logically within the protocol.

- `Oracle.updateName(string name)`
- `OracleFactory.updateId(IOracle Provider oracleProvider, bytes32 id)`

New oracles deployed post-v2.3 will automatically include this information.

see:
  - https://github.com/equilibria-xyz/perennial-v2/pull/423
  - https://github.com/equilibria-xyz/perennial-v2/pull/339

### Position Migration

After posting a new price, each account on each market should be settled once. This ensures that each local Position has upgraded to the v1 storage layout, which allows us to remove this functionality in the next version.

see: https://github.com/equilibria-xyz/perennial-v2/pull/424.