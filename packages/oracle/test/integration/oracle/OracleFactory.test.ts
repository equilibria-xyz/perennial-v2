import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { utils } from 'ethers'
import HRE from 'hardhat'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  KeeperOracle__factory,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  PythFactory,
  PythFactory__factory,
  GasOracle,
  GasOracle__factory,
} from '../../../types/generated'

const { ethers } = HRE

const PYTH_ADDRESS = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6'
const PYTH_ETH_USD_PRICE_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
const DSU_ADDRESS = '0x605D26FBd5be761089281d5cec2Ce86eeA667109'
const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DSU_HOLDER = '0x2d264EBDb6632A06A1726193D4d37FeF1E5dbDcd'

describe('OracleFactory', () => {
  let user: SignerWithAddress
  let owner: SignerWithAddress
  let commitmentGasOracle: GasOracle
  let settlementGasOracle: GasOracle
  let pythOracleFactory: PythFactory
  let oracleFactory: OracleFactory
  let dsu: IERC20Metadata

  const fixture = async () => {
    ;[owner, user] = await ethers.getSigners()

    dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)

    const oracleImpl = await new Oracle__factory(owner).deploy()
    oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
    await oracleFactory.initialize()

    commitmentGasOracle = await new GasOracle__factory(owner).deploy(
      CHAINLINK_ETH_USD_FEED,
      8,
      1_000_000,
      ethers.utils.parseEther('1.02'),
      1_000_000,
      0,
      0,
      0,
    )
    settlementGasOracle = await new GasOracle__factory(owner).deploy(
      CHAINLINK_ETH_USD_FEED,
      8,
      200_000,
      ethers.utils.parseEther('1.02'),
      500_000,
      0,
      0,
      0,
    )

    const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(60)
    pythOracleFactory = await new PythFactory__factory(owner).deploy(
      PYTH_ADDRESS,
      commitmentGasOracle.address,
      settlementGasOracle.address,
      keeperOracleImpl.address,
    )
    await pythOracleFactory.initialize(oracleFactory.address)
    await pythOracleFactory.updateParameter(1, 0, 4, 10)
    await oracleFactory.register(pythOracleFactory.address)

    await pythOracleFactory.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
      provider: ethers.constants.AddressZero,
      decimals: 0,
    })

    await oracleFactory.create(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory.address, 'ETH-USD')

    const dsuHolder = await impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    await dsu.connect(dsuHolder).transfer(oracleFactory.address, utils.parseEther('10000'))
  }

  beforeEach(async () => {
    await loadFixture(fixture)
  })

  describe('#update', async () => {
    it('can update the price id', async () => {
      const keeperOracleImpl2 = await new KeeperOracle__factory(owner).deploy(60)
      const pythOracleFactory2 = await new PythFactory__factory(owner).deploy(
        PYTH_ADDRESS,
        commitmentGasOracle.address,
        settlementGasOracle.address,
        keeperOracleImpl2.address,
      )
      await pythOracleFactory2.initialize(oracleFactory.address)
      await pythOracleFactory2.updateParameter(1, 0, 4, 10)
      await oracleFactory.register(pythOracleFactory2.address)

      await pythOracleFactory2.create(PYTH_ETH_USD_PRICE_FEED, PYTH_ETH_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })
      const newProvider = await pythOracleFactory2.oracles(PYTH_ETH_USD_PRICE_FEED)

      const oracle = Oracle__factory.connect(await oracleFactory.oracles(PYTH_ETH_USD_PRICE_FEED), owner)
      await expect(oracleFactory.update(PYTH_ETH_USD_PRICE_FEED, pythOracleFactory2.address))
        .to.emit(oracle, 'OracleUpdated')
        .withArgs(newProvider)
    })
  })
})
