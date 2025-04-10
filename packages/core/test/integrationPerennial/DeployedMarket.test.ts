import HRE from 'hardhat'
const { ethers, deployments } = HRE
const { constants, utils } = ethers
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'

import { impersonate } from '../../../common/testutil'
import {
  IERC20__factory,
  Market,
  Market__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
} from '../../types/generated'
import { deployMarketFactoryImplementation, deployMarketImplementation } from './setupHelpers'

const BTC_MARKET = '0x687CC5097210dE03940bBC8e5edD820da7Dd6827'
const ETH_MARKET = '0x62564Cd7278B79b9CFe76388e0EEe115389586c6'
const SOL_MARKET = '0xa534972Ec3Bc7e25559cc7A3b1e3Adc03C9Fb6f8'

describe('DeployedMarketTest', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let market: Market
  let proxyAdmin: ProxyAdmin
  let proxyAdminSigner: SignerWithAddress

  // Use this to replace the forked deployment with a new one,
  // such that logging may be added or changes experimented with.
  async function upgradeMarketFactory() {
    // deploy updated market implementation
    const verifierAddress = (await deployments.get('Verifier')).address
    const newMarketImpl = await deployMarketImplementation(owner, verifierAddress)

    // deploy new market factory
    const factoryImpl = await deployMarketFactoryImplementation(
      owner,
      newMarketImpl,
      (
        await deployments.get('OracleFactory')
      ).address,
      verifierAddress,
    )

    // upgrade the factory
    const proxy = TransparentUpgradeableProxy__factory.connect((await deployments.get('MarketFactory')).address, owner)
    await proxyAdmin.connect(proxyAdminSigner).upgrade(proxy.address, factoryImpl.address)
  }

  before(async () => {
    ;[owner, user] = await ethers.getSigners()
    proxyAdmin = ProxyAdmin__factory.connect((await deployments.get('ProxyAdmin')).address, user)
    proxyAdminSigner = await impersonate.impersonateWithBalance(await proxyAdmin.owner(), utils.parseEther('10'))

    market = Market__factory.connect(BTC_MARKET, user)
  })

  it('can settle existing market', async () => {
    // open the market
    let marketParams = await market.parameter()
    marketParams = { ...marketParams, closed: false }
    await market.connect(proxyAdminSigner).updateParameter(marketParams)

    await expect(market.connect(user).settle(constants.AddressZero)).to.not.be.reverted
  })

  it('can settle closed market', async () => {
    // close the market
    let marketParams = await market.parameter()
    marketParams = { ...marketParams, closed: true }
    await market.connect(proxyAdminSigner).updateParameter(marketParams)

    await expect(market.connect(user).settle(constants.AddressZero)).to.not.be.reverted

    // open the market
    marketParams = await market.parameter()
    marketParams = { ...marketParams, closed: false }
    await market.connect(proxyAdminSigner).updateParameter(marketParams)
  })

  it('can upgrade market to new version and settle', async () => {
    await upgradeMarketFactory()
    await expect(market.connect(user).settle(constants.AddressZero)).to.not.be.reverted
  })

  it('can read market state', async () => {
    const position = await market.position()
    // ensure skew less than maker position
    expect(position.long.add(position.short).abs()).to.be.lt(position.maker)

    // check version sanity
    const global = await market.global()
    expect(global.latestId).to.be.lte(global.currentId)

    // ensure market has funds
    const token = IERC20__factory.connect(await market.token(), owner)
    const collateralBalance = await token.balanceOf(market.address)
    expect(collateralBalance).to.be.gt(utils.parseEther('3.50'))
  })
})
