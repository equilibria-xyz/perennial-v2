import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, ContractTransaction, constants } from 'ethers'
import { Address } from 'hardhat-deploy/dist/types'
import { FakeContract, smock } from '@defi-wonderland/smock'
import HRE from 'hardhat'

import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IPayoffProvider,
  IPayoffProvider__factory,
  IOracleProvider,
  MultiInvoker,
  MultiInvoker__factory,
  Market,
  PowerTwo__factory,
  IMarket,
  IVault,
  IVaultFactory__factory,
  IVault__factory,
  VaultFactory,
  VaultFactory__factory,
  MakerVault__factory,
  OracleFactory,
  Oracle__factory,
  OracleFactory__factory,
  IOracle,
  IOracle__factory,
  IOracleFactory,
  MarketFactory,
  MarketFactory__factory,
  IBatcher,
  IEmptySetReserve,
  IBatcher__factory,
  IEmptySetReserve__factory,
  ISolverVault,
} from '../../../../types/generated'
import { DEFAULT_ORACLE_RECEIPT, parse6decimal } from '../../../../../common/testutil/types'

import { deployProductOnFork } from '@perennial/v2-vault/test/integration/helpers/setupHelpers'
import {
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  IVerifier,
  AggregatorV3Interface,
  AggregatorV3Interface__factory,
} from '@perennial/v2-core/types/generated'
import { Verifier__factory } from '@perennial/v2-core/types/generated'
import { deployMarketImplementation } from '../../../helpers/marketHelpers'
import { OracleVersionStruct } from '@perennial/v2-oracle/types/generated/contracts/Oracle'

const { ethers } = HRE

const LEGACY_ORACLE_DELAY = 3600

export interface InstanceVars {
  owner: SignerWithAddress
  pauser: SignerWithAddress
  user: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  proxyAdmin: ProxyAdmin
  oracleFactory: OracleFactory
  marketFactory: MarketFactory
  verifier: IVerifier
  payoff: IPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  dsuReserve: IEmptySetReserve
  dsuBatcher: IBatcher | undefined
  chainlinkKeptFeed: AggregatorV3Interface
  oracle: IOracle
  marketImpl: Market
}

// used to pass Verifyable Action Approvals to MultiInvoker Pyth tests
export interface PythVAAVars {
  startingTime: number
  vaaValid: string
  vaaInvalid: string
}

