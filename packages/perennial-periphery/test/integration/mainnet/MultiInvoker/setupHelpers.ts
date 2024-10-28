import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, utils, ContractTransaction, constants } from 'ethers'
import HRE from 'hardhat'

import { impersonate } from '../../../../../common/testutil'

import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IPayoffProvider,
  IPayoffProvider__factory,
  IOracleProvider,
  MultiInvoker,
  MultiInvoker__factory,
  Market,
  Market__factory,
  PowerTwo__factory,
  IMarket,
  IVault,
  IVaultFactory__factory,
  IVault__factory,
  VaultFactory,
  VaultFactory__factory,
  Vault__factory,
  OracleFactory,
  Oracle__factory,
  OracleFactory__factory,
  IOracle,
  IOracle__factory,
  IOracleFactory,
  MarketFactory,
  MarketFactory__factory,
} from '../../../../types/generated'
import { ChainlinkContext } from '@perennial/core/test/integration/helpers/chainlinkHelpers'
import { DEFAULT_ORACLE_RECEIPT, parse6decimal } from '../../../../../common/testutil/types'
import { CHAINLINK_CUSTOM_CURRENCIES } from '@perennial/oracle/util/constants'
import {
  MarketParameterStruct,
  RiskParameterStruct,
} from '../../../../types/generated/@perennial/core/contracts/Market'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { deployProductOnMainnetFork } from '@perennial/vault/test/integration/helpers/setupHelpers'
import {
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  IVerifier,
} from '@perennial/core/types/generated'
import { Verifier__factory } from '@perennial/core/types/generated'
import { deployMarketImplementation } from '../../../helpers/marketHelpers'

const { ethers } = HRE

export const ZERO_ADDR = ethers.utils.hexZeroPad('0x', 20)
export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'

export const BATCHER = '0xAEf566ca7E84d1E736f999765a804687f39D9094'
export const RESERVE = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'
export const ETH_ORACLE = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // chainlink eth oracle
export const DSU = '0x605D26FBd5be761089281d5cec2Ce86eeA667109'
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

const LEGACY_ORACLE_DELAY = 3600
const STARTING_TIMESTAMP = BigNumber.from(1646456563)

export interface InstanceVars {
  owner: SignerWithAddress
  pauser: SignerWithAddress
  user: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  beneficiaryB: SignerWithAddress
  proxyAdmin: ProxyAdmin
  oracleFactory: OracleFactory
  marketFactory: MarketFactory
  verifier: IVerifier
  payoff: IPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  usdcHolder: SignerWithAddress
  chainlink: ChainlinkContext
  oracle: IOracle
  marketImpl: Market
}

