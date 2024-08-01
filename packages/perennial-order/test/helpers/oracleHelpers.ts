import { BigNumber, CallOverrides, constants, utils } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import {
  IKeeperOracle,
  IOracleFactory,
  IOracleProvider,
  KeeperOracle,
  KeeperOracle__factory,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  PythFactory,
  PythFactory__factory,
} from '@equilibria/perennial-v2-oracle/types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

export async function createPythOracle(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  pythOracleFactory: PythFactory,
  pythFeedId: string,
  overrides?: CallOverrides,
): Promise<[KeeperOracle, Oracle]> {
  // Create the keeper oracle, which tests may use to meddle with prices
  const keeperOracle = KeeperOracle__factory.connect(
    await pythOracleFactory.callStatic.create(pythFeedId, pythFeedId, {
      provider: constants.AddressZero,
      decimals: 0,
    }),
    owner,
  )
  await pythOracleFactory.create(
    pythFeedId,
    pythFeedId,
    { provider: constants.AddressZero, decimals: 0 },
    overrides ?? {},
  )

  // Create the oracle, which markets created by the market factory will query
  const oracle = Oracle__factory.connect(
    await oracleFactory.callStatic.create(pythFeedId, pythOracleFactory.address),
    owner,
  )
  await oracleFactory.create(pythFeedId, pythOracleFactory.address, overrides ?? {})
  return [keeperOracle, oracle]
}

// Deploys and initializes an oracle factory without a proxy
export async function deployOracleFactory(owner: SignerWithAddress, dsuAddress: Address): Promise<OracleFactory> {
  // Deploy oracle factory to a proxy
  const oracleImpl = await new Oracle__factory(owner).deploy()
  const oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
  await oracleFactory.connect(owner).initialize(dsuAddress)
  return oracleFactory
}