export async function deployProtocol(
  dsu: IERC20Metadata,
  usdc: IERC20Metadata,
  dsuBatcherAddress: Address,
  dsuReserveAddress: Address,
  chainlinkKeptFeedAddress: Address,
): Promise<InstanceVars> {
  const [owner, pauser, user, userB, userC, userD] = await ethers.getSigners()

  const payoff = IPayoffProvider__factory.connect((await new PowerTwo__factory(owner).deploy()).address, owner)

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

  return {
    owner,
    pauser,
    user,
    userB,
    userC,
    userD,
    proxyAdmin,
    oracleFactory,
    marketFactory,
    verifier,
    chainlinkKeptFeed: AggregatorV3Interface__factory.connect(chainlinkKeptFeedAddress, owner),
    payoff,
    dsu,
    usdc,
    dsuBatcher:
      dsuBatcherAddress === constants.AddressZero ? undefined : IBatcher__factory.connect(dsuBatcherAddress, owner),
    dsuReserve: IEmptySetReserve__factory.connect(dsuReserveAddress, owner),
    oracle: oracleImpl, // placeholder until real oracle is deployed in chain-specific test setup
    marketImpl,
  }
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
  vaultImpl: IVault | ISolverVault,
  initialOracleVersionEth: OracleVersionStruct,
  initialOracleVersionBtc: OracleVersionStruct,
  ethPriceFeedId?: string,
  btcPriceFeedId?: string,
  leverage?: BigNumber,
  maxCollateral?: BigNumber,
): Promise<[IVault, VaultFactory, FakeContract<IOracleProvider>, FakeContract<IOracleProvider>]> {
  const ETH_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000001'
  const BTC_PRICE_FEE_ID = '0x0000000000000000000000000000000000000000000000000000000000000002'

  const [owner, , user, userB, userC, userD, liquidator, perennialUser] = await ethers.getSigners()
  const marketFactory = instanceVars.marketFactory
  const oracleFactory = instanceVars.oracleFactory

  const vaultOracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
  await oracleFactory.connect(owner).register(vaultOracleFactory.address)

  // TODO: Do we still want to fake the sub-oracle implementation on Arbitrum?
  const ethSubOracle = await smock.fake<IOracleProvider>('IOracleProvider')
  resetSubOracle(ethSubOracle, initialOracleVersionEth)

  const btcSubOracle = await smock.fake<IOracleProvider>('IOracleProvider')
  resetSubOracle(btcSubOracle, initialOracleVersionBtc)

  vaultOracleFactory.instances.whenCalledWith(ethSubOracle.address).returns(true)
  vaultOracleFactory.oracles.whenCalledWith(ethPriceFeedId ?? ETH_PRICE_FEE_ID).returns(ethSubOracle.address)
  vaultOracleFactory.instances.whenCalledWith(btcSubOracle.address).returns(true)
  vaultOracleFactory.oracles.whenCalledWith(btcPriceFeedId ?? BTC_PRICE_FEE_ID).returns(btcSubOracle.address)

  const vaultFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    instanceVars.marketFactory.address, // dummy contract
    instanceVars.proxyAdmin.address,
    [],
  )

  vaultOracleFactory.instances.whenCalledWith(ethSubOracle.address).returns(true)
  vaultOracleFactory.oracles.whenCalledWith(ethPriceFeedId ?? ETH_PRICE_FEE_ID).returns(ethSubOracle.address)
  vaultOracleFactory.instances.whenCalledWith(btcSubOracle.address).returns(true)
  vaultOracleFactory.oracles.whenCalledWith(btcPriceFeedId ?? BTC_PRICE_FEE_ID).returns(btcSubOracle.address)

  const ethOracle = IOracle__factory.connect(
    await instanceVars.oracleFactory
      .connect(owner)
      .callStatic.create(ethPriceFeedId ?? ETH_PRICE_FEE_ID, vaultOracleFactory.address, 'ETH-USD'),
    owner,
  )
  await instanceVars.oracleFactory
    .connect(owner)
    .create(ethPriceFeedId ?? ETH_PRICE_FEE_ID, vaultOracleFactory.address, 'ETH-USD')

  const btcOracle = IOracle__factory.connect(
    await instanceVars.oracleFactory
      .connect(owner)
      .callStatic.create(btcPriceFeedId ?? BTC_PRICE_FEE_ID, vaultOracleFactory.address, 'BTC-USD'),
    owner,
  )
  await instanceVars.oracleFactory
    .connect(owner)
    .create(btcPriceFeedId ?? BTC_PRICE_FEE_ID, vaultOracleFactory.address, 'BTC-USD')

  const ethMarket = await deployProductOnFork({
    factory: marketFactory,
    token: instanceVars.dsu,
    owner: owner,
    oracle: ethOracle.address,
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
  const btcMarket = await deployProductOnFork({
    factory: marketFactory,
    token: instanceVars.dsu,
    owner: owner,
    oracle: btcOracle.address,
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
    profitShare: 0,
  })
  const asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

  await asset.connect(liquidator).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(perennialUser).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(user).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(userB).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(userC).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(userD).approve(vault.address, ethers.constants.MaxUint256)
  await asset.connect(user).approve(ethMarket.address, ethers.constants.MaxUint256)
  await asset.connect(userB).approve(ethMarket.address, ethers.constants.MaxUint256)
  await asset.connect(userC).approve(btcMarket.address, ethers.constants.MaxUint256)
  await asset.connect(userD).approve(btcMarket.address, ethers.constants.MaxUint256)

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
    .connect(userB)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      userB.address,
      0,
      parse6decimal('50'),
      0,
      parse6decimal('100000'),
      false,
    )
  await btcMarket
    .connect(userC)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      userC.address,
      parse6decimal('20'),
      0,
      0,
      parse6decimal('100000'),
      false,
    )
  await btcMarket
    .connect(userD)
    ['update(address,uint256,uint256,uint256,int256,bool)'](
      userD.address,
      0,
      parse6decimal('10'),
      0,
      parse6decimal('100000'),
      false,
    )

  return [vault, vaultFactory, ethSubOracle, btcSubOracle]
}

export function resetSubOracle(subOracle: FakeContract<IOracleProvider>, realVersion: OracleVersionStruct) {
  subOracle.status.returns([realVersion, realVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
  subOracle.request.returns()
  subOracle.latest.returns(realVersion)
  subOracle.current.returns(realVersion.timestamp.add(LEGACY_ORACLE_DELAY))
  subOracle.at.whenCalledWith(realVersion.timestamp).returns([realVersion, DEFAULT_ORACLE_RECEIPT])
}

export async function createInvoker(
  instanceVars: InstanceVars,
  makerVaultFactory?: VaultFactory,
  solverVaultFactory?: VaultFactory,
  withBatcher = false,
): Promise<MultiInvoker> {
  const { owner, user, userB } = instanceVars

  const multiInvoker = await new MultiInvoker__factory(owner).deploy(
    instanceVars.usdc.address,
    instanceVars.dsu.address,
    instanceVars.marketFactory.address,
    makerVaultFactory ? makerVaultFactory.address : constants.AddressZero,
    solverVaultFactory ? solverVaultFactory.address : constants.AddressZero,
    withBatcher && instanceVars.dsuBatcher ? instanceVars.dsuBatcher.address : constants.AddressZero,
    instanceVars.dsuReserve.address,
    500_000,
    500_000,
  )

  await instanceVars.marketFactory.connect(user).updateOperator(multiInvoker.address, true)
  await instanceVars.marketFactory.connect(userB).updateOperator(multiInvoker.address, true)
  if (makerVaultFactory) {
    await makerVaultFactory.connect(user).updateOperator(multiInvoker.address, true)
    await makerVaultFactory.connect(userB).updateOperator(multiInvoker.address, true)
  }
  if (solverVaultFactory) {
    await solverVaultFactory.connect(user).updateOperator(multiInvoker.address, true)
    await solverVaultFactory.connect(userB).updateOperator(multiInvoker.address, true)
  }
  await multiInvoker.initialize(instanceVars.chainlinkKeptFeed.address)

  return multiInvoker
}