// TODO: parameterize DSU and USDC
export async function deployProtocol(chainlinkContext?: ChainlinkContext): Promise<InstanceVars> {
  const [owner, pauser, user, userB, userC, userD, beneficiaryB] = await ethers.getSigners()

  const payoff = IPayoffProvider__factory.connect((await new PowerTwo__factory(owner).deploy()).address, owner)
  const dsu = IERC20Metadata__factory.connect(DSU, owner)
  const usdc = IERC20Metadata__factory.connect(USDC, owner)

  const chainlink =
    chainlinkContext ??
    (await new ChainlinkContext(
      CHAINLINK_CUSTOM_CURRENCIES.ETH,
      CHAINLINK_CUSTOM_CURRENCIES.USD,
      { provider: payoff, decimals: -5 },
      1,
    ).init(BigNumber.from(0), BigNumber.from(0)))

  // Deploy protocol contracts
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()

  const oracleImpl = await new Oracle__factory(owner).deploy()

  const oracleFactoryImpl = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
  const oracleFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    oracleFactoryImpl.address,
    proxyAdmin.address,
    [],
  )
  const oracleFactory = new OracleFactory__factory(owner).attach(oracleFactoryProxy.address)

  const verifierImpl = await new Verifier__factory(owner).deploy()
  const verifierProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    verifierImpl.address,
    proxyAdmin.address,
    [],
  )
  const verifier = Verifier__factory.connect(verifierProxy.address, owner)

  const marketImpl = await deployMarketImplementation(owner, verifier.address)

  const factoryImpl = await new MarketFactory__factory(owner).deploy(
    oracleFactory.address,
    verifierImpl.address,
    marketImpl.address,
  )

  const factoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    factoryImpl.address,
    proxyAdmin.address,
    [],
  )

  const marketFactory = new MarketFactory__factory(owner).attach(factoryProxy.address)

  // Init
  await oracleFactory.connect(owner).initialize()
  await marketFactory.connect(owner).initialize()
  await verifier.connect(owner).initialize(marketFactory.address)

  // Params
  await marketFactory.updatePauser(pauser.address)
  await marketFactory.updateParameter({
    maxFee: parse6decimal('0.01'),
    maxLiquidationFee: parse6decimal('10'),
    maxCut: parse6decimal('0.50'),
    maxRate: parse6decimal('10.00'),
    minMaintenance: parse6decimal('0.01'),
    minEfficiency: parse6decimal('0.1'),
    referralFee: 0,
    minScale: parse6decimal('0.001'),
    maxStaleAfter: 7200,
  })
  await oracleFactory.connect(owner).register(chainlink.oracleFactory.address)
  const oracle = IOracle__factory.connect(
    await oracleFactory.connect(owner).callStatic.create(chainlink.id, chainlink.oracleFactory.address, 'ETH-USD'),
    owner,
  )
  await oracleFactory.connect(owner).create(chainlink.id, chainlink.oracleFactory.address, 'ETH-USD')

  // Set state
  await fundWallet(dsu, usdc, user)
  await fundWallet(dsu, usdc, userB)
  await fundWallet(dsu, usdc, userC)
  await fundWallet(dsu, usdc, userD)
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  await fundWalletUSDC(usdc, user)

  return {
    owner,
    pauser,
    user,
    userB,
    userC,
    userD,
    beneficiaryB,
    proxyAdmin,
    oracleFactory,
    marketFactory,
    verifier,
    chainlink,
    payoff,
    dsu,
    usdc,
    usdcHolder,
    oracle,
    marketImpl,
  }
}

export async function fundWallet(
  dsu: IERC20Metadata,
  usdc: IERC20Metadata,
  wallet: SignerWithAddress,
  amountOverride?: BigNumber,
): Promise<void> {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  await usdc.connect(usdcHolder).approve(RESERVE, amountOverride ? amountOverride : BigNumber.from('2000000000000'))
  await usdcHolder.sendTransaction({
    to: RESERVE,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [
      amountOverride ? amountOverride.mul(1e12) : utils.parseEther('2000000'),
    ]),
  })
  await dsu
    .connect(usdcHolder)
    .transfer(wallet.address, amountOverride ? amountOverride.mul(1e12) : utils.parseEther('2000000'))
}

export async function fundWalletUSDC(
  usdc: IERC20Metadata,
  wallet: SignerWithAddress,
  amountOverride?: BigNumber,
): Promise<void> {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  await usdc
    .connect(usdcHolder)
    .transfer(wallet.address, amountOverride ? amountOverride : BigNumber.from('1000000000'))
}

export async function settle(market: IMarket, account: SignerWithAddress): Promise<ContractTransaction> {
  return market
    .connect(account)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      account.address,
      constants.MaxUint256,
      constants.MaxUint256,
      constants.MaxUint256,
      0,
      false,
    )
}

