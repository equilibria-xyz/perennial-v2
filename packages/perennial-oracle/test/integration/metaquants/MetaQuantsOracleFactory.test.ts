import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { utils, BigNumber } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { currentBlockTimestamp, increase } from '../../../../common/testutil/time'
import {
  ArbGasInfo,
  IERC20Metadata,
  IERC20Metadata__factory,
  IFactory,
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
  VersionLib__factory,
  VersionStorageLib__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { smock } from '@defi-wonderland/smock'
import { IInstance } from '../../../types/generated/@equilibria/root/attribute/interfaces'

const { ethers } = HRE

const METAQUANTS_BAYC_ETH_PRICE_FEED = '0x000000000000000000000000bc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
const METAQUANTS_MILADY_ETH_PRICE_FEED = '0x0000000000000000000000005af0d9827e0c53e4799bb226655a1de152a425a5'
const DSU_ADDRESS = '0x605D26FBd5be761089281d5cec2Ce86eeA667109'
const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DSU_HOLDER = '0x2d264EBDb6632A06A1726193D4d37FeF1E5dbDcd'

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
    let oracle: Oracle
    let keeperOracle: KeeperOracle
    let keeperOracleMilady: KeeperOracle
    let keeperOraclePayoff: KeeperOracle
    let metaquantsOracleFactory: MetaQuantsFactory
    let oracleFactory: OracleFactory
    let marketFactory: MarketFactory
    let market: IMarket
    let dsu: IERC20Metadata
    let oracleSigner: SignerWithAddress
    let factorySigner: SignerWithAddress
    let powerTwoPayoff: PowerTwo

    const setup = async () => {
      ;[owner, user] = await ethers.getSigners()

      dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)

      powerTwoPayoff = await new PowerTwo__factory(owner).deploy()

      const oracleImpl = await new Oracle__factory(owner).deploy()
      oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
      await oracleFactory.initialize(DSU_ADDRESS)
      await oracleFactory.updateMaxClaim(parse6decimal('100'))

      const keeperOracleImpl = await new testOracle.Oracle(owner).deploy(60)
      metaquantsOracleFactory = await new MetaQuantsFactory__factory(owner).deploy(
        SIGNER,
        keeperOracleImpl.address,
        4,
        10,
        {
          multiplierBase: 0,
          bufferBase: 1_000_000,
          multiplierCalldata: 0,
          bufferCalldata: 500_000,
        },
        {
          multiplierBase: ethers.utils.parseEther('1.02'),
          bufferBase: 2_000_000,
          multiplierCalldata: ethers.utils.parseEther('1.03'),
          bufferCalldata: 1_500_000,
        },
        5_000,
      )
      await metaquantsOracleFactory.initialize(oracleFactory.address, CHAINLINK_ETH_USD_FEED, dsu.address)
      await oracleFactory.register(metaquantsOracleFactory.address)
      await metaquantsOracleFactory.authorize(oracleFactory.address)
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
      keeperOraclePayoff = testOracle.Oracle.connect(
        await metaquantsOracleFactory.callStatic.create(
          '0x0000000000000000000000000000000000000000000000000000000000000021',
          METAQUANTS_BAYC_ETH_PRICE_FEED,
          { provider: powerTwoPayoff.address, decimals: -3 },
        ),
        owner,
      )
      await metaquantsOracleFactory.create(
        '0x0000000000000000000000000000000000000000000000000000000000000021',
        METAQUANTS_BAYC_ETH_PRICE_FEED,
        { provider: powerTwoPayoff.address, decimals: -3 },
      )

      oracle = Oracle__factory.connect(
        await oracleFactory.callStatic.create(METAQUANTS_BAYC_ETH_PRICE_FEED, metaquantsOracleFactory.address),
        owner,
      )
      await oracleFactory.create(METAQUANTS_BAYC_ETH_PRICE_FEED, metaquantsOracleFactory.address)

      const marketImpl = await new Market__factory(
        {
          '@equilibria/perennial-v2/contracts/libs/CheckpointLib.sol:CheckpointLib': (
            await new CheckpointLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/libs/InvariantLib.sol:InvariantLib': (
            await new InvariantLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/libs/VersionLib.sol:VersionLib': (
            await new VersionLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/types/Checkpoint.sol:CheckpointStorageLib': (
            await new CheckpointStorageLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/types/Global.sol:GlobalStorageLib': (
            await new GlobalStorageLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/types/MarketParameter.sol:MarketParameterStorageLib': (
            await new MarketParameterStorageLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/types/Position.sol:PositionStorageGlobalLib': (
            await new PositionStorageGlobalLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/types/Position.sol:PositionStorageLocalLib': (
            await new PositionStorageLocalLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/types/RiskParameter.sol:RiskParameterStorageLib': (
            await new RiskParameterStorageLib__factory(owner).deploy()
          ).address,
          '@equilibria/perennial-v2/contracts/types/Version.sol:VersionStorageLib': (
            await new VersionStorageLib__factory(owner).deploy()
          ).address,
        },
        owner,
      ).deploy()
      marketFactory = await new MarketFactory__factory(owner).deploy(oracleFactory.address, marketImpl.address)
      await marketFactory.initialize()
      await marketFactory.updateParameter({
        protocolFee: parse6decimal('0.50'),
        maxFee: parse6decimal('0.01'),
        maxFeeAbsolute: parse6decimal('1000'),
        maxCut: parse6decimal('0.50'),
        maxRate: parse6decimal('10.00'),
        minMaintenance: parse6decimal('0.01'),
        minEfficiency: parse6decimal('0.1'),
        referralFee: 0,
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
        maxLiquidationFee: parse6decimal('1000'),
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
        minMargin: parse6decimal('500'),
        minMaintenance: parse6decimal('500'),
        staleAfter: 7200,
        makerReceiveOnly: false,
      }
      const marketParameter = {
        fundingFee: parse6decimal('0.1'),
        interestFee: parse6decimal('0.1'),
        oracleFee: 0,
        riskFee: 0,
        positionFee: 0,
        maxPendingGlobal: 8,
        maxPendingLocal: 8,
        settlementFee: 0,
        makerCloseAlways: false,
        takerCloseAlways: false,
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
      await market.updateParameter(ethers.constants.AddressZero, ethers.constants.AddressZero, marketParameter)
      await market.updateRiskParameter(riskParameter)

      oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))
      factorySigner = await impersonateWithBalance(metaquantsOracleFactory.address, utils.parseEther('10'))

      const dsuHolder = await impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
      await dsu.connect(dsuHolder).transfer(oracleFactory.address, utils.parseEther('10000'))

      await testOracle.gasMock()
    }

    beforeEach(async () => {
      await time.reset()
      await setup()

      await time.increaseTo(STARTING_TIME - 1)
      // block.timestamp of the next call will be STARTING_TIME
    })

    afterEach(async () => {
      await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x1'])
    })

    describe('Factory', async () => {
      context('#initialize', async () => {
        it('reverts if already initialized', async () => {
          const metaquantsOracleFactory2 = await new MetaQuantsFactory__factory(owner).deploy(
            SIGNER,
            await metaquantsOracleFactory.implementation(),
            4,
            10,
            {
              multiplierBase: 0,
              bufferBase: 1_000_000,
              multiplierCalldata: 0,
              bufferCalldata: 500_000,
            },
            {
              multiplierBase: ethers.utils.parseEther('1.02'),
              bufferBase: 2_000_000,
              multiplierCalldata: ethers.utils.parseEther('1.03'),
              bufferCalldata: 1_500_000,
            },
            5_000,
          )
          await metaquantsOracleFactory2.initialize(oracleFactory.address, CHAINLINK_ETH_USD_FEED, dsu.address)
          await expect(metaquantsOracleFactory2.initialize(oracleFactory.address, CHAINLINK_ETH_USD_FEED, dsu.address))
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

      context('#updateGranularity', async () => {
        it('reverts when not owner', async () => {
          await expect(metaquantsOracleFactory.connect(user).updateGranularity(10)).to.be.revertedWithCustomError(
            metaquantsOracleFactory,
            'OwnableNotOwnerError',
          )
        })
      })

      context('#authorize', async () => {
        it('reverts when not owner', async () => {
          await expect(
            metaquantsOracleFactory.connect(user).authorize(oracleFactory.address),
          ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'OwnableNotOwnerError')
        })
      })

      context('#register', async () => {
        it('reverts when not owner', async () => {
          await expect(
            metaquantsOracleFactory.connect(user).register(ethers.constants.AddressZero),
          ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'OwnableNotOwnerError')
        })
      })
    })

    describe('#initialize', async () => {
      it('only initializes with a valid priceId', async () => {
        const oracle = await new KeeperOracle__factory(owner).deploy(60)
        await expect(oracle.initialize()).to.emit(oracle, 'Initialized').withArgs(1)
      })

      it('reverts if already initialized', async () => {
        const oracle = await new KeeperOracle__factory(owner).deploy(60)
        await oracle.initialize()
        await expect(oracle.initialize())
          .to.be.revertedWithCustomError(oracle, 'InitializableAlreadyInitializedError')
          .withArgs(1)
      })
    })

    describe('constants', async () => {
      it('#MIN_VALID_TIME_AFTER_VERSION', async () => {
        expect(await metaquantsOracleFactory.validFrom()).to.equal(4)
      })

      it('#MAX_VALID_TIME_AFTER_VERSION', async () => {
        expect(await metaquantsOracleFactory.validTo()).to.equal(10)
      })

      it('#GRACE_PERIOD', async () => {
        expect(await keeperOracle.timeout()).to.equal(60)
      })

      it('#commitKeepConfig', async () => {
        const keepConfig = await metaquantsOracleFactory.commitKeepConfig(1)
        expect(keepConfig.multiplierBase).to.equal(0)
        expect(keepConfig.bufferBase).to.equal(1_000_000)
        expect(keepConfig.multiplierCalldata).to.equal(0)
        expect(keepConfig.bufferCalldata).to.equal(505_000)
      })

      it('#commitKeepConfig with multiple requested', async () => {
        const keepConfig = await metaquantsOracleFactory.commitKeepConfig(5)
        expect(keepConfig.multiplierBase).to.equal(0)
        expect(keepConfig.bufferBase).to.equal(5_000_000)
        expect(keepConfig.multiplierCalldata).to.equal(0)
        expect(keepConfig.bufferCalldata).to.equal(525_000)
      })

      it('#settleKeepConfig', async () => {
        const keepConfig = await metaquantsOracleFactory.settleKeepConfig()
        expect(keepConfig.multiplierBase).to.equal(ethers.utils.parseEther('1.02'))
        expect(keepConfig.bufferBase).to.equal(2_000_000)
        expect(keepConfig.multiplierCalldata).to.equal(ethers.utils.parseEther('1.03'))
        expect(keepConfig.bufferCalldata).to.equal(1_500_000)
      })
    })

    describe('#commit', async () => {
      it('commits successfully and incentivizes the keeper', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const originalFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.globalCallbacks(STARTING_TIME)).to.deep.eq([market.address])
        expect(await keeperOracle.localCallbacks(STARTING_TIME, market.address)).to.deep.eq([user.address])

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD), { maxFeePerGas: 100000000 }),
        )
          .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
          .withArgs([STARTING_TIME, getPrices(listify(PAYLOAD))[0], true])

        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const newFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)

        expect(newDSUBalance.sub(originalDSUBalance)).to.be.within(utils.parseEther('0.15'), utils.parseEther('0.20'))
        expect(originalFactoryDSUBalance.sub(newFactoryDSUBalance)).to.be.within(
          utils.parseEther('0.15'),
          utils.parseEther('0.20'),
        )

        expect((await market.position()).timestamp).to.equal(STARTING_TIME)
      })

      it('commits successfully with payoff and incentivizes the keeper', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const originalFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)
        await keeperOraclePayoff.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOraclePayoff.globalCallbacks(STARTING_TIME)).to.deep.eq([market.address])
        expect(await keeperOraclePayoff.localCallbacks(STARTING_TIME, market.address)).to.deep.eq([user.address])

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOraclePayoff.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOraclePayoff.next()).to.be.equal(STARTING_TIME)

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit(
              ['0x0000000000000000000000000000000000000000000000000000000000000021'],
              STARTING_TIME,
              listify(PAYLOAD),
              {
                maxFeePerGas: 100000000,
              },
            ),
        )
          .to.emit(keeperOraclePayoff, 'OracleProviderVersionFulfilled')
          .withArgs([
            STARTING_TIME,
            getPrices(listify(PAYLOAD))[0]
              .mul(getPrices(listify(PAYLOAD))[0])
              .div(1e9),
            true,
          ])

        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const newFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)

        expect(newDSUBalance.sub(originalDSUBalance)).to.be.within(utils.parseEther('0.15'), utils.parseEther('0.20'))
        expect(originalFactoryDSUBalance.sub(newFactoryDSUBalance)).to.be.within(
          utils.parseEther('0.15'),
          utils.parseEther('0.20'),
        )
      })

      it('does not allow committing with invalid signature', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
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

      it('does not allow committing with invalid signature', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
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

      it('does not allow committing with no signature', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)

        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await expect(
          metaquantsOracleFactory.connect(user).commit(
            [METAQUANTS_BAYC_ETH_PRICE_FEED],
            STARTING_TIME,
            listify({
              update: PAYLOAD.update,
              signature: '0x',
            }),
          ),
        ).to.be.revertedWith('ECDSA: invalid signature length')
      })

      it('does not allow mismatched ids', async () => {
        // Don't allow extra IDs.
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED, METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD)),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'MetaQuantsFactoryInputLengthMismatchError')

        // Don't allow too few IDs.
        await expect(
          metaquantsOracleFactory.connect(user).commit([], STARTING_TIME, listify(PAYLOAD)),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'MetaQuantsFactoryInputLengthMismatchError')

        // Don't allow incorrect ID.
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED.replace('1', '2')], STARTING_TIME, listify(PAYLOAD)),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'MetaQuantsFactoryInvalidIdError')
      })

      it('commits successfully if report is barely not too early', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD_BARELY_NOT_TOO_EARLY), {
              maxFeePerGas: 100000000,
            }),
        )
          .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
          .withArgs([STARTING_TIME, getPrices(listify(PAYLOAD_BARELY_NOT_TOO_EARLY))[0], true])
      })

      it('commits successfully if report is barely not too late', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD_BARELY_NOT_TOO_LATE), {
              maxFeePerGas: 100000000,
            }),
        )
          .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
          .withArgs([STARTING_TIME, getPrices(listify(PAYLOAD_BARELY_NOT_TOO_LATE))[0], true])
      })

      it('fails to commit if version is outside of time range', async () => {
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME - 5, listify(PAYLOAD)),
        ).to.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryVersionOutsideRangeError')

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME + 3, listify(PAYLOAD)),
        ).to.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryVersionOutsideRangeError')

        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)

        // await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD_BARELY_TOO_EARLY)),
        ).to.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryVersionOutsideRangeError')

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD_BARELY_TOO_LATE)),
        ).to.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryVersionOutsideRangeError')
      })

      it('does not commit a version that has already been committed', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD)),
        ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('cannot skip a version', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.versions(2)).to.be.equal(STARTING_TIME + 1)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME + 1, listify(PAYLOAD)),
        ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('cannot skip a version if the grace period has expired', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await time.increase(59)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.versions(2)).to.be.equal(STARTING_TIME + 60)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME + 60, listify(PAYLOAD_AFTER_EXPIRATION)),
        ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('commits unincentivized if there are no requested or committed versions, does not incentivize keeper, updates latest', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        await increase(1)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
        const version = await keeperOracle.connect(user).at(STARTING_TIME)
        expect(version.valid).to.be.true
        expect(version.price).to.equal(getPrices(listify(PAYLOAD))[0])

        // Didn't incentivize keeper
        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        expect(newDSUBalance.sub(originalDSUBalance)).to.equal(0)

        expect(await keeperOracle.connect(user).latest()).to.deep.equal(version)
      })

      it('reverts if not called from factory', async () => {
        await expect(
          keeperOracle.connect(user).commit({ timestamp: STARTING_TIME, price: parse6decimal('1000'), valid: true }),
        ).to.be.revertedWithCustomError(keeperOracle, 'InstanceNotFactoryError')
      })

      it('reverts if version is zero', async () => {
        await expect(
          keeperOracle.connect(factorySigner).commit({ timestamp: 0, price: 0, valid: false }),
        ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('can commit if there are requested versions but no committed versions', async () => {
        await time.increase(30)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
      })

      it('can commit if there are committed versions but no requested versions', async () => {
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))

        await time.increase(60)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME + 60, listify(PAYLOAD_AFTER_EXPIRATION))
      })

      it('can commit if there are committed versions and requested versions', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await time.increase(1)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
        await time.increaseTo(STARTING_TIME + 160)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        const secondRequestedVersion = await currentBlockTimestamp()
        const nonRequestedOracleVersion = STARTING_TIME + 60
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], nonRequestedOracleVersion, listify(PAYLOAD_AFTER_EXPIRATION))
        expect((await keeperOracle.connect(user).latest()).timestamp).to.equal(nonRequestedOracleVersion)

        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], secondRequestedVersion, listify(PAYLOAD_WAY_AFTER_EXPIRATION))
        expect((await keeperOracle.connect(user).latest()).timestamp).to.equal(secondRequestedVersion)
      })

      it('cannot commit invalid reports for the oracle version', async () => {
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME - 60, listify(PAYLOAD)),
        ).to.reverted
      })

      it('must be more recent than the most recently committed version', async () => {
        await time.increase(2)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME + 2, listify(PAYLOAD))

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME + 1, listify(OTHER_PAYLOAD)),
        ).to.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
      })

      it('does not commitRequested if oracleVersion is incorrect', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME - 1, listify(PAYLOAD), {
            gasPrice: 100000000,
          })
        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)

        // Keeper isn't incentivized because we did not go through commitRequested
        expect(newDSUBalance).to.equal(originalDSUBalance)
      })

      it('can commit multiple non-requested versions, as long as they are in order', async () => {
        await time.increase(1)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
        await time.increase(60)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME + 60, listify(PAYLOAD_AFTER_EXPIRATION))
      })

      it('cant commit non-requested version until after an invalid has passed grace period', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect((await keeperOracle.global()).latestIndex).to.equal(0)

        await time.increase(59)
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME + 60, listify(PAYLOAD_AFTER_EXPIRATION)),
        ).to.be.reverted
      })

      it('reverts if committing invalid non-requested version', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        expect((await keeperOracle.global()).latestIndex).to.equal(0)

        await time.increase(60)
        await expect(
          metaquantsOracleFactory.connect(user).commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME - 1, '0x'),
        ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleInvalidPriceError')
      })

      it('can update multiple from batched update', async () => {
        await metaquantsOracleFactory
          .connect(user)
          .commit(
            [METAQUANTS_BAYC_ETH_PRICE_FEED, METAQUANTS_MILADY_ETH_PRICE_FEED],
            STARTING_TIME,
            listify(PAYLOAD, PAYLOAD_MILADY),
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

    describe('#settle', async () => {
      it('settles successfully and incentivizes the keeper', async () => {
        const originalDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const originalFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        // Base fee isn't working properly in coverage, so we need to set it manually
        await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
        expect(await keeperOracle.versions(1)).to.be.equal(STARTING_TIME)
        expect(await keeperOracle.next()).to.be.equal(STARTING_TIME)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD), {
            maxFeePerGas: 100000000,
          })
        const newDSUBalance = await dsu.callStatic.balanceOf(user.address)
        const newFactoryDSUBalance = await dsu.callStatic.balanceOf(oracleFactory.address)

        expect((await market.position()).timestamp).to.equal(STARTING_TIME)

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .settle([METAQUANTS_BAYC_ETH_PRICE_FEED], [market.address], [STARTING_TIME], [1], {
              maxFeePerGas: 100000000,
            }),
        ).to.emit(keeperOracle, 'CallbackFulfilled')
        // .withArgs([market.address, user.address, STARTING_TIME]) cannot parse indexed tuples in events

        expect((await market.positions(user.address)).timestamp).to.equal(STARTING_TIME)

        expect(newDSUBalance.sub(originalDSUBalance)).to.be.within(utils.parseEther('0.15'), utils.parseEther('0.20'))
        expect(originalFactoryDSUBalance.sub(newFactoryDSUBalance)).to.be.within(
          utils.parseEther('0.15'),
          utils.parseEther('0.20'),
        )
      })

      it('reverts if array lengths mismatch', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
        await expect(
          metaquantsOracleFactory
            .connect(user)
            .settle([METAQUANTS_BAYC_ETH_PRICE_FEED], [market.address, market.address], [STARTING_TIME], [1]),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryInvalidSettleError')

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .settle([METAQUANTS_BAYC_ETH_PRICE_FEED], [market.address], [STARTING_TIME, STARTING_TIME], [1]),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryInvalidSettleError')

        await expect(
          metaquantsOracleFactory
            .connect(user)
            .settle([METAQUANTS_BAYC_ETH_PRICE_FEED], [market.address], [STARTING_TIME], [1, 1]),
        ).to.be.revertedWithCustomError(metaquantsOracleFactory, 'KeeperFactoryInvalidSettleError')
      })

      it('reverts if calldata is ids is empty', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))

        await expect(metaquantsOracleFactory.connect(user).settle([], [], [], [])).to.be.revertedWithCustomError(
          metaquantsOracleFactory,
          'KeeperFactoryInvalidSettleError',
        )
      })
    })

    describe('#status', async () => {
      it('returns the correct versions', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
        const [latestIndex, currentIndex] = await keeperOracle.status()
        expect(latestIndex.valid).to.be.true
        expect(latestIndex.price).to.equal(getPrices(listify(PAYLOAD))[0])
        expect(currentIndex).to.equal(await currentBlockTimestamp())
      })

      it('returns empty versions if no version has ever been committed', async () => {
        const [latestIndex, currentIndex] = await keeperOracle.status()
        expect(currentIndex).to.equal(await currentBlockTimestamp())
        expect(latestIndex.timestamp).to.equal(0)
        expect(latestIndex.price).to.equal(0)
        expect(latestIndex.valid).to.be.false
      })
    })

    describe('#request', async () => {
      it('can request a version', async () => {
        // No requested versions
        expect((await keeperOracle.global()).currentIndex).to.equal(0)
        await expect(keeperOracle.connect(oracleSigner).request(market.address, user.address))
          .to.emit(keeperOracle, 'OracleProviderVersionRequested')
          .withArgs(STARTING_TIME)
        // Now there is exactly one requested version
        expect(await keeperOracle.versions(1)).to.equal(STARTING_TIME)
        expect((await keeperOracle.global()).currentIndex).to.equal(1)
      })

      it('can request a version w/ granularity', async () => {
        await metaquantsOracleFactory.updateGranularity(10)

        // No requested versions
        expect((await keeperOracle.global()).currentIndex).to.equal(0)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        const currentTimestamp = await metaquantsOracleFactory.current()

        // Now there is exactly one requested version
        expect(await keeperOracle.versions(1)).to.equal(currentTimestamp)
        expect((await keeperOracle.global()).currentIndex).to.equal(1)
      })

      it('does not allow unauthorized instances to request', async () => {
        const badInstance = await smock.fake<IInstance>('IInstance')
        const badFactory = await smock.fake<IFactory>('IFactory')
        badInstance.factory.returns(badFactory.address)
        badFactory.instances.returns(true)
        const badSigner = await impersonateWithBalance(badInstance.address, utils.parseEther('10'))

        await expect(
          keeperOracle.connect(badSigner).request(market.address, user.address),
        ).to.be.revertedWithCustomError(keeperOracle, 'OracleProviderUnauthorizedError')
      })

      it('a version can only be requested once', async () => {
        await ethers.provider.send('evm_setAutomine', [false])
        await ethers.provider.send('evm_setIntervalMining', [0])

        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)

        await ethers.provider.send('evm_mine', [])

        const currentTimestamp = await metaquantsOracleFactory.current()
        expect(await keeperOracle.callStatic.versions(1)).to.equal(currentTimestamp)
        expect(await keeperOracle.callStatic.versions(2)).to.equal(0)
      })
    })

    describe('#latest', async () => {
      it('returns the latest version', async () => {
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
        const latestValue = await keeperOracle.connect(user).latest()
        expect(latestValue.price).to.equal(getPrices(listify(PAYLOAD))[0])
      })

      it('returns empty version if no version has ever been committed', async () => {
        const latestIndex = await keeperOracle.connect(user).latest()
        expect(latestIndex.timestamp).to.equal(0)
        expect(latestIndex.price).to.equal(0)
        expect(latestIndex.valid).to.be.false
      })
    })

    describe('#current', async () => {
      it('returns the current timestamp', async () => {
        expect(await keeperOracle.connect(user).current()).to.equal(await currentBlockTimestamp())
      })

      it('returns the current timestamp w/ granularity == 0', async () => {
        await expect(metaquantsOracleFactory.connect(owner).updateGranularity(0)).to.be.revertedWithCustomError(
          metaquantsOracleFactory,
          'KeeperFactoryInvalidGranularityError',
        )
      })

      it('returns the current timestamp w/ granularity > MAX', async () => {
        await expect(metaquantsOracleFactory.connect(owner).updateGranularity(3601)).to.be.revertedWithCustomError(
          metaquantsOracleFactory,
          'KeeperFactoryInvalidGranularityError',
        )
        await expect(metaquantsOracleFactory.connect(owner).updateGranularity(3600)).to.be.not.reverted
      })

      it('returns the current timestamp w/ fresh granularity > 1', async () => {
        await metaquantsOracleFactory.connect(owner).updateGranularity(10)

        const granularity = await metaquantsOracleFactory.granularity()
        expect(granularity.latestGranularity).to.equal(1)
        expect(granularity.currentGranularity).to.equal(10)
        expect(granularity.effectiveAfter).to.equal(await currentBlockTimestamp())

        expect(await keeperOracle.connect(user).current()).to.equal(await currentBlockTimestamp())
      })

      it('returns the current timestamp w/ settled granularity > 1', async () => {
        const granularity = await metaquantsOracleFactory.granularity()
        expect(granularity.latestGranularity).to.equal(0)
        expect(granularity.currentGranularity).to.equal(1)
        expect(granularity.effectiveAfter).to.equal(0)

        await metaquantsOracleFactory.connect(owner).updateGranularity(10)

        const granularity2 = await metaquantsOracleFactory.granularity()
        expect(granularity2.latestGranularity).to.equal(1)
        expect(granularity2.currentGranularity).to.equal(10)
        expect(granularity2.effectiveAfter).to.equal(await currentBlockTimestamp())

        await time.increase(1)

        expect(await keeperOracle.connect(user).current()).to.equal(
          Math.ceil((await currentBlockTimestamp()) / 10) * 10,
        )
      })

      it('returns the current timestamp w/ fresh + fresh granularity > 1', async () => {
        await metaquantsOracleFactory.connect(owner).updateGranularity(10)
        // hardhat automatically moves 1 second ahead so we have to do this twice
        await metaquantsOracleFactory.connect(owner).updateGranularity(100)
        await expect(metaquantsOracleFactory.connect(owner).updateGranularity(1000)).to.be.revertedWithCustomError(
          metaquantsOracleFactory,
          'KeeperFactoryInvalidGranularityError',
        )
      })

      it('returns the current timestamp w/ settled + fresh granularity > 1', async () => {
        await metaquantsOracleFactory.connect(owner).updateGranularity(10)
        await time.increase(1)

        await metaquantsOracleFactory.connect(owner).updateGranularity(100)
        const granularity = await metaquantsOracleFactory.granularity()
        expect(granularity.latestGranularity).to.equal(10)
        expect(granularity.currentGranularity).to.equal(100)
        expect(granularity.effectiveAfter).to.equal(Math.ceil((await currentBlockTimestamp()) / 10) * 10)

        expect(await keeperOracle.connect(user).current()).to.equal(
          Math.ceil((await currentBlockTimestamp()) / 10) * 10,
        )
      })

      it('returns the current timestamp w/ settled + settled granularity > 1', async () => {
        await metaquantsOracleFactory.connect(owner).updateGranularity(10)
        await time.increase(1)

        await metaquantsOracleFactory.connect(owner).updateGranularity(100)
        const granularity = await metaquantsOracleFactory.granularity()
        expect(granularity.latestGranularity).to.equal(10)
        expect(granularity.currentGranularity).to.equal(100)
        expect(granularity.effectiveAfter).to.equal(Math.ceil((await currentBlockTimestamp()) / 10) * 10)

        const previousCurrent = Math.ceil((await currentBlockTimestamp()) / 10) * 10
        await time.increase(previousCurrent - (await currentBlockTimestamp()) + 1)

        expect(await keeperOracle.connect(user).current()).to.equal(
          Math.ceil((await currentBlockTimestamp()) / 100) * 100,
        )
      })
    })

    describe('#atVersion', async () => {
      it('returns the correct version', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        await metaquantsOracleFactory
          .connect(user)
          .commit([METAQUANTS_BAYC_ETH_PRICE_FEED], STARTING_TIME, listify(PAYLOAD))
        const version = await keeperOracle.connect(user).at(STARTING_TIME)
        expect(version.valid).to.be.true
        expect(version.price).to.equal(getPrices(listify(PAYLOAD))[0])
      })

      it('returns invalid version if that version was not requested', async () => {
        const version = await keeperOracle.connect(user).at(STARTING_TIME)
        expect(version.valid).to.be.false
      })

      it('returns invalid version if that version was requested but not committed', async () => {
        await keeperOracle.connect(oracleSigner).request(market.address, user.address)
        const version = await keeperOracle.connect(user).at(STARTING_TIME)
        expect(version.valid).to.be.false
      })
    })
  })
})
