import { smock, MockContract as SmockContract } from '@defi-wonderland/smock'
import { MockContract } from '@ethereum-waffle/mock-contract'
import { BigNumber, constants, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE, { waffle } from 'hardhat'

import { impersonate } from '../../../../common/testutil'

import { Market, Market__factory, IOracleProvider__factory, Factory__factory } from '../../../types/generated'
import { expectPositionEq } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

describe('Market', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let userB: SignerWithAddress
  let userC: SignerWithAddress
  let factorySigner: SignerWithAddress
  let collateralSigner: SignerWithAddress
  let factory: MockContract
  let collateral: MockContract
  let oracle: MockContract
  let incentivizer: MockContract

  let market: Market

  const POSITION = utils.parseEther('10')
  const FUNDING_FEE = utils.parseEther('0.10')
  const MAKER_FEE = utils.parseEther('0.0')
  const TAKER_FEE = utils.parseEther('0.0')
  const MAINTENANCE = utils.parseEther('0.5')
  const MARKET_INFO = {
    name: 'Squeeth',
    symbol: 'SQTH',
    payoffDefinition: {},
    oracle: '',
    maintenance: MAINTENANCE,
    fundingFee: FUNDING_FEE,
    makerFee: MAKER_FEE,
    takerFee: TAKER_FEE,
    makerLimit: POSITION.mul(10),
    utilizationCurve: {
      // Force a 0.10 rate to make tests simpler
      minRate: utils.parseEther('0.10'),
      maxRate: utils.parseEther('0.10'),
      targetRate: utils.parseEther('0.10'),
      targetUtilization: utils.parseEther('1'),
    },
  }

  beforeEach(async () => {
    ;[owner, user, userB, userC] = await ethers.getSigners()
    oracle = await waffle.deployMockContract(owner, IOracleProvider__factory.abi)

    factory = await waffle.deployMockContract(owner, Factory__factory.abi)
    factorySigner = await impersonate.impersonateWithBalance(factory.address, utils.parseEther('10'))

    market = await new Market__factory(owner).deploy()
    MARKET_INFO.oracle = oracle.address
    await market.connect(factorySigner).initialize(MARKET_INFO)

    await factory.mock.paused.withArgs().returns(false)
    await factory.mock.collateral.withArgs().returns(collateral.address)
    await factory.mock.incentivizer.withArgs().returns(incentivizer.address)
    await factory.mock.coordinatorFor.withArgs(market.address).returns(1)
    await factory.mock.owner.withArgs(1).returns(owner.address)
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await market.factory()).to.equal(factory.address)
      expect(await market.name()).to.equal('Squeeth')
      expect(await market.symbol()).to.equal('SQTH')
      const payoffDefinition = await market.payoffDefinition()
      expect(payoffDefinition.payoffType).to.equal(MARKET_INFO.payoffDefinition.payoffType)
      expect(payoffDefinition.payoffDirection).to.equal(MARKET_INFO.payoffDefinition.payoffDirection)
      expect(payoffDefinition.data).to.equal(MARKET_INFO.payoffDefinition.data)
      expect(await market.oracle()).to.equal(oracle.address)
      expect(await market['maintenance()']()).to.equal(utils.parseEther('0.5'))
      expect(await market.fundingFee()).to.equal(utils.parseEther('0.1'))
      expect(await market.makerFee()).to.equal(utils.parseEther('0'))
      expect(await market.takerFee()).to.equal(utils.parseEther('0'))
      expect(await market.makerLimit()).to.equal(utils.parseEther('100'))

      const curve = await market.utilizationCurve()
      expect(curve.minRate).to.equal(utils.parseEther('0.10'))
      expect(curve.maxRate).to.equal(utils.parseEther('0.10'))
      expect(curve.targetRate).to.equal(utils.parseEther('0.10'))
      expect(curve.targetUtilization).to.equal(utils.parseEther('1'))
    })

    it('reverts if already initialized', async () => {
      await expect(market.initialize(MARKET_INFO)).to.be.revertedWith('UInitializableAlreadyInitializedError(1)')
    })

    it('reverts if oracle is not a contract', async () => {
      const otherMarket = await new Market__factory(owner).deploy()
      await expect(
        otherMarket.connect(factorySigner).initialize({ ...MARKET_INFO, oracle: user.address }),
      ).to.be.revertedWith('PayoffProviderInvalidOracle()')
    })

    describe('payoffDefinition validity', () => {
      let otherMarket: Market

      beforeEach(async () => {
        otherMarket = await new Market__factory(owner).deploy()
      })

      it('reverts if passthrough definition contains data', async () => {
        const payoffDefinition = createPayoffDefinition()
        payoffDefinition.data = payoffDefinition.data.substring(0, payoffDefinition.data.length - 1) + '1'

        await expect(
          otherMarket.connect(factorySigner).initialize({ ...MARKET_INFO, payoffDefinition }),
        ).to.be.revertedWith('PayoffProviderInvalidPayoffDefinitionError()')
      })

      it('reverts if market provider is not a contract', async () => {
        await expect(
          otherMarket.connect(factorySigner).initialize({
            ...MARKET_INFO,
            payoffDefinition: createPayoffDefinition({ contractAddress: user.address }),
          }),
        ).to.be.revertedWith('PayoffProviderInvalidPayoffDefinitionError()')
      })
    })
  })

  describe('updating params', async () => {
    it('correctly updates the params', async () => {
      await market.updateMaintenance(utils.parseEther('0.1'))
      await market.updateFundingFee(utils.parseEther('0.2'))
      await market.updateMakerFee(utils.parseEther('0.3'))
      await market.updateTakerFee(utils.parseEther('0.4'))
      await market.updateMakerLimit(utils.parseEther('0.5'))
      await market.updateUtilizationCurve({
        minRate: utils.parseEther('0.10'),
        maxRate: utils.parseEther('0.20'),
        targetRate: utils.parseEther('0.30'),
        targetUtilization: utils.parseEther('0.4'),
      })

      expect(await market['maintenance()']()).to.equal(utils.parseEther('0.1'))
      expect(await market.fundingFee()).to.equal(utils.parseEther('0.2'))
      expect(await market.makerFee()).to.equal(utils.parseEther('0.3'))
      expect(await market.takerFee()).to.equal(utils.parseEther('0.4'))
      expect(await market.makerLimit()).to.equal(utils.parseEther('0.5'))

      const curve = await market.utilizationCurve()
      expect(curve.minRate).to.equal(utils.parseEther('0.10'))
      expect(curve.maxRate).to.equal(utils.parseEther('0.20'))
      expect(curve.targetRate).to.equal(utils.parseEther('0.30'))
      expect(curve.targetUtilization).to.equal(utils.parseEther('0.4'))
    })

    it('reverts if not owner', async () => {
      await expect(market.connect(user).updateMaintenance(utils.parseEther('0.1'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
      await expect(market.connect(user).updateFundingFee(utils.parseEther('0.2'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
      await expect(market.connect(user).updateMakerFee(utils.parseEther('0.3'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
      await expect(market.connect(user).updateTakerFee(utils.parseEther('0.4'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
      await expect(market.connect(user).updateMakerLimit(utils.parseEther('0.5'))).to.be.be.revertedWith(
        'NotOwnerError(1)',
      )
    })

    it('reverts if fees are too high', async () => {
      await expect(market.updateFundingFee(utils.parseEther('1.01'))).to.be.be.revertedWith(
        'ParamProviderInvalidFundingFee()',
      )
      await expect(market.updateMakerFee(utils.parseEther('1.01'))).to.be.be.revertedWith(
        'ParamProviderInvalidMakerFee()',
      )
      await expect(market.updateTakerFee(utils.parseEther('1.01'))).to.be.be.revertedWith(
        'ParamProviderInvalidTakerFee()',
      )
    })
  })

  describe('positive price market', async () => {
    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: 0,
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    const ORACLE_VERSION_2 = {
      price: PRICE,
      timestamp: TIMESTAMP + 3600,
      version: ORACLE_VERSION + 1,
    }

    const ORACLE_VERSION_3 = {
      price: PRICE,
      timestamp: TIMESTAMP + 7200,
      version: ORACLE_VERSION + 2,
    }

    const ORACLE_VERSION_4 = {
      price: PRICE,
      timestamp: TIMESTAMP + 10800,
      version: ORACLE_VERSION + 3,
    }

    beforeEach(async () => {
      await collateral.mock.settleMarket.withArgs(0).returns()
      await collateral.mock.settleAccount.withArgs(user.address, 0).returns()
      await collateral.mock.settleAccount.withArgs(userB.address, 0).returns()
      await collateral.mock.settleAccount.withArgs(userC.address, 0).returns()
      await collateral.mock.liquidatableNext.withArgs(user.address, market.address).returns(false)
      await collateral.mock.liquidatableNext.withArgs(userB.address, market.address).returns(false)
      await collateral.mock.liquidatableNext.withArgs(userC.address, market.address).returns(false)

      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(1).returns(ORACLE_VERSION_1)

      await factory.mock.minFundingFee.withArgs().returns(FUNDING_FEE)

      await incentivizer.mock.sync.withArgs(ORACLE_VERSION_1).returns()

      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
    })

    context('#openMake', async () => {
      it('opens the position', async () => {
        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens the position and settles', async () => {
        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 2)

        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (same version)', async () => {
        await market.connect(user).openMake(POSITION)

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens a second position and settles (same version)', async () => {
        await market.connect(user).openMake(POSITION)

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 2)

        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (next version)', async () => {
        await market.connect(user).openMake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position and settles (next version)', async () => {
        await market.connect(user).openMake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later', async () => {
        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later with fee', async () => {
        await market.updateMakerFee(utils.parseEther('0.01'))

        const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
        await collateral.mock.settleMarket.withArgs(MAKER_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position with settle after liquidation', async () => {
        await market.connect(user).openMake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await market.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')

        // Advance version
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if oracle not bootstrapped', async () => {
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_0)
        await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_0)

        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketOracleBootstrappingError()')
      })

      it('reverts if can liquidate', async () => {
        await collateral.mock.liquidatableNext.withArgs(user.address, market.address).returns(true)

        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketInsufficientCollateralError()')
      })

      it('reverts if double sided position', async () => {
        await market.connect(userB).openMake(POSITION.mul(2))
        await market.connect(user).openTake(POSITION)

        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketDoubleSidedError()')
      })

      it('reverts if in liquidation', async () => {
        await market.connect(collateralSigner).closeAll(user.address)
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('PausedError()')
      })

      it('reverts if over maker limit', async () => {
        await market.updateMakerLimit(POSITION.div(2))
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketMakerOverLimitError()')
      })

      it('reverts if closed', async () => {
        await market.updateClosed(true)
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketClosedError()')
      })
    })

    context('#closeMake', async () => {
      beforeEach(async () => {
        await market.connect(user).openMake(POSITION)
      })

      it('closes the position partially', async () => {
        await expect(market.connect(user).closeMake(POSITION.div(2)))
          .to.emit(market, 'MakeClosed')
          .withArgs(user.address, 1, POSITION.div(2))

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.div(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.div(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('closes the position', async () => {
        await expect(market.connect(user).closeMake(POSITION))
          .to.emit(market, 'MakeClosed')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(true)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(0)
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      context('settles first', async () => {
        beforeEach(async () => {
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await market.connect(user).settle()
          await market.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expect(await market['latestVersion()']()).to.equal(2)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes the position and settles', async () => {
          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (same version)', async () => {
          await market.connect(user).closeMake(POSITION.div(2))

          await expect(market.connect(user).closeMake(POSITION.div(2)))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expect(await market['latestVersion()']()).to.equal(2)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes a second position and settles (same version)', async () => {
          await market.connect(user).closeMake(POSITION.div(2))

          await expect(market.connect(user).closeMake(POSITION.div(2)))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (next version)', async () => {
          await market.connect(user).closeMake(POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).closeMake(POSITION.div(2)))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: POSITION.div(2), taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION.div(2), taker: 0 },
          })
          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.div(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION.div(2), taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position and settles (next version)', async () => {
          await market.connect(user).closeMake(POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).closeMake(POSITION.div(2)))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(4), { maker: utils.parseEther('1080'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 4, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(4), { maker: utils.parseEther('360'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await market.updateMakerFee(utils.parseEther('0.01'))

          const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
          await collateral.mock.settleMarket.withArgs(MAKER_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(4), { maker: utils.parseEther('360'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position if taker > maker and market is closed', async () => {
          await market.connect(userB).openTake(POSITION)
          await market.updateClosed(true)

          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)
        })

        it('reverts if taker > maker', async () => {
          await market.connect(userB).openTake(POSITION)

          await expect(market.connect(user).closeMake(POSITION)).to.be.revertedWith(
            `MarketInsufficientLiquidityError(0)`,
          )
        })

        it('reverts if underflow', async () => {
          await expect(market.connect(user).closeMake(POSITION.mul(2))).to.be.revertedWith('MarketOverClosedError()')
        })

        it('reverts if in liquidation', async () => {
          await market.connect(collateralSigner).closeAll(user.address)
          await expect(market.connect(user).closeMake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
        })

        it('reverts if paused', async () => {
          await factory.mock.paused.withArgs().returns(true)
          await expect(market.connect(user).closeMake(POSITION)).to.be.revertedWith('PausedError()')
        })
      })
    })

    context('#openTake', async () => {
      beforeEach(async () => {
        await market.connect(userB).openMake(POSITION.mul(2))
      })

      it('opens the position', async () => {
        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens the position and settles', async () => {
        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 2)

        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (same version)', async () => {
        await market.connect(user).openTake(POSITION)

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION.mul(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION.mul(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens a second position and settles (same version)', async () => {
        await market.connect(user).openTake(POSITION)

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 2)

        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION.mul(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION.mul(2) })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (next version)', async () => {
        await market.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position and settles (next version)', async () => {
        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

        await market.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.mul(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION.mul(2) })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later', async () => {
        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later with fee', async () => {
        await market.updateTakerFee(utils.parseEther('0.01'))

        const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleMarket.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
        await collateral.mock.settleAccount.withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1)).returns()

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position with settle after liquidation', async () => {
        await market.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await market.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')

        // Advance version
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if taker > maker', async () => {
        const socialization = utils.parseEther('0.5')
        await expect(market.connect(user).openTake(POSITION.mul(4))).to.be.revertedWith(
          `MarketInsufficientLiquidityError(${socialization})`,
        )
      })

      it('reverts if double sided position', async () => {
        await market.connect(user).openMake(POSITION)
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketDoubleSidedError()')
      })

      it('reverts if in liquidation', async () => {
        await market.connect(collateralSigner).closeAll(user.address)
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('PausedError()')
      })

      it('reverts if closed', async () => {
        await market.updateClosed(true)
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketClosedError()')
      })
    })

    context('#closeTake', async () => {
      beforeEach(async () => {
        await market.connect(userB).openMake(POSITION.mul(2))
        await market.connect(user).openTake(POSITION)
      })

      it('closes the position partially', async () => {
        await expect(market.connect(user).closeTake(POSITION.div(2)))
          .to.emit(market, 'TakeClosed')
          .withArgs(user.address, 1, POSITION.div(2))

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION.div(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION.div(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('closes the position', async () => {
        await expect(market.connect(user).closeTake(POSITION))
          .to.emit(market, 'TakeClosed')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(true)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(0)
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      context('settles first', async () => {
        beforeEach(async () => {
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await market.connect(user).settle()
          await market.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(market.connect(user).closeTake(POSITION))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expect(await market['latestVersion()']()).to.equal(2)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes the position and settles', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await expect(market.connect(user).closeTake(POSITION))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (same version)', async () => {
          await market.connect(user).closeTake(POSITION.div(2))

          await expect(market.connect(user).closeTake(POSITION.div(2)))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expect(await market['latestVersion()']()).to.equal(2)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes a second position and settles (same version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await market.connect(user).closeTake(POSITION.div(2))

          await expect(market.connect(user).closeTake(POSITION.div(2)))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (next version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await market.connect(user).closeTake(POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).closeTake(POSITION.div(2)))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION.div(2) },
          })
          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION.div(2) },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position and settles (next version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.25 * 20 * 123 = 7020547944372000
          const EXPECTED_FUNDING_1 = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_2 = ethers.BigNumber.from('7020547944372000')
          const EXPECTED_FUNDING_FEE_1 = EXPECTED_FUNDING_1.div(10)
          const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
          const EXPECTED_FUNDING_WITH_FEE_1 = EXPECTED_FUNDING_1.sub(EXPECTED_FUNDING_FEE_1) // maker funding
          const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE_1).returns()
          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE_2).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_1.mul(-1)).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_2.mul(-1)).returns()

          await market.connect(user).closeTake(POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).closeTake(POSITION.div(2)))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE_1.div(20),
            taker: EXPECTED_FUNDING_1.div(10).mul(-1),
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE_1.add(EXPECTED_FUNDING_WITH_FEE_2).div(20),
            taker: EXPECTED_FUNDING_1.div(10).add(EXPECTED_FUNDING_2.div(5)).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('1080'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 4, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await expect(market.connect(user).closeTake(POSITION))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('360'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await market.updateTakerFee(utils.parseEther('0.01'))

          const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
          await collateral.mock.settleAccount.withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1)).returns()

          await expect(market.connect(user).closeTake(POSITION))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('360'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('reverts if underflow', async () => {
          await expect(market.connect(user).closeTake(POSITION.mul(2))).to.be.revertedWith('MarketOverClosedError()')
        })

        it('reverts if in liquidation', async () => {
          await market.connect(collateralSigner).closeAll(user.address)
          await expect(market.connect(user).closeTake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
        })

        it('reverts if paused', async () => {
          await factory.mock.paused.withArgs().returns(true)
          await expect(market.connect(user).closeTake(POSITION)).to.be.revertedWith('PausedError()')
        })
      })
    })

    describe('#closeAll', async () => {
      it('closes maker side', async () => {
        await market.connect(user).openMake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await market.connect(user).settle()
        await market.connect(user).settleAccount(user.address)

        await market.connect(user).openMake(POSITION)

        await market.connect(collateralSigner).closeAll(user.address)

        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: POSITION, taker: 0 },
        })

        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: POSITION, taker: 0 },
        })
        expect(await market.isLiquidating(user.address)).to.equal(true)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
      })

      it('closes taker side', async () => {
        await market.connect(userB).openMake(POSITION.mul(2))
        await market.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await market.connect(user).settle()
        await market.connect(user).settleAccount(user.address)

        await market.connect(user).openTake(POSITION)

        await market.connect(collateralSigner).closeAll(user.address)

        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: POSITION },
        })

        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: POSITION },
        })
        expect(await market.isLiquidating(user.address)).to.equal(true)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
      })

      it('reverts if already initialized', async () => {
        await expect(market.connect(user).closeAll(user.address)).to.be.revertedWith(`NotCollateralError()`)
      })
    })

    context('#settle / #settleAccount', async () => {
      // rate * elapsed * utilization * maker * price
      // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 10 * 123 = 7020547945205480
      const EXPECTED_FUNDING = 7020547944372000
      const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING / 10
      const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING - EXPECTED_FUNDING_FEE // maker funding

      beforeEach(async () => {
        await market.connect(user).openMake(POSITION)
        await market.connect(userB).openTake(POSITION.div(2))

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await market.connect(user).settle()
        await market.connect(user).settleAccount(user.address)
        await market.connect(user).settleAccount(userB.address)
      })

      it('same price same rate settle', async () => {
        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE / 10,
          taker: (-1 * EXPECTED_FUNDING) / 5,
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('same price same timestamp settle', async () => {
        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, -1 * (EXPECTED_FUNDING - EXPECTED_FUNDING_FEE))
          .returns()

        const oracleVersionSameTimestamp = {
          price: PRICE,
          timestamp: TIMESTAMP + 3600,
          version: 3,
        }
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionSameTimestamp)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionSameTimestamp)
        await incentivizer.mock.sync.withArgs(oracleVersionSameTimestamp).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionSameTimestamp)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: 0,
          taker: 0,
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: 0,
          taker: 0,
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('lower price same rate settle', async () => {
        const EXPECTED_POSITION = utils.parseEther('2').mul(5) // maker pnl

        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
          .returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
          .returns()

        const oracleVersionLowerPrice = {
          price: utils.parseEther('121'),
          timestamp: TIMESTAMP + 7200,
          version: 3,
        }
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionLowerPrice).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionLowerPrice)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
          taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('605'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('605'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('higher price same rate settle', async () => {
        const EXPECTED_POSITION = utils.parseEther('-2').mul(5) // maker pnl

        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
          .returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
          .returns()

        const oracleVersionHigherPrice = {
          price: utils.parseEther('125'),
          timestamp: TIMESTAMP + 7200,
          version: 3,
        }
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
          taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('625'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('625'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('same price negative rate settle', async () => {
        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, -1 * EXPECTED_FUNDING).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, EXPECTED_FUNDING_WITH_FEE).returns()

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await market.updateUtilizationCurve({
          minRate: utils.parseEther('0.10').mul(-1),
          maxRate: utils.parseEther('0.10').mul(-1),
          targetRate: utils.parseEther('0.10').mul(-1),
          targetUtilization: utils.parseEther('1'),
        })

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: (-1 * EXPECTED_FUNDING) / 10,
          taker: EXPECTED_FUNDING_WITH_FEE / 5,
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      context('socialized', async () => {
        it('with socialization to zero', async () => {
          await market.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
          expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await market.isClosed(userB.address)).to.equal(false)
          expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
          expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(4)
        })

        it('with partial socialization', async () => {
          await market.connect(userC).openMake(POSITION.div(4))
          await market.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userC.address, EXPECTED_FUNDING_WITH_FEE / 2).returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, BigNumber.from(EXPECTED_FUNDING).mul(3).div(2).mul(-1))
            .returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5,
            taker: -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('0.5').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
          expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await market.isClosed(userB.address)).to.equal(false)
          expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
          expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(4)

          await expect(market.connect(userC).settleAccount(userC.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userC.address, 3, 4)

          expect(await market.isClosed(userC.address)).to.equal(false)
          expect(await market['maintenance(address)'](userC.address)).to.equal(utils.parseEther('153.75'))
          expect(await market.maintenanceNext(userC.address)).to.equal(utils.parseEther('153.75'))
          expectPositionEq(await market.position(userC.address), { maker: POSITION.div(4), taker: 0 })
          expectPrePositionEq(await market['pre(address)'](userC.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userC.address)).to.equal(4)
        })

        it('with socialization to zero (price change)', async () => {
          await market.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          const oracleVersionHigherPrice = {
            price: utils.parseEther('125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
          expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await market.isClosed(userB.address)).to.equal(false)
          expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
          expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(4)
        })

        it('with partial socialization (price change)', async () => {
          const EXPECTED_POSITION = utils.parseEther('-2').mul(5).div(2) // maker pnl

          await market.connect(userC).openMake(POSITION.div(4))
          await market.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount
            .withArgs(userC.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE / 2))
            .returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, EXPECTED_POSITION.add(BigNumber.from(EXPECTED_FUNDING).mul(3).div(2)).mul(-1))
            .returns()

          const oracleVersionHigherPrice = {
            price: utils.parseEther('125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          const MAKER_FUNDING = EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5
          const TAKER_FUNDING = -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10)
          const MAKER_POSITION = EXPECTED_POSITION.mul(2).div(5)
          const TAKER_POSITION = EXPECTED_POSITION.div(-5)
          expectPositionEq(await market.valueAtVersion(4), {
            maker: MAKER_POSITION.add(MAKER_FUNDING),
            taker: TAKER_POSITION.add(TAKER_FUNDING),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('0.5').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
          expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await market.isClosed(userB.address)).to.equal(false)
          expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
          expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(4)

          await expect(market.connect(userC).settleAccount(userC.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userC.address, 3, 4)

          expect(await market.isClosed(userC.address)).to.equal(false)
          expect(await market['maintenance(address)'](userC.address)).to.equal(utils.parseEther('156.25'))
          expect(await market.maintenanceNext(userC.address)).to.equal(utils.parseEther('156.25'))
          expectPositionEq(await market.position(userC.address), { maker: POSITION.div(4), taker: 0 })
          expectPrePositionEq(await market['pre(address)'](userC.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userC.address)).to.equal(4)
        })
      })

      context('closed market', async () => {
        it('zeroes PnL and fees (price change)', async () => {
          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(owner).updateClosed(true))
            .to.emit(market, 'ClosedUpdated')
            .withArgs(true, 3)
            .to.emit(market, 'Settle')
            .withArgs(3, 3)
          expect(await market.closed()).to.be.true

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)
          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 3, 3)

          const oracleVersionHigherPrice_0 = {
            price: utils.parseEther('125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          const oracleVersionHigherPrice_1 = {
            price: utils.parseEther('128'),
            timestamp: TIMESTAMP + 10800,
            version: 5,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_0)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice_0)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_0).returns()

          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_1)
          await oracle.mock.atVersion.withArgs(5).returns(oracleVersionHigherPrice_1)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_1).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice_1)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(5, 5)

          expect(await market['latestVersion()']()).to.equal(5)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(5), { maker: POSITION, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await market.valueAtVersion(5), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(5), {
            maker: utils.parseEther('0.1').mul(7200),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 5, 5)

          expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(5)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 5, 5)

          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(5)
        })
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(market.connect(user).settle()).to.be.revertedWith('PausedError()')
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(market.connect(user).settleAccount(user.address)).to.be.revertedWith('PausedError()')
      })
    })
  })

  describe('negative price market', async () => {
    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('-123')

    const ORACLE_VERSION_0 = {
      price: 0,
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    const ORACLE_VERSION_2 = {
      price: PRICE,
      timestamp: TIMESTAMP + 3600,
      version: ORACLE_VERSION + 1,
    }

    const ORACLE_VERSION_3 = {
      price: PRICE,
      timestamp: TIMESTAMP + 7200,
      version: ORACLE_VERSION + 2,
    }

    const ORACLE_VERSION_4 = {
      price: PRICE,
      timestamp: TIMESTAMP + 10800,
      version: ORACLE_VERSION + 3,
    }

    beforeEach(async () => {
      await collateral.mock.settleMarket.withArgs(0).returns()
      await collateral.mock.settleAccount.withArgs(user.address, 0).returns()
      await collateral.mock.settleAccount.withArgs(userB.address, 0).returns()
      await collateral.mock.settleAccount.withArgs(userC.address, 0).returns()
      await collateral.mock.liquidatableNext.withArgs(user.address, market.address).returns(false)
      await collateral.mock.liquidatableNext.withArgs(userB.address, market.address).returns(false)
      await collateral.mock.liquidatableNext.withArgs(userC.address, market.address).returns(false)

      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(1).returns(ORACLE_VERSION_1)

      await factory.mock.minFundingFee.withArgs().returns(FUNDING_FEE)

      await incentivizer.mock.sync.withArgs(ORACLE_VERSION_1).returns()

      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()
      await incentivizer.mock.syncAccount.returns()

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
    })

    context('#openMake', async () => {
      it('opens the position', async () => {
        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens the position and settles', async () => {
        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 2)

        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (same version)', async () => {
        await market.connect(user).openMake(POSITION)

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens a second position and settles (same version)', async () => {
        await market.connect(user).openMake(POSITION)

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 2)

        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (next version)', async () => {
        await market.connect(user).openMake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: POSITION, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position and settles (next version)', async () => {
        await market.connect(user).openMake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 2, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: POSITION.mul(2), taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later', async () => {
        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later with fee', async () => {
        await market.updateMakerFee(utils.parseEther('0.01'))

        const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
        await collateral.mock.settleMarket.withArgs(MAKER_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position with settle after liquidation', async () => {
        await market.connect(user).openMake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await market.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')

        // Advance version
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(market.connect(user).openMake(POSITION))
          .to.emit(market, 'MakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if oracle not bootstrapped', async () => {
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_0)
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_0)

        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketOracleBootstrappingError()')
      })

      it('reverts if can liquidate', async () => {
        await collateral.mock.liquidatableNext.withArgs(user.address, market.address).returns(true)

        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketInsufficientCollateralError()')
      })

      it('reverts if double sided position', async () => {
        await market.connect(userB).openMake(POSITION.mul(2))
        await market.connect(user).openTake(POSITION)

        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketDoubleSidedError()')
      })

      it('reverts if in liquidation', async () => {
        await market.connect(collateralSigner).closeAll(user.address)
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('PausedError()')
      })

      it('reverts if over maker limit', async () => {
        await market.updateMakerLimit(POSITION.div(2))
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketMakerOverLimitError()')
      })

      it('reverts if closed', async () => {
        await market.updateClosed(true)
        await expect(market.connect(user).openMake(POSITION)).to.be.revertedWith('MarketClosedError()')
      })
    })

    context('#closeMake', async () => {
      beforeEach(async () => {
        await market.connect(user).openMake(POSITION)
      })

      it('closes the position partially', async () => {
        await expect(market.connect(user).closeMake(POSITION.div(2)))
          .to.emit(market, 'MakeClosed')
          .withArgs(user.address, 1, POSITION.div(2))

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.div(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.div(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('closes the position', async () => {
        await expect(market.connect(user).closeMake(POSITION))
          .to.emit(market, 'MakeClosed')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.be.true
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(0)
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      context('settles first', async () => {
        beforeEach(async () => {
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await market.connect(user).settle()
          await market.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expect(await market['latestVersion()']()).to.equal(2)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes the position and settles', async () => {
          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (same version)', async () => {
          await market.connect(user).closeMake(POSITION.div(2))

          await expect(market.connect(user).closeMake(POSITION.div(2)))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expect(await market['latestVersion()']()).to.equal(2)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes a second position and settles (same version)', async () => {
          await market.connect(user).closeMake(POSITION.div(2))

          await expect(market.connect(user).closeMake(POSITION.div(2)))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (next version)', async () => {
          await market.connect(user).closeMake(POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).closeMake(POSITION.div(2)))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: POSITION.div(2), taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION.div(2), taker: 0 },
          })
          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.div(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: POSITION.div(2), taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(3), { maker: utils.parseEther('360'), taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position and settles (next version)', async () => {
          await market.connect(user).closeMake(POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).closeMake(POSITION.div(2)))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(4), { maker: utils.parseEther('1080'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 4, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(4), { maker: utils.parseEther('360'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await market.updateMakerFee(utils.parseEther('0.01'))

          const MAKER_FEE = utils.parseEther('12.3') // position * maker fee * price
          await collateral.mock.settleMarket.withArgs(MAKER_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, MAKER_FEE.mul(-1)).returns()

          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: 0 })
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(4), { maker: utils.parseEther('360'), taker: 0 })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position if taker > maker and market is closed', async () => {
          await market.connect(userB).openTake(POSITION)
          await market.updateClosed(true)

          await expect(market.connect(user).closeMake(POSITION))
            .to.emit(market, 'MakeClosed')
            .withArgs(user.address, 2, POSITION)
        })

        it('reverts if taker > maker', async () => {
          await market.connect(userB).openTake(POSITION)

          await expect(market.connect(user).closeMake(POSITION)).to.be.revertedWith(
            `MarketInsufficientLiquidityError(0)`,
          )
        })

        it('reverts if underflow', async () => {
          await expect(market.connect(user).closeMake(POSITION.mul(2))).to.be.revertedWith('MarketOverClosedError()')
        })

        it('reverts if in liquidation', async () => {
          await market.connect(collateralSigner).closeAll(user.address)
          await expect(market.connect(user).closeMake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
        })

        it('reverts if paused', async () => {
          await factory.mock.paused.withArgs().returns(true)
          await expect(market.connect(user).closeMake(POSITION)).to.be.revertedWith('PausedError()')
        })
      })
    })

    context('#openTake', async () => {
      beforeEach(async () => {
        await market.connect(userB).openMake(POSITION.mul(2))
      })

      it('opens the position', async () => {
        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens the position and settles', async () => {
        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 2)

        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (same version)', async () => {
        await market.connect(user).openTake(POSITION)

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION.mul(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION.mul(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('opens a second position and settles (same version)', async () => {
        await market.connect(user).openTake(POSITION)

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 2)

        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION.mul(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 2)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION.mul(2) })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position (next version)', async () => {
        await market.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(2)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: POSITION },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(2)
      })

      it('opens a second position and settles (next version)', async () => {
        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

        await market.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 2, POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.mul(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('1230'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('1230'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION.mul(2) })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later', async () => {
        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position and settles later with fee', async () => {
        await market.updateTakerFee(utils.parseEther('0.01'))

        const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

        // rate * elapsed * utilization * maker * price
        // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
        const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
        const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
        const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

        await collateral.mock.settleMarket.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
        await collateral.mock.settleAccount.withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1)).returns()

        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 1, POSITION)

        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(2, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE.div(20),
          taker: EXPECTED_FUNDING.div(10).mul(-1),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('180'),
          taker: utils.parseEther('360'),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 2, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)
      })

      it('opens the position with settle after liquidation', async () => {
        await market.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        // Liquidate the user
        await market.connect(collateralSigner).closeAll(user.address)
        // User can't open a new position yet
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')

        // Advance version
        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        // Liquidation flag is cleared during settle flow
        await expect(market.connect(user).openTake(POSITION))
          .to.emit(market, 'TakeOpened')
          .withArgs(user.address, 3, POSITION)
      })

      it('reverts if can liquidate', async () => {
        await collateral.mock.liquidatableNext.withArgs(user.address, market.address).returns(true)

        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketInsufficientCollateralError()')
      })

      it('reverts if taker > maker', async () => {
        const socialization = utils.parseEther('0.5')
        await expect(market.connect(user).openTake(POSITION.mul(4))).to.be.revertedWith(
          `MarketInsufficientLiquidityError(${socialization})`,
        )
      })

      it('reverts if double sided position', async () => {
        await market.connect(user).openMake(POSITION)
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketDoubleSidedError()')
      })

      it('reverts if in liquidation', async () => {
        await market.connect(collateralSigner).closeAll(user.address)
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('PausedError()')
      })

      it('reverts if closed', async () => {
        await market.updateClosed(true)
        await expect(market.connect(user).openTake(POSITION)).to.be.revertedWith('MarketClosedError()')
      })
    })

    context('#closeTake', async () => {
      beforeEach(async () => {
        await market.connect(userB).openMake(POSITION.mul(2))
        await market.connect(user).openTake(POSITION)
      })

      it('closes the position partially', async () => {
        await expect(market.connect(user).closeTake(POSITION.div(2)))
          .to.emit(market, 'TakeClosed')
          .withArgs(user.address, 1, POSITION.div(2))

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: POSITION.div(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: POSITION.div(2) },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      it('closes the position', async () => {
        await expect(market.connect(user).closeTake(POSITION))
          .to.emit(market, 'TakeClosed')
          .withArgs(user.address, 1, POSITION)

        expect(await market.isClosed(user.address)).to.equal(true)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
        expect(await market.maintenanceNext(user.address)).to.equal(0)
        expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 1,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion()']()).to.equal(ORACLE_VERSION)
        expectPositionEq(await market.positionAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 1,
          openPosition: { maker: POSITION.mul(2), taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expectPositionEq(await market.shareAtVersion(ORACLE_VERSION), { maker: 0, taker: 0 })
        expect(await market['latestVersion(address)'](user.address)).to.equal(ORACLE_VERSION)
      })

      context('settles first', async () => {
        beforeEach(async () => {
          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
          await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

          await market.connect(user).settle()
          await market.connect(user).settleAccount(user.address)
        })

        it('closes the position', async () => {
          await expect(market.connect(user).closeTake(POSITION))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expect(await market['latestVersion()']()).to.equal(2)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes the position and settles', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await expect(market.connect(user).closeTake(POSITION))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (same version)', async () => {
          await market.connect(user).closeTake(POSITION.div(2))

          await expect(market.connect(user).closeTake(POSITION.div(2)))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expect(await market['latestVersion()']()).to.equal(2)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 2,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION },
          })
          expectPositionEq(await market.valueAtVersion(2), { maker: 0, taker: 0 })
          expectPositionEq(await market.shareAtVersion(2), { maker: 0, taker: 0 })
          expect(await market['latestVersion(address)'](user.address)).to.equal(2)
        })

        it('closes a second position and settles (same version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await market.connect(user).closeTake(POSITION.div(2))

          await expect(market.connect(user).closeTake(POSITION.div(2)))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position (next version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await market.connect(user).closeTake(POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).closeTake(POSITION.div(2)))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          expect(await market.isClosed(user.address)).to.equal(false)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('307.5'))
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION.div(2) },
          })
          expect(await market['latestVersion()']()).to.equal(3)
          expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 3,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: POSITION.div(2) },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('180'),
            taker: utils.parseEther('360'),
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(3)
        })

        it('closes a second position and settles (next version)', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.25 * 20 * 123 = 7020547944372000
          const EXPECTED_FUNDING_1 = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_2 = ethers.BigNumber.from('7020547944372000')
          const EXPECTED_FUNDING_FEE_1 = EXPECTED_FUNDING_1.div(10)
          const EXPECTED_FUNDING_FEE_2 = EXPECTED_FUNDING_2.div(10)
          const EXPECTED_FUNDING_WITH_FEE_1 = EXPECTED_FUNDING_1.sub(EXPECTED_FUNDING_FEE_1) // maker funding
          const EXPECTED_FUNDING_WITH_FEE_2 = EXPECTED_FUNDING_2.sub(EXPECTED_FUNDING_FEE_2) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE_1).returns()
          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE_2).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_1.mul(-1)).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_2.mul(-1)).returns()

          await market.connect(user).closeTake(POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).closeTake(POSITION.div(2)))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 3, POSITION.div(2))

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE_1.div(20),
            taker: EXPECTED_FUNDING_1.div(10).mul(-1),
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE_1.add(EXPECTED_FUNDING_WITH_FEE_2).div(20),
            taker: EXPECTED_FUNDING_1.div(10).add(EXPECTED_FUNDING_2.div(5)).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('1080'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 4, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING.mul(-1)).returns()

          await expect(market.connect(user).closeTake(POSITION))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('360'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('closes the position and settles later', async () => {
          await market.updateTakerFee(utils.parseEther('0.01'))

          const TAKER_FEE = utils.parseEther('12.3') // position * taker fee * price

          // rate * elapsed * utilization * maker * price
          // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 20 * 123 = 14041095890000000
          const EXPECTED_FUNDING = ethers.BigNumber.from('14041095888744000')
          const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING.div(10)
          const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING.sub(EXPECTED_FUNDING_FEE) // maker funding

          await collateral.mock.settleMarket.withArgs(TAKER_FEE.add(EXPECTED_FUNDING_FEE)).returns()
          await collateral.mock.settleAccount.withArgs(user.address, TAKER_FEE.add(EXPECTED_FUNDING).mul(-1)).returns()

          await expect(market.connect(user).closeTake(POSITION))
            .to.emit(market, 'TakeClosed')
            .withArgs(user.address, 2, POSITION)

          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.mul(2), taker: 0 })
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.mul(2), taker: 0 })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE.div(20),
            taker: EXPECTED_FUNDING.div(10).mul(-1),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('360'),
            taker: utils.parseEther('360'),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(0)
          expect(await market.maintenanceNext(user.address)).to.equal(0)
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)
        })

        it('reverts if underflow', async () => {
          await expect(market.connect(user).closeTake(POSITION.mul(2))).to.be.revertedWith('MarketOverClosedError()')
        })

        it('reverts if in liquidation', async () => {
          await market.connect(collateralSigner).closeAll(user.address)
          await expect(market.connect(user).closeTake(POSITION)).to.be.revertedWith('MarketInLiquidationError()')
        })

        it('reverts if paused', async () => {
          await factory.mock.paused.withArgs().returns(true)
          await expect(market.connect(user).closeTake(POSITION)).to.be.revertedWith('PausedError()')
        })
      })
    })

    describe('#closeAll', async () => {
      it('closes maker side', async () => {
        await market.connect(user).openMake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await market.connect(user).settle()
        await market.connect(user).settleAccount(user.address)

        await market.connect(user).openMake(POSITION)

        await market.connect(collateralSigner).closeAll(user.address)

        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: POSITION, taker: 0 },
        })

        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: POSITION, taker: 0 },
        })
        expect(await market.isLiquidating(user.address)).to.equal(true)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
      })

      it('closes taker side', async () => {
        await market.connect(userB).openMake(POSITION.mul(2))
        await market.connect(user).openTake(POSITION)

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await market.connect(user).settle()
        await market.connect(user).settleAccount(user.address)

        await market.connect(user).openTake(POSITION)

        await market.connect(collateralSigner).closeAll(user.address)

        expectPositionEq(await market.positionAtVersion(2), { maker: POSITION.mul(2), taker: POSITION })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: POSITION },
        })

        expectPositionEq(await market.position(user.address), { maker: 0, taker: POSITION })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 2,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: POSITION },
        })
        expect(await market.isLiquidating(user.address)).to.equal(true)
        expect(await market['maintenance(address)'](user.address)).to.equal(0)
      })

      it('reverts if already initialized', async () => {
        await expect(market.connect(user).closeAll(user.address)).to.be.revertedWith(`NotCollateralError()`)
      })
    })

    context('#settle / #settleAccount', async () => {
      // rate * elapsed * utilization * maker * price
      // ( 0.1 * 10^18 / 365 / 24 / 60 / 60 ) * 3600 * 0.5 * 10 * 123 = 7020547945205480
      const EXPECTED_FUNDING = 7020547944372000
      const EXPECTED_FUNDING_FEE = EXPECTED_FUNDING / 10
      const EXPECTED_FUNDING_WITH_FEE = EXPECTED_FUNDING - EXPECTED_FUNDING_FEE // maker funding

      beforeEach(async () => {
        await market.connect(user).openMake(POSITION)
        await market.connect(userB).openTake(POSITION.div(2))

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_2)
        await oracle.mock.atVersion.withArgs(2).returns(ORACLE_VERSION_2)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_2).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_2)

        await market.connect(user).settle()
        await market.connect(user).settleAccount(user.address)
        await market.connect(user).settleAccount(userB.address)
      })

      it('same price same rate settle', async () => {
        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_FUNDING_WITH_FEE / 10,
          taker: (-1 * EXPECTED_FUNDING) / 5,
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('same price same timestamp settle', async () => {
        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

        const oracleVersionSameTimestamp = {
          price: PRICE,
          timestamp: TIMESTAMP + 3600,
          version: 3,
        }
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionSameTimestamp)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionSameTimestamp)
        await incentivizer.mock.sync.withArgs(oracleVersionSameTimestamp).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionSameTimestamp)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: 0,
          taker: 0,
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: 0,
          taker: 0,
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('lower price same rate settle', async () => {
        const EXPECTED_POSITION = utils.parseEther('2').mul(5) // maker pnl

        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
          .returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
          .returns()

        const oracleVersionLowerPrice = {
          price: utils.parseEther('-125'),
          timestamp: TIMESTAMP + 7200,
          version: 3,
        }
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionLowerPrice)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionLowerPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionLowerPrice).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionLowerPrice)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
          taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('625'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('625'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('312.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('312.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('higher price same rate settle', async () => {
        const EXPECTED_POSITION = utils.parseEther('-2').mul(5) // maker pnl

        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount
          .withArgs(user.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE))
          .returns()
        await collateral.mock.settleAccount
          .withArgs(userB.address, EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1))
          .returns()

        const oracleVersionHigherPrice = {
          price: utils.parseEther('-121'),
          timestamp: TIMESTAMP + 7200,
          version: 3,
        }
        await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
        await oracle.mock.atVersion.withArgs(3).returns(oracleVersionHigherPrice)
        await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
        await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE).div(10),
          taker: EXPECTED_POSITION.add(EXPECTED_FUNDING).mul(-1).div(5),
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('605'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('605'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      it('same price negative rate settle', async () => {
        await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
        await collateral.mock.settleAccount.withArgs(user.address, -1 * EXPECTED_FUNDING).returns()
        await collateral.mock.settleAccount.withArgs(userB.address, EXPECTED_FUNDING_WITH_FEE).returns()

        await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
        await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
        await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
        await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

        await market.updateUtilizationCurve({
          minRate: utils.parseEther('0.10').mul(-1),
          maxRate: utils.parseEther('0.10').mul(-1),
          targetRate: utils.parseEther('0.10').mul(-1),
          targetUtilization: utils.parseEther('1'),
        })

        await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

        expect(await market['latestVersion()']()).to.equal(3)
        expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre()'](), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expectPositionEq(await market.valueAtVersion(3), {
          maker: (-1 * EXPECTED_FUNDING) / 10,
          taker: EXPECTED_FUNDING_WITH_FEE / 5,
        })
        expectPositionEq(await market.shareAtVersion(3), {
          maker: utils.parseEther('0.1').mul(3600),
          taker: utils.parseEther('0.2').mul(3600),
        })

        await expect(market.connect(user).settleAccount(user.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(user.address, 3, 3)

        expect(await market.isClosed(user.address)).to.equal(false)
        expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('615'))
        expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('615'))
        expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
        expectPrePositionEq(await market['pre(address)'](user.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](user.address)).to.equal(3)

        await expect(market.connect(userB).settleAccount(userB.address))
          .to.emit(market, 'AccountSettle')
          .withArgs(userB.address, 3, 3)

        expect(await market.isClosed(userB.address)).to.equal(false)
        expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
        expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
        expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
        expectPrePositionEq(await market['pre(address)'](userB.address), {
          oracleVersion: 0,
          openPosition: { maker: 0, taker: 0 },
          closePosition: { maker: 0, taker: 0 },
        })
        expect(await market['latestVersion(address)'](userB.address)).to.equal(3)
      })

      context('socialized', async () => {
        it('with socialization to zero', async () => {
          await market.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
          expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await market.isClosed(userB.address)).to.equal(false)
          expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
          expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(4)
        })

        it('with partial socialization', async () => {
          await market.connect(userC).openMake(POSITION.div(4))
          await market.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userC.address, EXPECTED_FUNDING_WITH_FEE / 2).returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, BigNumber.from(EXPECTED_FUNDING).mul(3).div(2).mul(-1))
            .returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_4)
          await oracle.mock.atVersion.withArgs(4).returns(ORACLE_VERSION_4)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_4).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_4)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5,
            taker: -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('0.5').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
          expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await market.isClosed(userB.address)).to.equal(false)
          expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('307.5'))
          expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('307.5'))
          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(4)

          await expect(market.connect(userC).settleAccount(userC.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userC.address, 3, 4)

          expect(await market.isClosed(userC.address)).to.equal(false)
          expect(await market['maintenance(address)'](userC.address)).to.equal(utils.parseEther('153.75'))
          expect(await market.maintenanceNext(userC.address)).to.equal(utils.parseEther('153.75'))
          expectPositionEq(await market.position(userC.address), { maker: POSITION.div(4), taker: 0 })
          expectPrePositionEq(await market['pre(address)'](userC.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userC.address)).to.equal(4)
        })

        it('with socialization to zero (price change)', async () => {
          await market.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          const oracleVersionHigherPrice = {
            price: utils.parseEther('-121'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: 0, taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(4), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await market.valueAtVersion(4), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
          expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await market.isClosed(userB.address)).to.equal(false)
          expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
          expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(4)
        })

        it('with partial socialization (price change)', async () => {
          const EXPECTED_POSITION = utils.parseEther('-2').mul(5).div(2) // maker pnl

          await market.connect(userC).openMake(POSITION.div(4))
          await market.connect(collateralSigner).closeAll(user.address)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(3, 3)

          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE / 2).returns()

          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount
            .withArgs(userC.address, EXPECTED_POSITION.add(EXPECTED_FUNDING_WITH_FEE / 2))
            .returns()
          await collateral.mock.settleAccount
            .withArgs(userB.address, EXPECTED_POSITION.add(BigNumber.from(EXPECTED_FUNDING).mul(3).div(2)).mul(-1))
            .returns()

          const oracleVersionHigherPrice = {
            price: utils.parseEther('-121'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(4, 4)

          expect(await market['latestVersion()']()).to.equal(4)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(4), { maker: POSITION.div(4), taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          const MAKER_FUNDING = EXPECTED_FUNDING_WITH_FEE / 10 + EXPECTED_FUNDING_WITH_FEE / 5
          const TAKER_FUNDING = -1 * (EXPECTED_FUNDING / 5 + EXPECTED_FUNDING / 10)
          const MAKER_POSITION = EXPECTED_POSITION.mul(2).div(5)
          const TAKER_POSITION = EXPECTED_POSITION.div(-5)
          expectPositionEq(await market.valueAtVersion(4), {
            maker: MAKER_POSITION.add(MAKER_FUNDING),
            taker: TAKER_POSITION.add(TAKER_FUNDING),
          })
          expectPositionEq(await market.shareAtVersion(4), {
            maker: utils.parseEther('0.5').mul(3600),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 4)

          expect(await market.isClosed(user.address)).to.equal(true)
          expect(await market['maintenance(address)'](user.address)).to.equal(utils.parseEther('0'))
          expect(await market.maintenanceNext(user.address)).to.equal(utils.parseEther('0'))
          expectPositionEq(await market.position(user.address), { maker: 0, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(4)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 4, 4)

          expect(await market.isClosed(userB.address)).to.equal(false)
          expect(await market['maintenance(address)'](userB.address)).to.equal(utils.parseEther('302.5'))
          expect(await market.maintenanceNext(userB.address)).to.equal(utils.parseEther('302.5'))
          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(4)

          await expect(market.connect(userC).settleAccount(userC.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userC.address, 3, 4)

          expect(await market.isClosed(userC.address)).to.equal(false)
          expect(await market['maintenance(address)'](userC.address)).to.equal(utils.parseEther('151.25'))
          expect(await market.maintenanceNext(userC.address)).to.equal(utils.parseEther('151.25'))
          expectPositionEq(await market.position(userC.address), { maker: POSITION.div(4), taker: 0 })
          expectPrePositionEq(await market['pre(address)'](userC.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userC.address)).to.equal(4)
        })
      })

      context('closed market', async () => {
        it('zeroes PnL and fees (price change)', async () => {
          await collateral.mock.settleMarket.withArgs(EXPECTED_FUNDING_FEE).returns()
          await collateral.mock.settleAccount.withArgs(user.address, EXPECTED_FUNDING_WITH_FEE).returns()
          await collateral.mock.settleAccount.withArgs(userB.address, -1 * EXPECTED_FUNDING).returns()

          await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_3)
          await oracle.mock.atVersion.withArgs(3).returns(ORACLE_VERSION_3)
          await incentivizer.mock.sync.withArgs(ORACLE_VERSION_3).returns()
          await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_3)

          await expect(market.connect(owner).updateClosed(true))
            .to.emit(market, 'ClosedUpdated')
            .withArgs(true, 3)
            .to.emit(market, 'Settle')
            .withArgs(3, 3)

          expect(await market.closed()).to.equal(true)
          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 3, 3)
          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 3, 3)

          const oracleVersionHigherPrice_0 = {
            price: utils.parseEther('-125'),
            timestamp: TIMESTAMP + 10800,
            version: 4,
          }
          const oracleVersionHigherPrice_1 = {
            price: utils.parseEther('-128'),
            timestamp: TIMESTAMP + 10800,
            version: 5,
          }
          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_0)
          await oracle.mock.atVersion.withArgs(4).returns(oracleVersionHigherPrice_0)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_0).returns()

          await oracle.mock.currentVersion.withArgs().returns(oracleVersionHigherPrice_1)
          await oracle.mock.atVersion.withArgs(5).returns(oracleVersionHigherPrice_1)
          await incentivizer.mock.sync.withArgs(oracleVersionHigherPrice_1).returns()
          await oracle.mock.sync.withArgs().returns(oracleVersionHigherPrice_1)

          await expect(market.connect(user).settle()).to.emit(market, 'Settle').withArgs(5, 5)

          expect(await market['latestVersion()']()).to.equal(5)
          expectPositionEq(await market.positionAtVersion(3), { maker: POSITION, taker: POSITION.div(2) })
          expectPositionEq(await market.positionAtVersion(5), { maker: POSITION, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre()'](), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expectPositionEq(await market.valueAtVersion(3), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(3), {
            maker: utils.parseEther('0.1').mul(3600),
            taker: utils.parseEther('0.2').mul(3600),
          })
          expectPositionEq(await market.valueAtVersion(5), {
            maker: EXPECTED_FUNDING_WITH_FEE / 10,
            taker: (-1 * EXPECTED_FUNDING) / 5,
          })
          expectPositionEq(await market.shareAtVersion(5), {
            maker: utils.parseEther('0.1').mul(7200),
            taker: utils.parseEther('0.2').mul(7200),
          })

          await expect(market.connect(user).settleAccount(user.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(user.address, 5, 5)

          expectPositionEq(await market.position(user.address), { maker: POSITION, taker: 0 })
          expectPrePositionEq(await market['pre(address)'](user.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](user.address)).to.equal(5)

          await expect(market.connect(userB).settleAccount(userB.address))
            .to.emit(market, 'AccountSettle')
            .withArgs(userB.address, 5, 5)

          expectPositionEq(await market.position(userB.address), { maker: 0, taker: POSITION.div(2) })
          expectPrePositionEq(await market['pre(address)'](userB.address), {
            oracleVersion: 0,
            openPosition: { maker: 0, taker: 0 },
            closePosition: { maker: 0, taker: 0 },
          })
          expect(await market['latestVersion(address)'](userB.address)).to.equal(5)
        })
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(market.connect(user).settle()).to.be.revertedWith('PausedError()')
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(market.connect(user).settleAccount(user.address)).to.be.revertedWith('PausedError()')
      })
    })
  })

  describe('#rate', async () => {
    const SECONDS_IN_YEAR = 60 * 60 * 24 * 365
    beforeEach(async () => {
      await market.updateUtilizationCurve({
        minRate: 0,
        maxRate: utils.parseEther('5.00'),
        targetRate: utils.parseEther('0.80'),
        targetUtilization: utils.parseEther('0.80'),
      })
    })

    it('handles zero maker', async () => {
      expect(await market.rate({ maker: 0, taker: 0 })).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
      expect(await market.rate({ maker: 0, taker: 100 })).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
    })

    it('returns the proper rate from utilization', async () => {
      expect(await market.rate({ maker: 100, taker: 0 })).to.equal(utils.parseEther('0.00').div(SECONDS_IN_YEAR))
      expect(await market.rate({ maker: 100, taker: 25 })).to.equal(utils.parseEther('0.25').div(SECONDS_IN_YEAR))
      expect(await market.rate({ maker: 100, taker: 50 })).to.equal(utils.parseEther('0.50').div(SECONDS_IN_YEAR))
      expect(await market.rate({ maker: 100, taker: 75 })).to.equal(utils.parseEther('0.75').div(SECONDS_IN_YEAR))
      expect(await market.rate({ maker: 100, taker: 90 })).to.equal(utils.parseEther('2.90').div(SECONDS_IN_YEAR))
      expect(await market.rate({ maker: 100, taker: 100 })).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
      expect(await market.rate({ maker: 100, taker: 125 })).to.equal(utils.parseEther('5.00').div(SECONDS_IN_YEAR))
    })
  })

  describe('contract long payoff definition', async () => {
    let contractPayoffDefinition: SmockContract<TestnetContractPayoffProvider>
    let otherMarket: Market

    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: utils.parseEther('2'),
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    beforeEach(async () => {
      const payoffDefinitionFactory = await smock.mock<TestnetContractPayoffProvider__factory>(
        'TestnetContractPayoffProvider',
      )
      contractPayoffDefinition = await payoffDefinitionFactory.deploy()

      otherMarket = await new Market__factory(owner).deploy()
      MARKET_INFO.payoffDefinition = createPayoffDefinition({ contractAddress: contractPayoffDefinition.address })
      await otherMarket.connect(factorySigner).initialize(MARKET_INFO)

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
    })

    describe('#currentVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherMarket.callStatic.currentVersion()
        expect(syncResult.price).to.equal(utils.parseEther('15129'))
        expect(syncResult.timestamp).to.equal(TIMESTAMP)
        expect(syncResult.version).to.equal(ORACLE_VERSION)
        expect(contractPayoffDefinition.payoff).to.have.callCount(1)
      })
    })

    describe('#atVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherMarket.callStatic.atVersion(0)
        expect(syncResult.price).to.equal(utils.parseEther('4'))
        expect(syncResult.timestamp).to.equal(0)
        expect(syncResult.version).to.equal(0)
        expect(contractPayoffDefinition.payoff).to.have.callCount(1)
      })
    })
  })

  describe('contract short payoff definition', async () => {
    let contractPayoffDefinition: SmockContract<TestnetContractPayoffProvider>
    let otherMarket: Market

    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: utils.parseEther('2'),
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    beforeEach(async () => {
      const payoffDefinitionFactory = await smock.mock<TestnetContractPayoffProvider__factory>(
        'TestnetContractPayoffProvider',
      )
      contractPayoffDefinition = await payoffDefinitionFactory.deploy()

      otherMarket = await new Market__factory(owner).deploy()
      MARKET_INFO.payoffDefinition = createPayoffDefinition({
        short: true,
        contractAddress: contractPayoffDefinition.address,
      })
      await otherMarket.connect(factorySigner).initialize(MARKET_INFO)

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
    })

    describe('#currentVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherMarket.callStatic.currentVersion()
        expect(syncResult.price).to.equal(utils.parseEther('-15129'))
        expect(syncResult.timestamp).to.equal(TIMESTAMP)
        expect(syncResult.version).to.equal(ORACLE_VERSION)
        expect(contractPayoffDefinition.payoff).to.have.callCount(1)
      })
    })

    describe('#atVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherMarket.callStatic.atVersion(0)
        expect(syncResult.price).to.equal(utils.parseEther('-4'))
        expect(syncResult.timestamp).to.equal(0)
        expect(syncResult.version).to.equal(0)
        expect(contractPayoffDefinition.payoff).to.have.callCount(1)
      })
    })
  })

  describe('passthrough long payoff definition', async () => {
    let otherMarket: Market

    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: utils.parseEther('2'),
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    beforeEach(async () => {
      otherMarket = await new Market__factory(owner).deploy()
      MARKET_INFO.payoffDefinition = createPayoffDefinition()
      await otherMarket.connect(factorySigner).initialize(MARKET_INFO)

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
    })

    describe('#currentVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherMarket.callStatic.currentVersion()
        expect(syncResult.price).to.equal(utils.parseEther('123'))
        expect(syncResult.timestamp).to.equal(TIMESTAMP)
        expect(syncResult.version).to.equal(ORACLE_VERSION)
      })
    })

    describe('#atVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherMarket.callStatic.atVersion(0)
        expect(syncResult.price).to.equal(utils.parseEther('2'))
        expect(syncResult.timestamp).to.equal(0)
        expect(syncResult.version).to.equal(0)
      })
    })
  })

  describe('passthrough short payoff definition', async () => {
    let otherMarket: Market

    const ORACLE_VERSION = 1
    const TIMESTAMP = 1636401093
    const PRICE = utils.parseEther('123')

    const ORACLE_VERSION_0 = {
      price: utils.parseEther('2'),
      timestamp: 0,
      version: 0,
    }

    const ORACLE_VERSION_1 = {
      price: PRICE,
      timestamp: TIMESTAMP,
      version: ORACLE_VERSION,
    }

    beforeEach(async () => {
      otherMarket = await new Market__factory(owner).deploy()
      MARKET_INFO.payoffDefinition = createPayoffDefinition({ short: true })
      await otherMarket.connect(factorySigner).initialize(MARKET_INFO)

      await oracle.mock.sync.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.currentVersion.withArgs().returns(ORACLE_VERSION_1)
      await oracle.mock.atVersion.withArgs(0).returns(ORACLE_VERSION_0)
    })

    describe('#currentVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherMarket.callStatic.currentVersion()
        expect(syncResult.price).to.equal(utils.parseEther('-123'))
        expect(syncResult.timestamp).to.equal(TIMESTAMP)
        expect(syncResult.version).to.equal(ORACLE_VERSION)
      })
    })

    describe('#atVersion', () => {
      it('calls to the provider', async () => {
        const syncResult = await otherMarket.callStatic.atVersion(0)
        expect(syncResult.price).to.equal(utils.parseEther('-2'))
        expect(syncResult.timestamp).to.equal(0)
        expect(syncResult.version).to.equal(0)
      })
    })
  })

  describe('#initialize', async () => {
    it('initialize with the correct variables set', async () => {
      expect(await collateral.factory()).to.equal(factory.address)
      expect(await collateral.token()).to.equal(token.address)
    })

    it('reverts if already initialized', async () => {
      await expect(collateral.initialize(factory.address)).to.be.revertedWith(
        'UInitializableAlreadyInitializedError(1)',
      )
    })

    it('reverts if factory is zero address', async () => {
      const collateralFresh = await new Collateral__factory(owner).deploy(token.address)
      await expect(collateralFresh.initialize(ethers.constants.AddressZero)).to.be.revertedWith('InvalidFactoryError()')
    })
  })

  describe('#depositTo', async () => {
    it('deposits to the user account', async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await expect(collateral.connect(owner).depositTo(user.address, market.address, 100))
        .to.emit(collateral, 'Deposit')
        .withArgs(user.address, market.address, 100)

      expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(100)
      expect(await collateral['collateral(address)'](market.address)).to.equal(100)
    })

    it('reverts if paused', async () => {
      await factory.mock.paused.withArgs().returns(true)
      await expect(collateral.connect(owner).depositTo(user.address, market.address, 100)).to.be.revertedWith(
        'PausedError()',
      )
    })

    it('reverts if zero address', async () => {
      await expect(
        collateral.connect(owner).depositTo(ethers.constants.AddressZero, market.address, 100),
      ).to.be.revertedWith(`CollateralZeroAddressError()`)
    })

    it('reverts if not market', async () => {
      await expect(collateral.connect(owner).depositTo(user.address, notMarket.address, 100)).to.be.revertedWith(
        `NotMarketError("${notMarket.address}")`,
      )
    })

    it('reverts if below limit', async () => {
      await factory.mock.minCollateral.withArgs().returns(100)
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 80).returns(true)

      await expect(collateral.connect(owner).depositTo(user.address, market.address, 80)).to.be.revertedWith(
        'CollateralUnderLimitError()',
      )
    })

    describe('multiple users per market', async () => {
      beforeEach(async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.connect(owner).depositTo(user.address, market.address, 100)
      })

      it('adds to both totals', async () => {
        await expect(collateral.connect(owner).depositTo(userB.address, market.address, 100))
          .to.emit(collateral, 'Deposit')
          .withArgs(userB.address, market.address, 100)

        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(100)
        expect(await collateral['collateral(address,address)'](userB.address, market.address)).to.equal(100)
        expect(await collateral['collateral(address)'](market.address)).to.equal(200)
      })
    })
  })

  describe('#withdrawTo', async () => {
    beforeEach(async () => {
      // Mock settle calls
      await market.mock.settleAccount.withArgs(user.address).returns()
      await market.mock.settleAccount.withArgs(userB.address).returns()

      // Mock maintenance calls
      await market.mock.maintenance.withArgs(user.address).returns(0)
      await market.mock.maintenanceNext.withArgs(user.address).returns(0)
      await market.mock.maintenance.withArgs(userB.address).returns(0)
      await market.mock.maintenanceNext.withArgs(userB.address).returns(0)

      //Pre-fill account
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.connect(owner).depositTo(user.address, market.address, 100)
    })

    it('withdraws from the user account', async () => {
      await token.mock.transfer.withArgs(owner.address, 80).returns(true)
      await expect(collateral.connect(user).withdrawTo(owner.address, market.address, 80))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, market.address, 80)

      expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(20)
      expect(await collateral['collateral(address)'](market.address)).to.equal(20)
    })

    it('withdraws all deposited if amount == MAX', async () => {
      await token.mock.transfer.withArgs(owner.address, 100).returns(true)
      await expect(collateral.connect(user).withdrawTo(owner.address, market.address, constants.MaxUint256))
        .to.emit(collateral, 'Withdrawal')
        .withArgs(user.address, market.address, 100)

      expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(0)
      expect(await collateral['collateral(address)'](market.address)).to.equal(0)
    })

    it('reverts if paused', async () => {
      await factory.mock.paused.withArgs().returns(true)
      await expect(collateral.connect(user).withdrawTo(user.address, market.address, 80)).to.be.revertedWith(
        'PausedError()',
      )
    })

    it('reverts if zero address', async () => {
      await expect(
        collateral.connect(user).withdrawTo(ethers.constants.AddressZero, market.address, 100),
      ).to.be.revertedWith(`CollateralZeroAddressError()`)
    })

    it('reverts if not market', async () => {
      await expect(collateral.connect(user).withdrawTo(user.address, notMarket.address, 100)).to.be.revertedWith(
        `NotMarketError("${notMarket.address}")`,
      )
    })

    it('reverts if below limit', async () => {
      await factory.mock.minCollateral.withArgs().returns(50)
      await token.mock.transfer.withArgs(user.address, 80).returns(true)

      await expect(collateral.connect(user).withdrawTo(user.address, market.address, 80)).to.be.revertedWith(
        'CollateralUnderLimitError()',
      )
    })

    it('reverts if liquidatable current', async () => {
      await market.mock.maintenance.withArgs(user.address).returns(50)
      await market.mock.maintenanceNext.withArgs(user.address).returns(100)

      await token.mock.transfer.withArgs(user.address, 80).returns(true)
      await expect(collateral.connect(user).withdrawTo(user.address, market.address, 80)).to.be.revertedWith(
        'CollateralInsufficientCollateralError()',
      )
    })

    it('reverts if liquidatable next', async () => {
      await market.mock.maintenance.withArgs(user.address).returns(100)
      await market.mock.maintenanceNext.withArgs(user.address).returns(50)

      await token.mock.transfer.withArgs(user.address, 80).returns(true)
      await expect(collateral.connect(user).withdrawTo(user.address, market.address, 80)).to.be.revertedWith(
        'CollateralInsufficientCollateralError()',
      )
    })

    describe('multiple users per market', async () => {
      beforeEach(async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.connect(owner).depositTo(userB.address, market.address, 100)
        await token.mock.transfer.withArgs(owner.address, 80).returns(true)
        await collateral.connect(user).withdrawTo(owner.address, market.address, 80)
      })

      it('subtracts from both totals', async () => {
        await expect(collateral.connect(userB).withdrawTo(owner.address, market.address, 80))
          .to.emit(collateral, 'Withdrawal')
          .withArgs(userB.address, market.address, 80)

        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(20)
        expect(await collateral['collateral(address,address)'](userB.address, market.address)).to.equal(20)
        expect(await collateral['collateral(address)'](market.address)).to.equal(40)
      })
    })

    describe('shortfall', async () => {
      beforeEach(async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.connect(owner).depositTo(userB.address, market.address, 100)

        await collateral.connect(marketSigner).settleAccount(userB.address, -150)
        await collateral.connect(marketSigner).settleAccount(user.address, 150)
      })

      it('reverts if depleted', async () => {
        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(250)
        expect(await collateral['collateral(address)'](market.address)).to.equal(200)
        expect(await collateral.shortfall(market.address)).to.equal(50)

        await expect(collateral.connect(user).withdrawTo(user.address, market.address, 250)).to.be.revertedWith('0x11') // underflow
      })
    })

    describe('shortfall (multiple)', async () => {
      beforeEach(async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.connect(owner).depositTo(userB.address, market.address, 100)

        await collateral.connect(marketSigner).settleAccount(userB.address, -150)
        await collateral.connect(marketSigner).settleAccount(userB.address, -50)
        await collateral.connect(marketSigner).settleAccount(user.address, 150)
        await collateral.connect(marketSigner).settleAccount(user.address, 50)
      })

      it('reverts if depleted', async () => {
        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(300)
        expect(await collateral['collateral(address)'](market.address)).to.equal(200)
        expect(await collateral.shortfall(market.address)).to.equal(100)

        await expect(collateral.connect(user).withdrawTo(user.address, market.address, 300)).to.be.revertedWith('0x11') // underflow
      })
    })
  })

  describe('#settleAccount', async () => {
    it('credits the account', async () => {
      await expect(collateral.connect(marketSigner).settleAccount(user.address, 101))
        .to.emit(collateral, 'AccountSettle')
        .withArgs(market.address, user.address, 101, 0)
      expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(101)
      expect(await collateral['collateral(address)'](market.address)).to.equal(0)
    })

    context('negative credit', async () => {
      it('doesnt create a shortfall', async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.depositTo(user.address, market.address, 100)

        await expect(collateral.connect(marketSigner).settleAccount(user.address, -99))
          .to.emit(collateral, 'AccountSettle')
          .withArgs(market.address, user.address, -99, 0)

        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(1)
        expect(await collateral['collateral(address)'](market.address)).to.equal(100)
        expect(await collateral.shortfall(market.address)).to.equal(0)
      })

      it('creates a shortfall', async () => {
        await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
        await collateral.depositTo(user.address, market.address, 100)

        await expect(collateral.connect(marketSigner).settleAccount(user.address, -101))
          .to.emit(collateral, 'AccountSettle')
          .withArgs(market.address, user.address, -101, 1)

        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(0)
        expect(await collateral['collateral(address)'](market.address)).to.equal(100)
        expect(await collateral.shortfall(market.address)).to.equal(1)
      })
    })

    it('reverts if not market', async () => {
      await factory.mock.isMarket.withArgs(user.address).returns(false)

      await expect(collateral.connect(user).settleAccount(user.address, 101)).to.be.revertedWith(
        `NotMarketError("${user.address}")`,
      )
    })
  })

  describe('#settleMarket', async () => {
    beforeEach(async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, market.address, 100)

      await factory.mock['treasury()'].returns(treasuryA.address)
      await factory.mock['treasury(address)'].withArgs(market.address).returns(treasuryB.address)
      await factory.mock.protocolFee.returns(utils.parseEther('0.1'))
    })

    it('settles the market fee', async () => {
      await expect(collateral.connect(marketSigner).settleMarket(90))
        .to.emit(collateral, 'MarketSettle')
        .withArgs(market.address, 9, 81)

      expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(100)

      expect(await collateral['collateral(address)'](market.address)).to.equal(10)
      expect(await collateral.shortfall(market.address)).to.equal(0)
      expect(await collateral.fees(treasuryA.address)).to.equal(9)
      expect(await collateral.fees(treasuryB.address)).to.equal(81)
    })

    it('reverts if market shortfall', async () => {
      await expect(collateral.connect(marketSigner).settleMarket(110)).to.be.revertedWith(`0x11`)
    })

    it('reverts if not market', async () => {
      await factory.mock.isMarket.withArgs(user.address).returns(false)

      await expect(collateral.connect(user).settleMarket(90)).to.be.revertedWith(`NotMarketError("${user.address}")`)
    })
  })

  describe('#liquidate', async () => {
    beforeEach(async () => {
      // Setup the with 100 underlying collateral
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, market.address, 100)

      // Mock settle calls
      await market.mock.settleAccount.withArgs(user.address).returns()
    })

    context('user not liquidatable', async () => {
      it('reverts without liquidating', async () => {
        await market.mock.maintenance.withArgs(user.address).returns(10)

        expect(await collateral.liquidatable(user.address, market.address)).to.equal(false)

        await expect(collateral.liquidate(user.address, market.address)).to.be.revertedWith(
          'CollateralCantLiquidate(10, 100)',
        )
      })
    })

    context('user liquidatable', async () => {
      it('liquidates the user', async () => {
        await market.mock.maintenance.withArgs(user.address).returns(101)
        await market.mock.closeAll.withArgs(user.address).returns()
        await token.mock.transfer.withArgs(owner.address, 50).returns(true)

        expect(await collateral.liquidatable(user.address, market.address)).to.equal(true)

        await expect(collateral.liquidate(user.address, market.address))
          .to.emit(collateral, 'Liquidation')
          .withArgs(user.address, market.address, owner.address, 50)

        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(50)
        expect(await collateral['collateral(address)'](market.address)).to.equal(50)
      })

      it('limits fee to total collateral', async () => {
        await market.mock.maintenance.withArgs(user.address).returns(210)
        await market.mock.closeAll.withArgs(user.address).returns()
        await token.mock.transfer.withArgs(owner.address, 100).returns(true)

        expect(await collateral.liquidatable(user.address, market.address)).to.equal(true)

        await expect(collateral.liquidate(user.address, market.address))
          .to.emit(collateral, 'Liquidation')
          .withArgs(user.address, market.address, owner.address, 100)

        expect(await collateral['collateral(address,address)'](user.address, market.address)).to.equal(0)
        expect(await collateral['collateral(address)'](market.address)).to.equal(0)
      })

      it('reverts if paused', async () => {
        await factory.mock.paused.withArgs().returns(true)
        await expect(collateral.liquidate(user.address, market.address)).to.be.revertedWith('PausedError()')
      })

      it('reverts if not market', async () => {
        await expect(collateral.liquidate(user.address, notMarket.address)).to.be.revertedWith(
          `NotMarketError("${notMarket.address}")`,
        )
      })
    })
  })

  describe('#liquidatableNext', async () => {
    beforeEach(async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, market.address, 100)
    })

    it('returns true', async () => {
      await market.mock.maintenanceNext.withArgs(user.address).returns(101)

      expect(await collateral.liquidatableNext(user.address, market.address)).to.equal(true)
    })

    it('returns false', async () => {
      await market.mock.maintenanceNext.withArgs(user.address).returns(99)

      expect(await collateral.liquidatableNext(user.address, market.address)).to.equal(false)
    })
  })

  describe('#resolveShortfall', async () => {
    beforeEach(async () => {
      await collateral.connect(marketSigner).settleAccount(user.address, -100)
    })

    it('pays off the shortfall', async () => {
      await token.mock.transferFrom.withArgs(user.address, collateral.address, 90).returns(true)

      await expect(collateral.connect(user).resolveShortfall(market.address, 90))
        .to.emit(collateral, 'ShortfallResolution')
        .withArgs(market.address, 90)

      expect(await collateral['collateral(address)'](market.address)).to.equal(90)
      expect(await collateral.shortfall(market.address)).to.equal(10)
    })

    it('reverts if paused', async () => {
      await factory.mock.paused.withArgs().returns(true)
      await expect(collateral.connect(user).resolveShortfall(market.address, 90)).to.be.revertedWith('PausedError()')
    })
  })

  describe('#claimFee', async () => {
    beforeEach(async () => {
      await token.mock.transferFrom.withArgs(owner.address, collateral.address, 100).returns(true)
      await collateral.depositTo(user.address, market.address, 100)

      await factory.mock['treasury()'].returns(treasuryA.address)
      await factory.mock['treasury(address)'].withArgs(market.address).returns(treasuryB.address)
      await factory.mock.protocolFee.returns(utils.parseEther('0.1'))

      await collateral.connect(marketSigner).settleMarket(90)
    })

    it('claims fee', async () => {
      await token.mock.transfer.withArgs(treasuryA.address, 9).returns(true)
      await token.mock.transfer.withArgs(treasuryB.address, 81).returns(true)

      await expect(collateral.connect(treasuryA).claimFee())
        .to.emit(collateral, 'FeeClaim')
        .withArgs(treasuryA.address, 9)

      await expect(collateral.connect(treasuryB).claimFee())
        .to.emit(collateral, 'FeeClaim')
        .withArgs(treasuryB.address, 81)

      expect(await collateral.fees(treasuryA.address)).to.equal(0)
      expect(await collateral.fees(treasuryB.address)).to.equal(0)
    })

    it('reverts if paused', async () => {
      await factory.mock.paused.returns(true)
      await expect(collateral.connect(treasuryB).claimFee()).to.be.revertedWith('PausedError()')
    })
  })
})