export async function createVault(
  instanceVars: InstanceVars,
  leverage?: BigNumber,
  maxCollateral?: BigNumber,
): Promise<[IVault, VaultFactory, FakeContract<IOracleProvider>, FakeContract<IOracleProvider>]> {
  const ETH_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000001'
  const BTC_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000002'

  const [owner, , user, user2, btcUser1, btcUser2, liquidator, perennialUser] = await ethers.getSigners()
  const marketFactory = instanceVars.marketFactory
  const oracleFactory = instanceVars.oracleFactory

  const vaultOracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
  await oracleFactory.connect(owner).register(vaultOracleFactory.address)

  const ethSubOracle = await smock.fake<IOracleProvider>('IOracleProvider')
  resetEthSubOracle(ethSubOracle)

  const btcSubOracle = await smock.fake<IOracleProvider>('IOracleProvider')
  resetBtcSubOracle(btcSubOracle)

  vaultOracleFactory.instances.whenCalledWith(ethSubOracle.address).returns(true)
  vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(ethSubOracle.address)
  vaultOracleFactory.instances.whenCalledWith(btcSubOracle.address).returns(true)
  vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcSubOracle.address)

  const vaultFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    instanceVars.marketFactory.address, // dummy contract
    instanceVars.proxyAdmin.address,
    [],
  )

  vaultOracleFactory.instances.whenCalledWith(ethSubOracle.address).returns(true)
  vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(ethSubOracle.address)
  vaultOracleFactory.instances.whenCalledWith(btcSubOracle.address).returns(true)
  vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcSubOracle.address)

  const ethOracle = IOracle__factory.connect(
    await instanceVars.oracleFactory
      .connect(owner)
      .callStatic.create(ETH_PRICE_FEE_ID, vaultOracleFactory.address, 'ETH-USD'),
    owner,
  )
  await instanceVars.oracleFactory.connect(owner).create(ETH_PRICE_FEE_ID, vaultOracleFactory.address, 'ETH-USD')

  const btcOracle = IOracle__factory.connect(
    await instanceVars.oracleFactory
      .connect(owner)
      .callStatic.create(BTC_PRICE_FEE_ID, vaultOracleFactory.address, 'BTC-USD'),
    owner,
  )
  await instanceVars.oracleFactory.connect(owner).create(BTC_PRICE_FEE_ID, vaultOracleFactory.address, 'BTC-USD')

  const ethMarket = await deployProductOnMainnetFork({
    factory: marketFactory,
    token: instanceVars.dsu,
    owner: owner,
    oracle: ethOracle.address,
    payoff: constants.AddressZero,
    makerLimit: parse6decimal('1000'),
    minMaintenance: parse6decimal('50'),
    takerFee: {
      linearFee: 0,
      proportionalFee: 0,
      adiabaticFee: 0,
      scale: parse6decimal('100'),
    },
    makerFee: {
      linearFee: 0,
      proportionalFee: 0,
      scale: parse6decimal('100'),
    },
  })
  const btcMarket = await deployProductOnMainnetFork({
    factory: marketFactory,
    token: instanceVars.dsu,
    owner: owner,
    oracle: btcOracle.address,
    payoff: constants.AddressZero,
    makerLimit: parse6decimal('100'),
    minMaintenance: parse6decimal('50'),
    takerFee: {
      linearFee: 0,
      proportionalFee: 0,
      adiabaticFee: 0,
      scale: parse6decimal('10'),
    },
    makerFee: {
      linearFee: 0,
      proportionalFee: 0,
      scale: parse6decimal('10'),
    },
  })
  const vaultImpl = await new Vault__factory(owner).deploy()
  const vaultFactoryImpl = await new VaultFactory__factory(owner).deploy(
    instanceVars.marketFactory.address,
    vaultImpl.address,
    0,
  )

  await ethOracle.register(ethMarket.address)
  await btcOracle.register(btcMarket.address)

  await instanceVars.proxyAdmin.upgrade(vaultFactoryProxy.address, vaultFactoryImpl.address)
  const vaultFactory = IVaultFactory__factory.connect(vaultFactoryProxy.address, owner)
  await vaultFactory.initialize()
  const vault = IVault__factory.connect(
    await vaultFactory.callStatic.create(instanceVars.dsu.address, ethMarket.address, 'Blue Chip'),
    owner,
  )
  await vaultFactory.create(instanceVars.dsu.address, ethMarket.address, 'Blue Chip')

  await vault.register(btcMarket.address)
  await vault.updateLeverage(0, leverage ?? parse6decimal('4.0'))
  await vault.updateLeverage(1, leverage ?? parse6decimal('4.0'))
  await vault.updateWeights([parse6decimal('0.8'), parse6decimal('0.2')])

  await vault.updateParameter({
    maxDeposit: maxCollateral ?? parse6decimal('500000'),
    minDeposit: 0,
  })
  const usdc = IERC20Metadata__factory.connect(USDC, owner)
  const asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

  await asset.connect(liquidator).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(perennialUser).approve(vault.address, ethers.constants.MaxUint256)
  await fundWallet(asset, usdc, liquidator)
  await fundWallet(asset, usdc, perennialUser)
  await fundWallet(asset, usdc, perennialUser)
  await fundWallet(asset, usdc, perennialUser)
  await fundWallet(asset, usdc, perennialUser)
  await fundWallet(asset, usdc, perennialUser)
  await fundWallet(asset, usdc, perennialUser)
  await fundWallet(asset, usdc, perennialUser)
  await asset.connect(user).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(user2).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(btcUser1).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(btcUser2).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(user).approve(ethMarket.address, ethers.constants.MaxUint256)
  await asset.connect(user2).approve(ethMarket.address, ethers.constants.MaxUint256)
  await asset.connect(btcUser1).approve(btcMarket.address, ethers.constants.MaxUint256)
  await asset.connect(btcUser2).approve(btcMarket.address, ethers.constants.MaxUint256)

  // Seed markets with some activity
  await ethMarket
    .connect(user)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      user.address,
      parse6decimal('100'),
      0,
      0,
      parse6decimal('100000'),
      false,
    )
  await ethMarket
    .connect(user2)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      user2.address,
      0,
      parse6decimal('50'),
      0,
      parse6decimal('100000'),
      false,
    )
  await btcMarket
    .connect(btcUser1)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      btcUser1.address,
      parse6decimal('20'),
      0,
      0,
      parse6decimal('100000'),
      false,
    )
  await btcMarket
    .connect(btcUser2)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      btcUser2.address,
      0,
      parse6decimal('10'),
      0,
      parse6decimal('100000'),
      false,
    )

  return [vault, vaultFactory, ethSubOracle, btcSubOracle]
}

