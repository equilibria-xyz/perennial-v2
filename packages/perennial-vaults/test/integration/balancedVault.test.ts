import HRE from 'hardhat'
import { time, impersonate } from '../../../common/testutil'
import { Big18Math, Big6Math, parse6decimal } from '../../../common/testutil/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  BalancedVault,
  BalancedVault__factory,
  IOracleProvider__factory,
  IOracleProvider,
  IMarket,
} from '../../types/generated'
import { BigNumber, utils, constants } from 'ethers'
import {
  createMarket,
  deployProtocol,
  InstanceVars,
} from '@equilibria/perennial-v2/test/integration/helpers/setupHelpers'

const { config, ethers } = HRE
use(smock.matchers)

const DSU_HOLDER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'

describe('BalancedVault', () => {
  let instanceVars: InstanceVars
  let vault: BalancedVault
  let asset: IERC20Metadata
  let oracle: FakeContract<IOracleProvider>
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let liquidator: SignerWithAddress
  let long: IMarket
  let short: IMarket
  let leverage: BigNumber
  let maxLeverage: BigNumber
  let fixedFloat: BigNumber
  let maxCollateral: BigNumber
  let originalOraclePrice: BigNumber

  async function updateOracle(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await oracle.currentVersion()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp.add(13),
      price: newPrice ?? currentPrice,
    }
    oracle.sync.returns(newVersion)
    oracle.currentVersion.returns(newVersion)
    oracle.atVersion.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function longPosition() {
    return (await long.accounts(vault.address)).position.abs()
  }

  async function shortPosition() {
    return (await short.accounts(vault.address)).position.abs()
  }

  async function longCollateralInVault() {
    return (await long.accounts(vault.address)).collateral
  }

  async function shortCollateralInVault() {
    return (await short.accounts(vault.address)).collateral
  }

  async function totalCollateralInVault() {
    return (await longCollateralInVault()).add(await shortCollateralInVault())
  }

  beforeEach(async () => {
    await time.reset(config)
    ;[user, user2, liquidator] = await ethers.getSigners()

    instanceVars = await deployProtocol()
    const { owner, factory, chainlinkOracle, dsu } = instanceVars

    long = await createMarket(instanceVars, 'Ether', 'ETH', chainlinkOracle, {
      provider: constants.AddressZero,
      short: false,
    })
    short = await createMarket(instanceVars, 'Ether', 'ETH', chainlinkOracle, {
      provider: constants.AddressZero,
      short: true,
    })
    leverage = parse6decimal('1.2')
    maxLeverage = parse6decimal('1.32')
    fixedFloat = parse6decimal('10000')
    maxCollateral = parse6decimal('300000')

    vault = await new BalancedVault__factory(owner).deploy(
      factory.address,
      long.address,
      short.address,
      leverage,
      maxLeverage,
      fixedFloat,
      maxCollateral,
    )
    await vault.initialize(dsu.address)
    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

    const dsuHolder = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    const setUpWalletWithDSU = async (wallet: SignerWithAddress) => {
      await dsu.connect(dsuHolder).transfer(wallet.address, utils.parseEther('200000'))
      await dsu.connect(wallet).approve(vault.address, ethers.constants.MaxUint256)
    }
    await setUpWalletWithDSU(user)
    await setUpWalletWithDSU(user2)
    await setUpWalletWithDSU(liquidator)

    await dsu.connect(user).approve(long.address, ethers.constants.MaxUint256)
    await dsu.connect(user).approve(short.address, ethers.constants.MaxUint256)
    await long.connect(user).update(parse6decimal('-8'), parse6decimal('10000'))
    await short.connect(user).update(parse6decimal('-8'), parse6decimal('10000'))
    await dsu.connect(user2).approve(long.address, ethers.constants.MaxUint256)
    await dsu.connect(user2).approve(short.address, ethers.constants.MaxUint256)
    await long.connect(user2).update(parse6decimal('4'), parse6decimal('10000'))
    await short.connect(user2).update(parse6decimal('4'), parse6decimal('10000'))

    // Unfortunately, we can't make mocks of existing contracts.
    // So, we make a fake and initialize it with the values that the real contract had at this block.
    const realOracle = IOracleProvider__factory.connect(chainlinkOracle.address, owner)
    const currentVersion = await realOracle.currentVersion()
    originalOraclePrice = currentVersion[2]

    oracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: chainlinkOracle.address,
    })
    oracle.sync.returns(currentVersion)
    oracle.currentVersion.returns(currentVersion)
    oracle.atVersion.whenCalledWith(currentVersion[0]).returns(currentVersion)
  })

  it('names are correct', async () => {
    expect(await vault.name()).to.equal('Perennial Balanced Vault: Ether')
    expect(await vault.symbol()).to.equal('PBV-ETH')
  })

  it('simple deposits and withdraws', async () => {
    const smallDeposit = utils.parseEther('1000')
    await vault.connect(user).deposit(smallDeposit, user.address)
    expect(await asset.connect(user).balanceOf(user.address)).to.equal(utils.parseEther('179000'))
    await updateOracle()
    await vault.sync()

    // We're underneath the fixed loat, so we shouldn't have opened any positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    const largeDeposit = utils.parseEther('10000')
    await vault.connect(user).deposit(largeDeposit, user.address)
    await updateOracle()
    await vault.sync()

    // Now we should have opened positions.
    // The positions should be equal to (smallDeposit + largeDeposit - fixedFloat) * leverage / 2 / originalOraclePrice.
    expect(await longPosition()).to.be.equal(
      smallDeposit.add(largeDeposit).div(1e12).sub(fixedFloat).mul(leverage).div(2).div(originalOraclePrice),
    )
    expect(await shortPosition()).to.equal(await longPosition())

    // User 2 should not be able to withdraw; they haven't deposited anything.
    await expect(vault.connect(user2).withdraw(1, user2.address, user2.address)).to.be.revertedWith(
      'ERC4626: withdraw more than max',
    )
    while ((await vault.connect(user).balanceOf(user.address)).gt(0)) {
      const maxWithdraw = await vault.maxWithdraw(user.address)
      await vault.connect(user).withdraw(maxWithdraw, user.address, user.address)
      await updateOracle()
      await vault.sync()
    }

    // We should have closed all positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    // We should have withdrawn all of our collateral.
    expect(await totalCollateralInVault()).to.equal(0)
  })

  it('multiple users', async () => {
    const smallDeposit = utils.parseEther('1000')
    await vault.connect(user).deposit(smallDeposit, user.address)
    await updateOracle()
    await vault.sync()

    const largeDeposit = utils.parseEther('10000')
    await vault.connect(user2).deposit(largeDeposit, user2.address)
    await updateOracle()
    await vault.sync()

    // Now we should have opened positions.
    // The positions should be equal to (smallDeposit + largeDeposit - fixedFloat) * leverage / 2 / originalOraclePrice.
    expect(await longPosition()).to.be.equal(
      smallDeposit.add(largeDeposit).div(1e12).sub(fixedFloat).mul(leverage).div(2).div(originalOraclePrice),
    )
    expect(await shortPosition()).to.equal(await longPosition())

    while ((await vault.connect(user2).balanceOf(user2.address)).gt(0)) {
      const maxWithdraw = await vault.maxWithdraw(user2.address)
      await vault.connect(user2).withdraw(maxWithdraw, user2.address, user2.address)
      await updateOracle()
      await vault.sync()
    }

    while ((await vault.connect(user).balanceOf(user.address)).gt(0)) {
      const maxWithdraw = await vault.maxWithdraw(user.address)
      await vault.connect(user).withdraw(maxWithdraw, user.address, user.address)
      await updateOracle()
      await vault.sync()
    }

    // We should have closed all positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    // We should have withdrawn all of our collateral.
    expect(await totalCollateralInVault()).to.equal(0)
  })

  it('deposit then immediately withdraw', async () => {
    const originalDsuBalance = await asset.balanceOf(user.address)

    const smallDeposit = utils.parseEther('500')
    await vault.connect(user).deposit(smallDeposit, user.address)
    await vault.connect(user).withdraw(smallDeposit, user.address, user.address)

    await updateOracle()
    await vault.sync()
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    expect(await asset.balanceOf(user.address)).to.equal(originalDsuBalance)

    const largeDeposit = utils.parseEther('20000')
    await vault.connect(user).deposit(largeDeposit, user.address)
    await expect(vault.connect(user).withdraw(largeDeposit, user.address, user.address))
  })

  it('maxWithdraw', async () => {
    const smallDeposit = utils.parseEther('500')
    await vault.connect(user).deposit(smallDeposit, user.address)
    await updateOracle()
    await vault.sync()

    expect(await vault.maxWithdraw(user.address)).to.equal(utils.parseEther('500'))

    const largeDeposit = utils.parseEther('10000')
    await vault.connect(user).deposit(largeDeposit, user.address)
    await updateOracle()
    await vault.sync()

    let totalDeposits = smallDeposit.add(largeDeposit)
    expect(await vault.maxWithdraw(user.address)).to.equal(totalDeposits.sub(utils.parseEther('500').mul(2)))

    const mediumDeposit = utils.parseEther('5000')
    await vault.connect(user).deposit(mediumDeposit, user.address)
    await updateOracle()
    await vault.sync()

    totalDeposits = smallDeposit.add(largeDeposit).add(mediumDeposit)
    const funding = BigNumber.from(54)
    const position = await longPosition()
    const minCollateral = Big6Math.div(Big6Math.mul(position, originalOraclePrice), maxLeverage).mul(2)

    expect(await vault.maxWithdraw(user.address)).to.equal(
      totalDeposits.add(funding.mul(1e12)).sub(minCollateral.mul(1e12)),
    )

    // We shouldn't be able to withdraw more than maxWithdraw.
    await expect(
      vault.connect(user).withdraw((await vault.maxWithdraw(user.address)).add(1), user.address, user.address),
    ).to.be.revertedWith('ERC4626: withdraw more than max')

    // But we should be able to withdraw exactly maxWithdraw.
    await vault.connect(user).withdraw(await vault.maxWithdraw(user.address), user.address, user.address)

    // The oracle price hasn't changed yet, so we shouldn't be able to withdraw any more.
    expect(await vault.maxWithdraw(user.address)).to.equal(0)

    // But if we update the oracle price, we should be able to withdraw the rest of our collateral.
    await updateOracle()
    await vault.sync()
    // Our collateral should be less than the fixedFloat and greater than 0.
    const totalCollateral = await totalCollateralInVault()
    expect(totalCollateral).to.equal('4999996956')

    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)
    expect(await vault.maxWithdraw(user.address)).to.equal(totalCollateral.mul(1e12))
    await vault.connect(user).withdraw(await vault.maxWithdraw(user.address), user.address, user.address)

    // We should have withdrawn all of our collateral.
    expect(await totalCollateralInVault()).to.equal(0)
  })

  it('maxDeposit', async () => {
    expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.mul(1e12))
    const depositSize = utils.parseEther('100000')

    await vault.connect(user).deposit(depositSize, user.address)
    expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.mul(1e12).sub(depositSize))

    await vault.connect(user2).deposit(utils.parseEther('100000'), user2.address)
    expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.mul(1e12).sub(depositSize).sub(depositSize))

    await vault.connect(liquidator).deposit(utils.parseEther('100000'), liquidator.address)
    expect(await vault.maxDeposit(user.address)).to.equal(0)

    await expect(vault.connect(liquidator).deposit(1, liquidator.address)).to.revertedWith(
      'ERC4626: deposit more than max',
    )
  })

  it('rebalances collateral', async () => {
    await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
    await updateOracle()
    await vault.sync()

    // Collaterals should be equal.
    expect(await longCollateralInVault()).to.equal(await shortCollateralInVault())

    await updateOracle(parse6decimal('1300'))
    await long.connect(user).settle(vault.address)
    await short.connect(user).settle(vault.address)

    // Collaterals should not be equal any more.
    expect(await longCollateralInVault()).to.not.equal(await shortCollateralInVault())

    await vault.sync()

    // Collaterals should be equal again!
    expect(await longCollateralInVault()).to.equal(await shortCollateralInVault())

    await updateOracle(originalOraclePrice)
    await vault.sync()

    // Since the price changed then went back to the original, the total collateral should have increased.
    expect(await totalCollateralInVault()).to.equal('100000001504')
  })

  it('rounds deposits correctly', async () => {
    const collateralDifference = async () => {
      return (await longCollateralInVault()).sub(await shortCollateralInVault()).abs()
    }
    const oddDepositAmount = utils.parseEther('10000').add(1e12) // 10K + 1 wei

    await vault.connect(user).deposit(oddDepositAmount, user.address)
    await updateOracle()
    await vault.sync()
    expect(await collateralDifference()).to.equal(0)

    await vault.connect(user).deposit(oddDepositAmount, user.address)
    await updateOracle()
    await vault.sync()
    expect(await collateralDifference()).to.equal(0)
  })

  describe('Liquidation', () => {
    it('recovers from a liquidation', async () => {
      await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
      await updateOracle()

      // 1. An oracle update makes the long position liquidatable.
      // We should still be able to deposit, although the deposit will sit in the vault for now.
      await updateOracle(parse6decimal('11000'))

      // TODO: perennial v2 doesn't allow updating position when collateral is still under maintenance
      // await vault.connect(user).deposit(2, user.address)
      // expect(await asset.balanceOf(vault.address)).to.equal(2)
      //
      // // 2. Settle accounts.
      // // We should still be able to deposit.
      // await long.connect(user).settle(vault.address)
      // await short.connect(user).settle(vault.address)
      // expect(await vault.connect(user).callStatic.deposit(parse6decimal('2'), user.address)).to.equal('1999999')
      //
      // // 3. Attempt to rebalance collateral. It won't succeed because rebalancing would also put the short
      // // position into a liquidatable state, but we still shouldn't revert.
      // // We should still be able to deposit.
      // await vault.sync()
      // expect(await vault.connect(user).callStatic.deposit(parse6decimal('2'), user.address)).to.equal('1999999')

      // 4. Liquidate the long position.
      // We should still be able to deposit.
      await long.connect(liquidator).liquidate(vault.address)
      // expect(await vault.connect(user).callStatic.deposit(parse6decimal('2'), user.address)).to.equal('1999999')

      // 5. Settle the liquidation.
      // We should still be able to deposit.
      await updateOracle()
      expect(await vault.connect(user).callStatic.deposit(parse6decimal('2'), user.address)).to.equal('2717490')
      await vault.sync()
      expect(await vault.connect(user).callStatic.deposit(parse6decimal('2'), user.address)).to.equal('2717490')

      // 6. Open the positions back up.
      await updateOracle()
      await vault.sync()

      expect(await longPosition()).to.equal(await shortPosition())
      expect(await longPosition()).to.equal(0)
      expect(await longCollateralInVault()).to.equal(await shortCollateralInVault())
      // The deposit that sat in the vault should now be in the collateral.
      expect(await asset.balanceOf(vault.address)).to.equal(0)
    })
  })
})
