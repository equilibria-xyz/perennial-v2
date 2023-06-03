import HRE from 'hardhat'
import { time, impersonate } from '../../../../common/testutil'
import { deployProductOnMainnetFork } from '../helpers/setupHelpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IFactory,
  IMarket,
  Vault__factory,
  IOracleProvider,
  ChainlinkOracle__factory,
  VaultFactory__factory,
  IVaultFactory,
  IVault__factory,
  IVault,
} from '../../../types/generated'
import { BigNumber, constants } from 'ethers'
import { deployProtocol, fundWallet } from '@equilibria/perennial-v2/test/integration/helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'

const { config, ethers } = HRE
use(smock.matchers)

// TODO: parameter tests

describe('Vault', () => {
  let vault: IVault
  let asset: IERC20Metadata
  let vaultFactory: IVaultFactory
  let factory: IFactory
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let btcUser1: SignerWithAddress
  let btcUser2: SignerWithAddress
  let perennialUser: SignerWithAddress
  let liquidator: SignerWithAddress
  let leverage: BigNumber
  let maxCollateral: BigNumber
  let originalOraclePrice: BigNumber
  let oracle: FakeContract<IOracleProvider>
  let market: IMarket
  let btcOriginalOraclePrice: BigNumber
  let btcOracle: FakeContract<IOracleProvider>
  let btcMarket: IMarket

  async function updateOracle(newPrice?: BigNumber, newPriceBtc?: BigNumber) {
    await _updateOracleEth(newPrice)
    await _updateOracleBtc(newPriceBtc)
  }

  async function _updateOracleEth(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await oracle.latest()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp.add(13),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    oracle.sync.returns([newVersion, newVersion.version.add(1)])
    oracle.latest.returns(newVersion)
    oracle.current.returns(newVersion.version.add(1))
    oracle.at.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function _updateOracleBtc(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await btcOracle.latest()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp.add(13),
      price: newPrice ?? currentPrice,
      valid: true,
    }
    btcOracle.sync.returns([newVersion, newVersion.version.add(1)])
    btcOracle.latest.returns(newVersion)
    btcOracle.current.returns(newVersion.version.add(1))
    btcOracle.at.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function position() {
    return (await market.positions(vault.address)).maker
  }

  async function btcPosition() {
    return (await btcMarket.positions(vault.address)).maker
  }

  async function collateralInVault() {
    return (await market.locals(vault.address)).collateral
  }

  async function btcCollateralInVault() {
    return (await btcMarket.locals(vault.address)).collateral
  }

  async function totalCollateralInVault() {
    return (await collateralInVault())
      .add(await btcCollateralInVault())
      .mul(1e12)
      .add(await asset.balanceOf(vault.address))
  }

  beforeEach(async () => {
    await time.reset(config)

    const instanceVars = await deployProtocol()

    const parameter = { ...(await instanceVars.factory.parameter()) }
    parameter.minCollateral = parse6decimal('50')
    await instanceVars.factory.updateParameter(parameter)

    let pauser
    ;[owner, pauser, user, user2, btcUser1, btcUser2, liquidator, perennialUser] = await ethers.getSigners()
    factory = instanceVars.factory

    const oracleToMock = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      '0x0000000000000000000000000000000000000348',
      1,
    )
    const btcOracleToMock = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      '0x0000000000000000000000000000000000000348',
      1,
    )

    // Unfortunately, we can't make mocks of existing contracts.
    // So, we make a fake and initialize it with the values that the real contract had at this block.
    const realOracle = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      '0x0000000000000000000000000000000000000348',
      1,
    )
    const realVersion = { ...(await realOracle.latest()) }
    const currentVersion = {
      version: BigNumber.from(1000000),
      timestamp: realVersion.timestamp,
      price: realVersion.price,
      valid: true,
    }
    originalOraclePrice = realVersion.price

    oracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: oracleToMock.address,
    })
    oracle.sync.returns([currentVersion, currentVersion.version.add(1)]) // TODO: hardcoded delay
    oracle.latest.returns(currentVersion)
    oracle.current.returns(currentVersion.version.add(1)) // TODO: hardcoded delay
    oracle.at.whenCalledWith(currentVersion.version).returns(currentVersion)

    const realBtcOracle = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      '0x0000000000000000000000000000000000000348',
      1,
    )
    const btcRealVersion = { ...(await realBtcOracle.latest()) }
    const btcCurrentVersion = {
      version: BigNumber.from(1000000),
      timestamp: btcRealVersion.timestamp,
      price: btcRealVersion.price,
      valid: true,
    }
    btcOriginalOraclePrice = btcRealVersion.price

    btcOracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: btcOracleToMock.address,
    })
    btcOracle.sync.returns([btcCurrentVersion, btcCurrentVersion.version.add(1)]) // TODO: hardcoded delay
    btcOracle.latest.returns(btcCurrentVersion)
    btcOracle.current.returns(btcCurrentVersion.version.add(1)) // TODO: hardcoded delay
    btcOracle.at.whenCalledWith(btcCurrentVersion.version).returns(btcCurrentVersion)

    market = await deployProductOnMainnetFork({
      factory: instanceVars.factory,
      token: instanceVars.dsu,
      owner: owner,
      name: 'Ethereum',
      symbol: 'ETH',
      oracle: oracleToMock.address,
      makerLimit: parse6decimal('1000'),
    })
    btcMarket = await deployProductOnMainnetFork({
      factory: instanceVars.factory,
      token: instanceVars.dsu,
      owner: owner,
      name: 'Bitcoin',
      symbol: 'BTC',
      oracle: btcOracleToMock.address,
    })
    leverage = parse6decimal('4.0')
    maxCollateral = parse6decimal('500000')

    const vaultImpl = await new Vault__factory(owner).deploy()
    vaultFactory = await new VaultFactory__factory(owner).deploy(instanceVars.factory.address, vaultImpl.address)
    await vaultFactory.initialize()
    vault = IVault__factory.connect(
      await vaultFactory.callStatic.create(instanceVars.dsu.address, market.address),
      owner,
    )

    await vaultFactory.create(instanceVars.dsu.address, market.address)

    await vault.register(btcMarket.address)
    await vault.updateWeight(0, 4)
    await vault.updateWeight(1, 1)
    await vault.updateLeverage(leverage)
    await vault.updateCap(maxCollateral)

    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)
    await asset.connect(liquidator).approve(vault.address, ethers.constants.MaxUint256)
    await fundWallet(asset, liquidator)
    await asset.connect(perennialUser).approve(vault.address, ethers.constants.MaxUint256)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await fundWallet(asset, perennialUser)
    await asset.connect(user).approve(vault.address, ethers.constants.MaxUint256)
    await asset.connect(user2).approve(vault.address, ethers.constants.MaxUint256)
    await asset.connect(btcUser1).approve(vault.address, ethers.constants.MaxUint256)
    await asset.connect(btcUser2).approve(vault.address, ethers.constants.MaxUint256)

    // Seed markets with some activity
    await asset.connect(user).approve(market.address, ethers.constants.MaxUint256)
    await asset.connect(user2).approve(market.address, ethers.constants.MaxUint256)
    await asset.connect(btcUser1).approve(btcMarket.address, ethers.constants.MaxUint256)
    await asset.connect(btcUser2).approve(btcMarket.address, ethers.constants.MaxUint256)
    await market.connect(user).update(user.address, parse6decimal('200'), 0, 0, parse6decimal('100000'))
    await market.connect(user2).update(user2.address, 0, parse6decimal('100'), 0, parse6decimal('100000'))
    await btcMarket.connect(btcUser1).update(btcUser1.address, parse6decimal('20'), 0, 0, parse6decimal('100000'))
    await btcMarket.connect(btcUser2).update(btcUser2.address, 0, parse6decimal('10'), 0, parse6decimal('100000'))
  })

  describe('#initialize', () => {
    it('cant re-initialize', async () => {
      await expect(vault.initialize(factory.address, asset.address, market.address)).to.revertedWith(
        'UInitializableAlreadyInitializedError',
      )
    })
  })

  describe('#name', () => {
    it('is correct', async () => {
      expect(await vault.name()).to.equal('Vault-XX')
    })
  })

  describe('#approve', () => {
    it('approves correctly', async () => {
      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)

      await expect(vault.connect(user).approve(liquidator.address, parse6decimal('10')))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, parse6decimal('10'))

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(parse6decimal('10'))

      await expect(vault.connect(user).approve(liquidator.address, 0))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, 0)

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)
    })
  })

  describe('#deposit/#redeem/#claim/#sync', () => {
    it('simple deposits and withdraws', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('10')
      await vault.connect(user).deposit(smallDeposit, user.address)
      expect(await collateralInVault()).to.equal(0)
      expect(await btcCollateralInVault()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault.settle(user.address)

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      expect(await collateralInVault()).to.equal(parse6decimal('8008'))
      expect(await btcCollateralInVault()).to.equal(parse6decimal('2002'))
      expect(await vault.balanceOf(user.address)).to.equal(smallDeposit)
      expect(await vault.totalSupply()).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(parse6decimal('10'))).to.equal(parse6decimal('10'))
      expect(await vault.convertToShares(parse6decimal('10'))).to.equal(parse6decimal('10'))
      await updateOracle()
      await vault.settle(user.address)

      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('10010'))
      expect(await vault.totalSupply()).to.equal(parse6decimal('10010'))
      expect(await vault.totalAssets()).to.equal(parse6decimal('10010'))
      expect(await vault.convertToAssets(parse6decimal('10010'))).to.equal(parse6decimal('10010'))
      expect(await vault.convertToShares(parse6decimal('10010'))).to.equal(parse6decimal('10010'))

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage originalOraclePrice.
      expect(await position()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice),
      )

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await expect(vault.connect(user2).redeem(1, user2.address)).to.be.revertedWith('VaultRedemptionLimitExceeded')

      expect(await vault.maxRedeem(user.address)).to.equal(parse6decimal('10010'))
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.settle(user.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('388')
      expect(await totalCollateralInVault()).to.equal(parse6decimal('10010').add(fundingAmount).mul(1e12))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.unclaimed(user.address)).to.equal(parse6decimal('10010').add(fundingAmount))
      expect(await vault.totalUnclaimed()).to.equal(parse6decimal('10010').add(fundingAmount))

      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect(await vault.unclaimed(user.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('multiple users', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracle()
      await vault.settle(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from('40')
      const balanceOf2 = BigNumber.from('9999999600')
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(parse6decimal('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(parse6decimal('1000').add(balanceOf2))
      expect(await vault.convertToAssets(parse6decimal('1000').add(balanceOf2))).to.equal(
        parse6decimal('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(parse6decimal('11000').add(fundingAmount0))).to.equal(
        parse6decimal('1000').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.settle(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('78')
      const fundingAmount2 = BigNumber.from('776')
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('11000').add(fundingAmount).add(fundingAmount2).mul(1e12),
      )
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.unclaimed(user.address)).to.equal(parse6decimal('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(parse6decimal('10000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(parse6decimal('11000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect(await asset.balanceOf(user2.address)).to.equal(parse6decimal('100000').add(fundingAmount2).mul(1e12))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('deposit during withdraw', async () => {
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))

      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const largeDeposit = parse6decimal('2000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await vault.connect(user).redeem(parse6decimal('400'), user.address)
      await updateOracle()
      await vault.settle(user.address)
      await vault.settle(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.be.equal(
        smallDeposit.add(largeDeposit).sub(parse6decimal('400')).mul(4).div(5).mul(leverage).div(originalOraclePrice),
      )
      expect(await btcPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).sub(parse6decimal('400')).div(5).mul(leverage).div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from('24')
      const balanceOf2 = BigNumber.from('1999999920')
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('600'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(parse6decimal('2600').add(fundingAmount0))
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('2600')
          .add(fundingAmount0)
          .add(await vault.totalUnclaimed())
          .mul(1e12),
      )
      expect(await vault.totalSupply()).to.equal(parse6decimal('600').add(balanceOf2))
      expect(await vault.convertToAssets(parse6decimal('600').add(balanceOf2))).to.equal(
        parse6decimal('2600').add(fundingAmount0),
      )
      expect(await vault.convertToShares(parse6decimal('2600').add(fundingAmount0))).to.equal(
        parse6decimal('600').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.settle(user2.address)

      // We should have closed all positions.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('64')
      const fundingAmount2 = BigNumber.from('164')
      expect(await totalCollateralInVault()).to.equal(
        parse6decimal('3000').add(fundingAmount).add(fundingAmount2).mul(1e12),
      )
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.convertToShares(parse6decimal('1'))).to.equal(parse6decimal('1'))
      expect(await vault.unclaimed(user.address)).to.equal(parse6decimal('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(parse6decimal('2000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(parse6decimal('3000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
      expect(await asset.balanceOf(user2.address)).to.equal(parse6decimal('100000').add(fundingAmount2).mul(1e12))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('maxWithdraw', async () => {
      const smallDeposit = parse6decimal('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const shareAmount = BigNumber.from(parse6decimal('1000'))
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount)

      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const shareAmount2 = BigNumber.from('9999999600')
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount.add(shareAmount2))

      // We shouldn't be able to withdraw more than maxWithdraw.
      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWith('VaultRedemptionLimitExceeded')

      // But we should be able to withdraw exactly maxWithdraw.
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)

      // The oracle price hasn't changed yet, so we shouldn't be able to withdraw any more.
      expect(await vault.maxRedeem(user.address)).to.equal(0)

      // But if we update the oracle price, we should be able to withdraw the rest of our collateral.
      await updateOracle()
      await vault.settle(user.address)

      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      // Our collateral should be less than the fixedFloat and greater than 0.
      await vault.claim(user.address)
      expect(await totalCollateralInVault()).to.eq(0)
      expect(await vault.totalAssets()).to.equal(0)
    })

    it('maxRedeem with close limited', async () => {
      const largeDeposit = parse6decimal('10000')

      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      const currentPosition = await market.pendingPosition((await market.global()).currentId)
      const currentNet = currentPosition.long.sub(currentPosition.short).abs()

      // Open taker position up to 100% utilization minus 1 ETH
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      await market
        .connect(perennialUser)
        .update(
          perennialUser.address,
          0,
          currentPosition.maker.sub(currentNet).sub(parse6decimal('1')),
          0,
          parse6decimal('1000000'),
        )

      // Settle the take position
      await updateOracle()
      await vault.settle(user.address)

      const makerAvailable = parse6decimal('1').add(1) // extra 1 due to rebalance
      // The vault can close 1 ETH of maker positions in the ETH market, which means the user can withdraw 5/4 this amount
      expect(await vault.maxRedeem(user.address)).to.equal(
        await vault.convertToShares(originalOraclePrice.mul(makerAvailable).mul(5).div(4).div(leverage)),
      )

      await vault.settle(user.address)

      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWith('VaultRedemptionLimitExceededError')

      await expect(vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)).to.not.be.reverted
    })

    it('maxDeposit', async () => {
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral)

      await vault.connect(user).deposit(parse6decimal('100000'), user.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(parse6decimal('100000')))

      await vault.connect(user2).deposit(parse6decimal('100000'), user2.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(parse6decimal('200000')))

      await vault.connect(perennialUser).deposit(parse6decimal('300000'), liquidator.address)
      expect(await vault.maxDeposit(user.address)).to.equal(0)

      await expect(vault.connect(liquidator).deposit(1, liquidator.address)).to.revertedWith(
        'VaultDepositLimitExceeded',
      )
    })

    it('rebalances collateral', async () => {
      await vault.connect(user).deposit(parse6decimal('100000'), user.address)
      await updateOracle()
      await vault.settle(user.address)

      const originalTotalCollateral = await totalCollateralInVault()

      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), 3)
      await updateOracle(parse6decimal('1800'))
      await market.connect(user).settle(vault.address)

      await vault.settle(user.address)
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), 3)

      await updateOracle(originalOraclePrice)
      await vault.settle(user.address)
      expect(await collateralInVault()).to.be.closeTo((await btcCollateralInVault()).mul(4), 3)

      // Since the price changed then went back to the original, the total collateral should have increased.
      const fundingAmount = BigNumber.from('3892')
      expect(await totalCollateralInVault()).to.eq(originalTotalCollateral.add(fundingAmount.mul(1e12)))
      expect(await vault.totalAssets()).to.eq(originalTotalCollateral.div(1e12).add(fundingAmount))
    })

    it('rounds deposits correctly', async () => {
      const oddDepositAmount = parse6decimal('10000').add(1) // 10K + 1 wei

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.settle(user.address)
      expect(await asset.balanceOf(vault.address)).to.equal(1e12)

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.settle(user.address)
    })

    it('deposit on behalf', async () => {
      const largeDeposit = parse6decimal('10000')
      await vault.connect(liquidator).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.settle(user.address)
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('10000'))
      expect(await vault.totalSupply()).to.equal(parse6decimal('10000'))

      await expect(vault.connect(liquidator).redeem(parse6decimal('10000'), user.address)).to.revertedWith('0x11')

      await vault.connect(user).approve(liquidator.address, parse6decimal('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(parse6decimal('10000'), user.address)
      await updateOracle()
      await vault.settle(user.address)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('388')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(liquidator.address)).to.equal(parse6decimal('190000').mul(1e12))
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('110000').add(fundingAmount).mul(1e12))
    })

    it('redeem on behalf', async () => {
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.settle(user.address)
      expect(await vault.balanceOf(user.address)).to.equal(parse6decimal('10000'))
      expect(await vault.totalSupply()).to.equal(parse6decimal('10000'))

      await expect(vault.connect(liquidator).redeem(parse6decimal('10000'), user.address)).to.revertedWith('0x11')

      await vault.connect(user).approve(liquidator.address, parse6decimal('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(parse6decimal('10000'), user.address)
      await updateOracle()
      await vault.settle(user.address)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('388')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(parse6decimal('100000').add(fundingAmount).mul(1e12))
    })

    it('close to makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      await market
        .connect(perennialUser)
        .update(perennialUser.address, parse6decimal('480'), 0, 0, parse6decimal('400000'))
      await updateOracle()
      await vault.settle(user.address)

      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal('205981')
    })

    it('exactly at makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      const makerAvailable = (await market.parameter()).makerLimit.sub(
        (await market.pendingPosition((await market.global()).currentId)).maker,
      )
      await market.connect(perennialUser).update(perennialUser.address, makerAvailable, 0, 0, parse6decimal('400000'))

      await updateOracle()
      await vault.settle(user.address)

      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
    })

    it('close to taker', async () => {
      // Deposit should create a greater position than what's available
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      // Get taker product very close to the maker
      await asset.connect(perennialUser).approve(market.address, constants.MaxUint256)
      await market
        .connect(perennialUser)
        .update(perennialUser.address, 0, parse6decimal('110'), 0, parse6decimal('1000000'))

      await updateOracle()
      await vault.settle(user.address)

      // Redeem should create a greater position delta than what's available
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.settle(user.address)

      expect((await market.position()).maker).to.equal((await market.position()).long)
    })

    it('product closing closes all positions', async () => {
      const largeDeposit = parse6decimal('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.settle(user.address)

      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
      const marketParameter = { ...(await market.parameter()) }
      const btcMarketParameter = { ...(await btcMarket.parameter()) }

      marketParameter.closed = true
      await market.connect(owner).updateParameter(marketParameter)
      btcMarketParameter.closed = true
      await btcMarket.connect(owner).updateParameter(btcMarketParameter)

      await updateOracle()
      await vault.settle(user.address)

      await updateOracle()
      await vault.settle(user.address)

      // We should have closed all positions
      expect(await position()).to.equal(0)
      expect(await btcPosition()).to.equal(0)

      marketParameter.closed = false
      await market.connect(owner).updateParameter(marketParameter)
      btcMarketParameter.closed = false
      await btcMarket.connect(owner).updateParameter(btcMarketParameter)

      await updateOracle()
      await vault.settle(user.address)

      await updateOracle()
      await vault.settle(user.address)

      // Positions should be opened back up again
      expect(await position()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(originalOraclePrice))
      expect(await btcPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(btcOriginalOraclePrice))
    })

    context('liquidation', () => {
      context('long', () => {
        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(parse6decimal('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('50000'))
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await btcMarket.connect(user).settle(vault.address)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('4428358376') // no shortfall
          expect((await btcMarket.locals(vault.address)).liquidation).to.equal(1000003)

          //expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('40000'))
          await vault.connect(user).deposit(2, user.address)
          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('114512723')
          const finalCollateral = BigNumber.from('75012631062')
          const btcFinalPosition = BigNumber.from('1875315')
          const btcFinalCollateral = BigNumber.from('18753157765')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })

        it('recovers from a liquidation w/ shortfall', async () => {
          await vault.connect(user).deposit(parse6decimal('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('80000'))
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await btcMarket.connect(user).settle(vault.address)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('-26673644386') // shortfall
          expect((await btcMarket.locals(vault.address)).liquidation).to.equal(1000003)

          //expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('55000'))
          await vault.connect(user).deposit(2, user.address)
          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('93634169')
          const finalCollateral = BigNumber.from('61335939004')
          const btcFinalPosition = BigNumber.from('1115198')
          const btcFinalCollateral = BigNumber.from('15333984751')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })

      context('short', () => {
        beforeEach(async () => {
          // get utilization closer to target in order to trigger pnl on price deviation
          await market.connect(user2).update(user2.address, 0, 0, parse6decimal('100'), parse6decimal('100000'))
          await btcMarket.connect(btcUser2).update(btcUser2.address, 0, 0, parse6decimal('10'), parse6decimal('100000'))
          await updateOracle()
          await vault.settle(user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(parse6decimal('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('20000'))
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await btcMarket.connect(user).settle(vault.address)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('350002309') // no shortfall
          expect((await btcMarket.locals(vault.address)).liquidation).to.equal(1000004)

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('30000'))
          await updateOracle()
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('122126339')
          const finalCollateral = BigNumber.from('71749947028')
          const btcFinalPosition = BigNumber.from('2666666')
          const btcFinalCollateral = BigNumber.from('17937486757')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })

        it('recovers from a liquidation w/ shortfall', async () => {
          await vault.connect(user).deposit(parse6decimal('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(undefined, parse6decimal('19000'))
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWith('VaultRedemptionLimitExceeded')

          // 2. Settle accounts / Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await btcMarket.connect(user).settle(vault.address)
          expect((await btcMarket.locals(vault.address)).collateral).to.equal('-480749216') // shortfall
          expect((await btcMarket.locals(vault.address)).liquidation).to.equal(1000004)

          // 3. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(undefined, parse6decimal('30000'))
          await updateOracle()
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.settle(user.address)

          const finalPosition = BigNumber.from('122126339')
          const finalCollateral = BigNumber.from('71832339773')
          const btcFinalPosition = BigNumber.from('2666666')
          const btcFinalCollateral = BigNumber.from('17958084943')
          expect(await position()).to.equal(finalPosition)
          expect(await collateralInVault()).to.equal(finalCollateral)
          expect(await btcPosition()).to.equal(btcFinalPosition)
          expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })
    })

    context('insolvency', () => {
      it('gracefully unwinds upon totalClaimable insolvency', async () => {
        // 1. Deposit initial amount into the vault
        await vault.connect(user).deposit(parse6decimal('100000'), user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).redeem(parse6decimal('80000'), user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(parse6decimal('10000'))
        await market.connect(user).settle(vault.address)
        await market.connect(user).settle(user2.address)

        const user2Collateral = (await market.locals(user2.address)).collateral
        await market.connect(user2).update(user2.address, 0, 0, 0, user2Collateral)

        // 4. Settle the vault to recover and rebalance
        await updateOracle() // let take settle at high price
        await updateOracle(parse6decimal('1500'), parse6decimal('5000')) // lower prices to allow rebalance (TODO)
        await vault.settle(user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('11439452775')
        const btcFinalPosition = BigNumber.from('0')
        const btcFinalCollateral = BigNumber.from('2859863193')
        const finalUnclaimed = BigNumber.from('80000001849')
        const vaultFinalCollateral = await asset.balanceOf(vault.address)
        expect(await position()).to.equal(finalPosition)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcPosition()).to.equal(btcFinalPosition)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(finalUnclaimed)
        expect(await vault.totalUnclaimed()).to.equal(finalUnclaimed)

        // 6. Claim should be pro-rated
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.claim(user.address)
        expect(await collateralInVault()).to.equal(0)
        expect(await btcCollateralInVault()).to.equal(0)
        expect(await vault.unclaimed(user.address)).to.equal(0)
        expect(await vault.totalUnclaimed()).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(
          initialBalanceOf.add(finalCollateral.add(btcFinalCollateral).mul(1e12)).add(vaultFinalCollateral),
        )

        // 7. Should no longer be able to deposit, vault is closed
        await expect(vault.connect(user).deposit(2, user.address)).to.revertedWith('VaultDepositLimitExceeded')
      })

      it('gracefully unwinds upon total insolvency', async () => {
        // 1. Deposit initial amount into the vault
        await vault.connect(user).deposit(parse6decimal('100000'), user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).redeem(parse6decimal('80000'), user.address)
        await updateOracle()
        await vault.settle(user.address)

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(parse6decimal('20000'))
        await market.connect(user).settle(vault.address)
        await updateOracle()
        await vault.settle(user.address)

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('-133577466786')
        const btcFinalPosition = BigNumber.from('411963') // small position because vault is net negative and won't rebalance
        const btcFinalCollateral = BigNumber.from('20000000790')
        const finalUnclaimed = BigNumber.from('80000001849')
        expect(await position()).to.equal(finalPosition)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcPosition()).to.equal(btcFinalPosition)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(finalUnclaimed)
        expect(await vault.totalUnclaimed()).to.equal(finalUnclaimed)

        // 6. Claim should be pro-rated
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.claim(user.address)
        expect(await collateralInVault()).to.equal(finalCollateral)
        expect(await btcCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(0)
        expect(await vault.totalUnclaimed()).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(initialBalanceOf)
      })
    })
  })
})