export function resetEthSubOracle(ethSubOracle: FakeContract<IOracleProvider>) {
  const ethRealVersion = {
    timestamp: STARTING_TIMESTAMP,
    price: BigNumber.from('2620237388'),
    valid: true,
  }

  ethSubOracle.status.returns([ethRealVersion, ethRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
  ethSubOracle.request.returns()
  ethSubOracle.latest.returns(ethRealVersion)
  ethSubOracle.current.returns(ethRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
  ethSubOracle.at.whenCalledWith(ethRealVersion.timestamp).returns([ethRealVersion, DEFAULT_ORACLE_RECEIPT])
}

export function resetBtcSubOracle(btcSubOracle: FakeContract<IOracleProvider>) {
  const btcRealVersion = {
    timestamp: STARTING_TIMESTAMP,
    price: BigNumber.from('38838362695'),
    valid: true,
  }

  btcSubOracle.status.returns([btcRealVersion, btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
  btcSubOracle.request.returns()
  btcSubOracle.latest.returns(btcRealVersion)
  btcSubOracle.current.returns(btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
  btcSubOracle.at.whenCalledWith(btcRealVersion.timestamp).returns([btcRealVersion, DEFAULT_ORACLE_RECEIPT])
}

export async function createInvoker(
  instanceVars: InstanceVars,
  vaultFactory?: VaultFactory,
  noBatcher?: boolean,
): Promise<MultiInvoker> {
  const { owner, user, userB } = instanceVars

  const multiInvoker = await new MultiInvoker__factory(owner).deploy(
    USDC,
    DSU,
    instanceVars.marketFactory.address,
    vaultFactory ? vaultFactory.address : ZERO_ADDR,
    noBatcher ? ZERO_ADDR : BATCHER,
    DSU_MINTER,
    500_000,
    500_000,
  )

  await instanceVars.marketFactory.connect(user).updateOperator(multiInvoker.address, true)
  await instanceVars.marketFactory.connect(userB).updateOperator(multiInvoker.address, true)
  if (vaultFactory) {
    await vaultFactory.connect(user).updateOperator(multiInvoker.address, true)
    await vaultFactory.connect(userB).updateOperator(multiInvoker.address, true)
  }
  await multiInvoker.initialize(ETH_ORACLE)

  return multiInvoker
}
