import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { utils, BigNumber, constants } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import {
  ArbGasInfo,
  IERC20Metadata,
  IERC20Metadata__factory,
  Market__factory,
  MarketFactory,
  MarketFactory__factory,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  IMarket,
  KeeperOracle__factory,
  KeeperOracle,
  MetaQuantsFactory__factory,
  MetaQuantsFactory,
  PowerTwo__factory,
  PowerTwo,
  CheckpointLib__factory,
  CheckpointStorageLib__factory,
  GlobalStorageLib__factory,
  InvariantLib__factory,
  MarketParameterStorageLib__factory,
  PositionStorageGlobalLib__factory,
  PositionStorageLocalLib__factory,
  RiskParameterStorageLib__factory,
  GuaranteeStorageGlobalLib__factory,
  GuaranteeStorageLocalLib__factory,
  OrderStorageGlobalLib__factory,
  OrderStorageLocalLib__factory,
  VersionLib__factory,
  VersionStorageLib__factory,
  GasOracle,
  GasOracle__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { smock } from '@defi-wonderland/smock'

const { ethers } = HRE

const METAQUANTS_BAYC_ETH_PRICE_FEED = '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
const METAQUANTS_MILADY_ETH_PRICE_FEED = '0x0000000000000000000000005af0d9827e0c53e4799bb226655a1de152a425a5'
const DSU_ADDRESS = '0x605D26FBd5be761089281d5cec2Ce86eeA667109'
const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DSU_HOLDER = '0x2d264EBDb6632A06A1726193D4d37FeF1E5dbDcd'
const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

interface UpdateAndSignature {
  update: string
  signature: string
}

const listify = (...payload: UpdateAndSignature[]) => {
  const encodedUpdateAndSignatureList = payload.map(({ update, signature }) => {
    return {
      encodedUpdate: update,
      signature: signature,
    }
  })

  return ethers.utils.defaultAbiCoder.encode(
    ['tuple(bytes encodedUpdate, bytes signature)[]'],
    [encodedUpdateAndSignatureList],
  )
}

const STARTING_TIME = 1705687944 - 6

const SIGNER = '0xE744e2422c2497b1bb7e921a903fd457A2bA1F5F'

// This payload has timestamp STARTING_TIME + 6
const PAYLOAD: UpdateAndSignature = {
  update:
    '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d0000000000000000000000000000000000000000000000000000000000005ea60000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabb8800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0x4f4b70a2c81f202c31d65a6b0fbca72c3dcddc202842add63b0c997d6a4120ce3162ec0016db444122d8baa64e984412151e48f3bba3ef53aba57ea5dac6a1a91c',
}

// This payload has timestamp STARTING_TIME + 8
const OTHER_PAYLOAD: UpdateAndSignature = {
  update:
    '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d0000000000000000000000000000000000000000000000000000000000005e940000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabb8a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0x41e4472fd5967cc5d68b504e773e2a25b9c7352ff26cf48acc15554144feea3256bedee9d18e8c23d49792bc9210793e5dbcdf023c37d3083337272c81fba4bd1b',
}

// This payload has timestamp STARTING_TIME + 3
const PAYLOAD_BARELY_TOO_EARLY: UpdateAndSignature = {
  update:
    '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d0000000000000000000000000000000000000000000000000000000000005e940000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabb8500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0xd72fe982bafe577d6fc79ecb3d9c27c6f80fefa7b67b7012f04054821be475e9793d409b45977e00e4fb722e06aebbca1d9f1c00db487776a6071247bc5a8f0c1b',
}

// This payload has timestamp STARTING_TIME + 4
const PAYLOAD_BARELY_NOT_TOO_EARLY: UpdateAndSignature = {
  update:
    '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d0000000000000000000000000000000000000000000000000000000000005e940000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabb8600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0x60001b583f7c6fe271ea8376d316c99a2e88ae349b90f1d85eeebd955ebc8bb46344700a7684e0655e2a81dac6676468a3231413a5df21f2b72463bd057ae1421c',
}

// This payload has timestamp STARTING_TIME + 10
const PAYLOAD_BARELY_NOT_TOO_LATE: UpdateAndSignature = {
  update:
    '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d0000000000000000000000000000000000000000000000000000000000005e940000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabb8c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0x49747647eeae8f830376ef50947466ac016d8a1dba528e28bbf705b10fb059c60ffd3bfe408d6c2345acfbf9ffcf6266b0c909482bd10dca7e55bfbc6f89b4961b',
}

// This payload has timestamp STARTING_TIME + 11
const PAYLOAD_BARELY_TOO_LATE: UpdateAndSignature = {
  update:
    '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d0000000000000000000000000000000000000000000000000000000000005e940000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabb8d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0x2223ae549c35ff5a8816586618491b507a8fe18ab788a96522351e67ccfa5adf2236e6449f85b432fd1bfefc8f1565107c4d0885707f3ce1c540d4b2e0be07451b',
}

// This payload has timestamp STARTING_TIME + 65
const PAYLOAD_AFTER_EXPIRATION: UpdateAndSignature = {
  update:
    '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d0000000000000000000000000000000000000000000000000000000000005e940000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabbc300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0x26890f8b8a348447e39d72582bf2f483d630e1706d3a70ffb445e5b39e4aa8d81f2def0cfc6e82a529816902921821ef80684bf2e005e05aa03fe96f7b2df53f1c',
}

// This payload has timestamp STARTING_TIME + 165
const PAYLOAD_WAY_AFTER_EXPIRATION: UpdateAndSignature = {
  update:
    '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d0000000000000000000000000000000000000000000000000000000000005e940000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabc2700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0xbee9118734f64f5506a2a41c8b9aec7206976243589e0cd5a65c03e896f27d0e463741a320cefd853f1b32ffa975dae2d2705d8be84112e2bbe7f03020c954601b',
}

// This payload has the same timestamp as PAYLOAD.
const PAYLOAD_MILADY: UpdateAndSignature = {
  update:
    '0x0000000000000000000000005af0d9827e0c53e4799bb226655a1de152a425a500000000000000000000000000000000000000000000000000000000000009190000000000000000000000000000000000000000000000000000000000000000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffd0000000000000000000000000000000000000000000000000000000065aabb8800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  signature:
    '0x8aaf5180b6f87835f3031fefecd2a7df2cb7098db4c947ae6caab52eaaebb628685608f3dc31f4baa7cf1c63c37fda23b5122f10881b75dfaf410830707ce5af1b',
}

const getPrices = (data: string) => {
  const payloads = ethers.utils.defaultAbiCoder.decode(['tuple(bytes encodedUpdate, bytes signature)[]'], data)[0]
  const prices: BigNumber[] = []
  for (const payload of payloads) {
    const update = payload.encodedUpdate
    const report = ethers.utils.defaultAbiCoder.decode(
      [
        'tuple(bytes32 id, tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime) price, tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime) emaPrice)',
      ],
      update,
    )[0]

    prices.push(BigNumber.from(report.price.price).mul(BigNumber.from(10).pow(6 + report.price.expo)))
  }
  return prices
}

export async function fundWallet(dsu: IERC20Metadata, wallet: SignerWithAddress): Promise<void> {
  const dsuMinter = await impersonateWithBalance(DSU_MINTER, utils.parseEther('10'))
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  await dsuMinter.sendTransaction({
    to: dsu.address,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [utils.parseEther('200000')]),
  })
  await dsu.connect(dsuMinter).transfer(wallet.address, utils.parseEther('200000'))
}

