import { BigNumber, CallOverrides, constants, ContractTransaction, utils } from 'ethers'
import HRE from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { impersonateWithBalance } from '../../../common/testutil/impersonate'
import { currentBlockTimestamp, increaseTo } from '../../../common/testutil/time'
import { getTimestamp } from '../../../common/testutil/transaction'
import {
  IKeeperOracle,
  IOracleFactory,
  KeeperOracle,
  KeeperOracle__factory,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  PythFactory,
} from '@perennial/oracle/types/generated'
import { OracleVersionStruct } from '@perennial/oracle/types/generated/contracts/Oracle'

// TODO: consider sharing this across extensions, possibly by moving to packages/common
// Simulates an oracle update from KeeperOracle.
// If timestamp matches a requested version, callbacks implicitly settle the market.
export async function advanceToPrice(
  keeperOracle: IKeeperOracle,
  receiver: SignerWithAddress,
  timestamp: BigNumber,
  price: BigNumber,
  overrides?: CallOverrides,
): Promise<number> {
  const keeperFactoryAddress = await keeperOracle.factory()
  const oracleFactory = await impersonateWithBalance(keeperFactoryAddress, utils.parseEther('10'))

  // a keeper cannot commit a future price, so advance past the block
  const currentBlockTime = BigNumber.from(await currentBlockTimestamp())
  if (currentBlockTime < timestamp) {
    await increaseTo(timestamp.toNumber() + 2)
  }

  // create a version with the desired parameters and commit to the KeeperOracle
  const oracleVersion: OracleVersionStruct = {
    timestamp: timestamp,
    price: price,
    valid: true,
  }
  const tx: ContractTransaction = await keeperOracle
    .connect(oracleFactory)
    .commit(oracleVersion, receiver.address, 0, overrides ?? {})

  // inform the caller of the current timestamp
  return await getTimestamp(tx)
}

export async function createPythOracle(
  owner: SignerWithAddress,
  oracleFactory: IOracleFactory,
  pythOracleFactory: PythFactory,
  pythFeedId: string,
  name: string,
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
    await oracleFactory.callStatic.create(pythFeedId, pythOracleFactory.address, name),
    owner,
  )
  await oracleFactory.create(pythFeedId, pythOracleFactory.address, name, overrides ?? {})
  return [keeperOracle, oracle]
}

// Deploys and initializes an oracle factory without a proxy
export async function deployOracleFactory(owner: SignerWithAddress): Promise<OracleFactory> {
  // Deploy oracle factory to a proxy
  const oracleImpl = await new Oracle__factory(owner).deploy()
  const oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
  await oracleFactory.connect(owner).initialize()
  return oracleFactory
}
