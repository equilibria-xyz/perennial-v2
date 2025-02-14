import 'hardhat'
import { expect } from 'chai'
import { BigNumber, constants, utils } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import HRE from 'hardhat'
const { deployments, ethers } = HRE

import {
  deployMargin,
  deployMarketFactory,
  deployOracleFactory,
  STANDARD_MARKET_PARAMETER,
  STANDARD_PROTOCOL_PARAMETERS,
  STANDARD_RISK_PARAMETER,
} from '../helpers/setupHelpers'
import {
  IERC20Metadata__factory,
  IMarket,
  IMarketFactory,
  Market__factory,
  Verifier__factory,
} from '../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ChainlinkFactory,
  ChainlinkFactory__factory,
  IOracle,
  KeeperOracle,
  KeeperOracle__factory,
  Oracle__factory,
  OracleFactory,
} from '@perennial/v2-oracle/types/generated'

describe('Cross Margin', () => {
  let owner: SignerWithAddress
  let userA: SignerWithAddress
  let userB: SignerWithAddress
  let marketFactory: IMarketFactory
  let oracleA: OracleWithKeeperOracle
  let oracleB: OracleWithKeeperOracle
  let marketA: IMarket
  let marketB: IMarket
  let oracleFactory: OracleFactory
  let chainlinkOracleFactory: ChainlinkFactory

  interface OracleWithKeeperOracle {
    oracle: IOracle
    keeperOracle: KeeperOracle
  }

  async function fixture() {
    ;[owner, userA, userB] = await ethers.getSigners()

    oracleFactory = await deployOracleFactory(owner)
    await oracleFactory.connect(owner).initialize()

    const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
    const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)
    const verifier = await new Verifier__factory(owner).deploy()
    const margin = await deployMargin(dsu, owner)
    let marketImpl
    ;[marketFactory, marketImpl] = await deployMarketFactory(oracleFactory, margin, verifier, owner)
    await marketFactory.connect(owner).initialize()
    expect(await marketFactory.owner()).to.equal(owner.address)
    await marketFactory.updateParameter(STANDARD_PROTOCOL_PARAMETERS)

    const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(60)
    chainlinkOracleFactory = await new ChainlinkFactory__factory(owner).deploy(
      constants.AddressZero,
      constants.AddressZero,
      constants.AddressZero,
      constants.AddressZero,
      constants.AddressZero,
      keeperOracleImpl.address,
    )
    await chainlinkOracleFactory.initialize(oracleFactory.address)
    // KeeperFactory.updateParameter args: granularity, oracleFee, validFrom, validTo
    await chainlinkOracleFactory.updateParameter(1, 0, 4, 10)
    await oracleFactory.register(chainlinkOracleFactory.address)
    expect(await oracleFactory.factories(chainlinkOracleFactory.address)).to.equal(true)
    expect(await oracleFactory.owner()).to.equal(owner.address)
    expect(await chainlinkOracleFactory.owner()).to.equal(owner.address)
    // TODO: register payoff

    // TODO: create markets, each requiring a unique oracle address
    oracleA = await createOracle('0x000000000000000000000000000000000000000000000000000000000000000a', 'TOKENA-USD')
    marketA = await createMarket(oracleA.oracle)
    oracleB = await createOracle('0x000000000000000000000000000000000000000000000000000000000000000b', 'TOKENB-USD')
    marketB = await createMarket(oracleB.oracle)
  }

  async function createOracle(id: string, name: string): Promise<OracleWithKeeperOracle> {
    const payoffDefinition = {
      provider: ethers.constants.AddressZero,
      decimals: 0,
    }
    // create the keeper oracle (implementation)
    const keeperOracle = KeeperOracle__factory.connect(
      await chainlinkOracleFactory.callStatic.create(id, id, payoffDefinition),
      owner,
    )
    await chainlinkOracleFactory.create(id, id, payoffDefinition)
    expect(await chainlinkOracleFactory.oracles(id)).to.equal(keeperOracle.address)

    // create the oracle (which interacts with the market)
    const oracle = Oracle__factory.connect(
      await oracleFactory.callStatic.create(id, chainlinkOracleFactory.address, name),
      owner,
    )
    await oracleFactory.create(id, chainlinkOracleFactory.address, name)
    await keeperOracle.register(oracle.address)

    return { oracle, keeperOracle }
  }

  async function createMarket(oracle: IOracle): Promise<IMarket> {
    const marketAddress = await marketFactory.callStatic.create(oracle.address)
    await marketFactory.create(oracle.address)

    const market = Market__factory.connect(marketAddress, owner)
    await market.updateRiskParameter(STANDARD_RISK_PARAMETER)
    await market.updateParameter(STANDARD_MARKET_PARAMETER)

    await oracle.register(market.address)

    return market
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  it('fixture sets up test environment', async () => {
    expect(marketA.address).to.not.equal(marketB.address)
    // TODO: prove we can commit prices to oracles
  })
})