const testOracles = [
  {
    name: 'MetaQuantsOracleFactory',
    Oracle: KeeperOracle__factory,
    gasMock: async () => {
      const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
        address: '0x000000000000000000000000000000000000006C',
      })
      gasInfo.getL1BaseFeeEstimate.returns(0)
    },
  },
]

testOracles.forEach(testOracle => {
  describe(testOracle.name, () => {
    let owner: SignerWithAddress
    let user: SignerWithAddress
    let commitmentGasOracle: GasOracle
    let settlementGasOracle: GasOracle
    let oracle: Oracle
    let oracleMilady: Oracle
    let keeperOracle: KeeperOracle
    let keeperOracleMilady: KeeperOracle
    let metaquantsOracleFactory: MetaQuantsFactory
    let oracleFactory: OracleFactory
    let marketFactory: MarketFactory
    let market: IMarket
    let marketMilady: IMarket
    let dsu: IERC20Metadata
    let oracleSigner: SignerWithAddress
    let factorySigner: SignerWithAddress
    let powerTwoPayoff: PowerTwo

    const fixture = async () => {
      await time.reset()
      ;[owner, user] = await ethers.getSigners()

      dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
      await fundWallet(dsu, user)

      powerTwoPayoff = await new PowerTwo__factory(owner).deploy()

      const oracleImpl = await new Oracle__factory(owner).deploy()
      oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
      await oracleFactory.initialize()
      await oracleFactory.connect(owner).updateParameter({
        maxGranularity: 10000,
        maxSettlementFee: parse6decimal('1000'),
        maxOracleFee: parse6decimal('0.5'),
      })

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

      const keeperOracleImpl = await new testOracle.Oracle(owner).deploy(60)
      metaquantsOracleFactory = await new MetaQuantsFactory__factory(owner).deploy(
        SIGNER,
        commitmentGasOracle.address,
        settlementGasOracle.address,
        'SignedPriceFactory',
        keeperOracleImpl.address,
      )
      await metaquantsOracleFactory.initialize(oracleFactory.address)
      await oracleFactory.register(metaquantsOracleFactory.address)
      await metaquantsOracleFactory.register(powerTwoPayoff.address)

      keeperOracle = testOracle.Oracle.connect(
        await metaquantsOracleFactory.callStatic.create(
          METAQUANTS_BAYC_ETH_PRICE_FEED,
          METAQUANTS_BAYC_ETH_PRICE_FEED,
          { provider: ethers.constants.AddressZero, decimals: 0 },
        ),
        owner,
      )
      await metaquantsOracleFactory.create(METAQUANTS_BAYC_ETH_PRICE_FEED, METAQUANTS_BAYC_ETH_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })
      keeperOracleMilady = testOracle.Oracle.connect(
        await metaquantsOracleFactory.callStatic.create(
          METAQUANTS_MILADY_ETH_PRICE_FEED,
          METAQUANTS_MILADY_ETH_PRICE_FEED,
          { provider: ethers.constants.AddressZero, decimals: 0 },
        ),
        owner,
      )
      await metaquantsOracleFactory.create(METAQUANTS_MILADY_ETH_PRICE_FEED, METAQUANTS_MILADY_ETH_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })

      oracle = Oracle__factory.connect(
        await oracleFactory.callStatic.create(
          METAQUANTS_BAYC_ETH_PRICE_FEED,
          metaquantsOracleFactory.address,
          'BAYC-USD',
        ),
        owner,
      )
      await oracleFactory.create(METAQUANTS_BAYC_ETH_PRICE_FEED, metaquantsOracleFactory.address, 'BAYC-USD')
      oracleMilady = Oracle__factory.connect(
        await oracleFactory.callStatic.create(
          METAQUANTS_MILADY_ETH_PRICE_FEED,
          metaquantsOracleFactory.address,
          'MILADY-USD',
        ),
        owner,
      )
      await oracleFactory.create(METAQUANTS_MILADY_ETH_PRICE_FEED, metaquantsOracleFactory.address, 'MILADY-USD')

      const verifierImpl = await new VersionStorageLib__factory(owner).deploy()

      const marketImpl = await new Market__factory(
        {
          '@perennial/v2-core/contracts/libs/CheckpointLib.sol:CheckpointLib': (
            await new CheckpointLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/libs/InvariantLib.sol:InvariantLib': (
            await new InvariantLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/libs/VersionLib.sol:VersionLib': (
            await new VersionLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Checkpoint.sol:CheckpointStorageLib': (
            await new CheckpointStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Global.sol:GlobalStorageLib': (
            await new GlobalStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
            await new MarketParameterStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Position.sol:PositionStorageGlobalLib': (
            await new PositionStorageGlobalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Position.sol:PositionStorageLocalLib': (
            await new PositionStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
            await new RiskParameterStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Version.sol:VersionStorageLib': (
            await new VersionStorageLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Guarantee.sol:GuaranteeStorageLocalLib': (
            await new GuaranteeStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Guarantee.sol:GuaranteeStorageGlobalLib': (
            await new GuaranteeStorageGlobalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Order.sol:OrderStorageLocalLib': (
            await new OrderStorageLocalLib__factory(owner).deploy()
          ).address,
          '@perennial/v2-core/contracts/types/Order.sol:OrderStorageGlobalLib': (
            await new OrderStorageGlobalLib__factory(owner).deploy()
          ).address,
        },
        owner,
      ).deploy(verifierImpl.address)
      marketFactory = await new MarketFactory__factory(owner).deploy(
        oracleFactory.address,
        verifierImpl.address,
        marketImpl.address,
      )
      await marketFactory.initialize()
      await marketFactory.updateParameter({
        maxFee: parse6decimal('0.01'),
        maxLiquidationFee: parse6decimal('5'),
        maxCut: parse6decimal('0.50'),
        maxRate: parse6decimal('10.00'),
        minMaintenance: parse6decimal('0.01'),
        minEfficiency: parse6decimal('0.1'),
        referralFee: 0,
        minScale: parse6decimal('0.001'),
        maxStaleAfter: 7200,
      })

      const riskParameter = {
        margin: parse6decimal('0.3'),
        maintenance: parse6decimal('0.3'),
        takerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('100'),
        },
        makerFee: {
          linearFee: 0,
          proportionalFee: 0,
          adiabaticFee: 0,
          scale: parse6decimal('100'),
        },
        makerLimit: parse6decimal('1000'),
        efficiencyLimit: parse6decimal('0.2'),
        liquidationFee: parse6decimal('0.50'),
        minLiquidationFee: parse6decimal('0'),
        maxLiquidationFee: parse6decimal('5'),
        utilizationCurve: {
          minRate: 0,
          maxRate: parse6decimal('5.00'),
          targetRate: parse6decimal('0.80'),
          targetUtilization: parse6decimal('0.80'),
        },
        pController: {
          k: parse6decimal('40000'),
          min: parse6decimal('-1.20'),
          max: parse6decimal('1.20'),
        },
        minMargin: parse6decimal('5'),
        minMaintenance: parse6decimal('5'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }
      const marketParameter = {
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        oracleFee: 0,
        riskFee: 0,
        makerFee: 0,
        takerFee: 0,
        maxPendingGlobal: 8,
        maxPendingLocal: 8,
        maxPriceDeviation: parse6decimal('0.1'),
        closed: false,
        settle: false,
      }
      market = Market__factory.connect(
        await marketFactory.callStatic.create({
          token: dsu.address,
          oracle: oracle.address,
        }),
        owner,
      )
      await marketFactory.create({
        token: dsu.address,
        oracle: oracle.address,
      })
      await market.updateParameter(marketParameter)
      await market.updateRiskParameter(riskParameter)
      marketMilady = Market__factory.connect(
        await marketFactory.callStatic.create({
          token: dsu.address,
          oracle: oracleMilady.address,
        }),
        owner,
      )
      await marketFactory.create({
        token: dsu.address,
        oracle: oracleMilady.address,
      })
      await marketMilady.updateParameter(marketParameter)
      await marketMilady.updateRiskParameter(riskParameter)

      await keeperOracle.register(oracle.address)
      await oracle.register(market.address)
      await keeperOracleMilady.register(oracleMilady.address)
      await oracleMilady.register(marketMilady.address)

      oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))
      factorySigner = await impersonateWithBalance(metaquantsOracleFactory.address, utils.parseEther('10'))

      await dsu.connect(user).approve(market.address, constants.MaxUint256)

      const dsuHolder = await impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
      await dsu.connect(dsuHolder).transfer(oracleFactory.address, utils.parseEther('10000'))

      await testOracle.gasMock()
    }

    beforeEach(async () => {
      await loadFixture(fixture)
      await time.increaseTo(STARTING_TIME - 2)

      // block.timestamp of the next call will be STARTING_TIME

      // set the oracle parameters at STARTING_TIME - 1
      await time.includeAt(async () => {
        await metaquantsOracleFactory.updateParameter(1, parse6decimal('0.1'), 4, 10)
        await metaquantsOracleFactory.commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME - 1, listify(PAYLOAD))
      }, STARTING_TIME - 1)

      // run tests at STARTING_TIME
    })

    afterEach(async () => {
      await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    })

    describe('Factory', async () => {
      it('factoryType is set', async () => {
        expect(await metaquantsOracleFactory.factoryType()).to.equal('SignedPriceFactory')
      })

      context('#initialize', async () => {
        it('reverts if already initialized', async () => {
          const metaquantsOracleFactory2 = await new MetaQuantsFactory__factory(owner).deploy(
            SIGNER,
            commitmentGasOracle.address,
            settlementGasOracle.address,
            'SignedPriceFactory',
            await metaquantsOracleFactory.implementation(),
          )
          await metaquantsOracleFactory2.initialize(oracleFactory.address)
          await expect(metaquantsOracleFactory2.initialize(oracleFactory.address))
            .to.be.revertedWithCustomError(metaquantsOracleFactory2, 'InitializableAlreadyInitializedError')
            .withArgs(1)
        })
      })

      context('#create', async () => {
        it('cant recreate price id', async () => {
          await expect(
            metaquantsOracleFactory.create(METAQUANTS_BAYC_ETH_PRICE_FEED, METAQUANTS_BAYC_ETH_PRICE_FEED, {
              provider: ethers.constants.AddressZero,
              decimals: 0,
            }),
          ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryAlreadyCreatedError')
        })

        it('cant recreate invalid price id', async () => {
          await expect(
            metaquantsOracleFactory.create(
              METAQUANTS_BAYC_ETH_PRICE_FEED,
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              { provider: ethers.constants.AddressZero, decimals: 0 },
            ),
          ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryAlreadyCreatedError')
        })

        it('reverts when not owner', async () => {
          await expect(
            metaquantsOracleFactory
              .connect(user)
              .create(METAQUANTS_BAYC_ETH_PRICE_FEED, METAQUANTS_BAYC_ETH_PRICE_FEED, {
                provider: ethers.constants.AddressZero,
                decimals: 0,
              }),
          ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'OwnableNotOwnerError')
        })
      })
    })

    describe('#commit', async () => {
      it('commits successfully and incentivizes the keeper', async () => {
        await time.includeAt(
          async () =>
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                1,
                0,
                0,
                parse6decimal('10'),
                false,
              ),
          STARTING_TIME,
        )
        expect(await keeperOracle.localCallbacks(STARTING_TIME)).to.deep.eq([user.address])

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD), { maxFeePerGas: 100000000 }),
        )
          .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
          .withArgs([STARTING_TIME, getPrices(listify(PAYLOAD))[0], true])

        const reward = utils.parseEther('0.370586')
        expect(await dsu.balanceOf(user.address)).to.be.equal(
          utils.parseEther('200000').sub(utils.parseEther('10')).add(reward),
        )

        expect((await market.position()).timestamp).to.equal(STARTING_TIME)
      })

      it('does not allow committing with invalid signature', async () => {
        await time.includeAt(
          async () =>
            await market
              .connect(user)
              ['update(address,uint256,uint256,uint256,int256,bool)'](
                user.address,
                1,
                0,
                0,
                parse6decimal('10'),
                false,
              ),
          STARTING_TIME,
        )

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.requests(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          metaquantsOracleFactory.connect(user).commit(
            [METAQUANTS_BAYC_ETH_PRICE_FEED],
            STARTING_TIME,
            listify({
              update: PAYLOAD.update,
              signature: PAYLOAD.signature.replace('1', '2'),
            }),
          ),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'MetaQuantsFactoryInvalidSignatureError')
      })

      it('does not allow mismatched ids', async () => {
        // Don't allow extra IDs.
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit(
              [METAQUANTS_BAYC_ETH_PRICE_FEED, METAQUANTS_MILADY_ETH_PRICE_FEED],
              STARTING_TIME,
              listify(PAYLOAD),
            ),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'MetaQuantsFactoryInputLengthMismatchError')

        // Don't allow too few IDs.
        await expect(
          metaquantsOracleFactory.connect(user).commit([], STARTING_TIME, listify(PAYLOAD)),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'MetaQuantsFactoryInputLengthMismatchError')

        // Don't allow incorrect ID.
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_MILADY_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD)),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'MetaQuantsFactoryInvalidIdError')
      })

      it('can update multiple from batched update', async () => {
        await time.includeAt(
          async () =>
            await metaquantsOracleFactory
              .connect(user)
              .commit(
                [METAQUANTS_BAYC_ETH_PRICE_FEED, METAQUANTS_MILADY_ETH_PRICE_FEED],
                STARTING_TIME,
                listify(PAYLOAD, PAYLOAD_MILADY),
              ),
          STARTING_TIME,
        )

        const [baycPrice, miladyPrice] = getPrices(listify(PAYLOAD, PAYLOAD_MILADY))

        expect((await keeperOracle.latest()).timestamp).to.equal(STARTING_TIME)
        expect((await keeperOracle.latest()).valid).to.equal(true)
        const [latestIndexEth] = await keeperOracle.status()
        expect(latestIndexEth.valid).to.be.true
        expect(latestIndexEth.price).to.equal(baycPrice)

        expect((await keeperOracleMilady.latest()).timestamp).to.equal(STARTING_TIME)
        expect((await keeperOracleMilady.latest()).valid).to.equal(true)
        const [latestIndexBtc] = await keeperOracleMilady.status()
        expect(latestIndexBtc.valid).to.be.true
        expect(latestIndexBtc.price).to.equal(miladyPrice)
      })
    })
  })
})
