import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish, utils } from 'ethers'
import HRE from 'hardhat'
import { time } from '../../../../common/testutil'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import {
  ArbGasInfo,
  IERC20Metadata,
  IERC20Metadata__factory,
  Market__factory,
  MarketFactory,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  IMarket,
  KeeperOracle__factory,
  KeeperOracle,
  PowerTwo__factory,
  GasOracle,
  StorkFactory,
  StorkFactory__factory,
  GasOracle__factory,
  IMargin,
  IMargin__factory,
} from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'
import { smock } from '@defi-wonderland/smock'
import { IFactory, IInstance } from '../../../types/generated/@equilibria/root/attribute/interfaces'
import { deployMarketFactory } from '../../setupHelpers'

const { ethers } = HRE
const { constants } = ethers

const STORK_ADDRESS = '0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62'
const STORK_ETH_USD_PRICE_FEED = '0x59102b37de83bdda9f38ac8254e596f0d9ac61d2035c07936675e87342817160'
const STORK_BTC_USD_PRICE_FEED = '0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de'
const DSU_ADDRESS = '0x7b4Adf64B0d60fF97D672E473420203D52562A84'
const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const DSU_MINTER = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

const getMultipleUpdatePriceData = (
  temporalInputs: {
    timestampNs: BigNumberish
    quantizedValue: BigNumberish
    id: string
    publisherMerkleRoot: string
    valueComputeAlgHash: string
    r: string
    s: string
    v: BigNumberish
  }[],
) => {
  const temporalNumericValueInput = []
  for (const input of temporalInputs) {
    const temporalNumericValue = {
      timestampNs: input.timestampNs,
      quantizedValue: input.quantizedValue,
    }

    temporalNumericValueInput.push({
      temporalNumericValue: temporalNumericValue,
      id: input.id,
      publisherMerkleRoot: input.publisherMerkleRoot,
      valueComputeAlgHash: input.valueComputeAlgHash,
      r: input.r,
      s: input.s,
      v: input.v,
    })
  }

  // Encode the struct
  const encodedData = ethers.utils.defaultAbiCoder.encode(
    [
      'tuple(tuple(uint64 timestampNs, int192 quantizedValue) temporalNumericValue, bytes32 id, bytes32 publisherMerkleRoot, bytes32 valueComputeAlgHash, bytes32 r, bytes32 s, uint8 v)[]',
    ],
    [temporalNumericValueInput],
  )
  return encodedData
}

// This update price data has timestamp 1739221984
const UPDATE_DATA = getMultipleUpdatePriceData([
  {
    timestampNs: BigNumber.from('1739221742898136978'),
    quantizedValue: BigNumber.from('2678332376156249500000'),
    id: STORK_ETH_USD_PRICE_FEED,
    publisherMerkleRoot: '0x6664832e5574f276d69e203151d19c3b049dcda0d9f0ff913bebed289da08506',
    valueComputeAlgHash: '0x9be7e9f9ed459417d96112a7467bd0b27575a2c7847195c68f805b70ce1795ba',
    r: '0xf0c2943bf9989fc578c4c1995aa5ddfdbf4ed05dd4d616caaffc8c57e95378d8',
    s: '0x44994bf61be729bf89241aa867a5d28f9eadcac2ec44eca0a9cd2a67be56fd88',
    v: 27,
  },
])

// This update price data has timestamp 1739222194
const OTHER_UPDATE_DATA = getMultipleUpdatePriceData([
  {
    timestampNs: BigNumber.from('1739222192882752485'),
    quantizedValue: BigNumber.from('2674940471500000000000'),
    id: STORK_ETH_USD_PRICE_FEED,
    publisherMerkleRoot: '0xdc8a23f5dc90b5b4b77a7aedf0c17cd4d6dd85336f413e723498437bd55c8148',
    valueComputeAlgHash: '0x9be7e9f9ed459417d96112a7467bd0b27575a2c7847195c68f805b70ce1795ba',
    r: '0x882e2001a14edda5c45d5a5e5aea55d22d006298b541b9df5866c89c316f06b6',
    s: '0x7766b737fe2f622ae34c9ac31d56f62d68191cce5c02fa42e09193a695191d16',
    v: 27,
  },
])

const MULTIPLE_UPDATE_DATA = getMultipleUpdatePriceData([
  {
    timestampNs: BigNumber.from('1741107056905895000'),
    quantizedValue: BigNumber.from('2057801527024999500000'),
    id: STORK_ETH_USD_PRICE_FEED,
    publisherMerkleRoot: '0xeb1aa013af8264548b4adc3e720bb20c13e229f12a7e89211dfe62317e2994fa',
    valueComputeAlgHash: '0x011bbbdba5903410bc0d1c972cf8d3f262dd8cf21901ecb116def50a106e1c1d',
    r: '0x3dab84c3ffceb41340ebced429645cc81839dd4c37715b5e187d27e08a425292',
    s: '0x15c298e9fa6ce1d01596ecaafe34563d1afa577d4b4df3b99afb64e2ac824125',
    v: 27,
  },
  {
    timestampNs: BigNumber.from('1741106800405840600'),
    quantizedValue: BigNumber.from('82950801952499998000000'),
    id: STORK_BTC_USD_PRICE_FEED,
    publisherMerkleRoot: '0xba065bda6ac1ba50796ff0abb05e16d9673f695024344d596e87f81212e3931b',
    valueComputeAlgHash: '0x0e387c41c71d8f8aead414f5b090696f4f1c27e5428925e9815c4e9e1fb0aee8',
    r: '0x702887d2c00fdacac8f21718a0bcf8e5d4c09cb18a9cda38352f7e4b1ce52669',
    s: '0x0b534847266e72e8ee576f68e3a0107402ca67421c3ee3b05c441d830f0acd2d',
    v: 27,
  },
])

const testOracles = [
  {
    name: 'KeeperOracle',
    Oracle: KeeperOracle__factory,
    gasMock: async () => {
      const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
        address: '0x000000000000000000000000000000000000006C',
      })
      gasInfo.getL1BaseFeeEstimate.returns(0)
    },
  },
]

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

testOracles.forEach(testOracle => {
  const BATCHED_TIMESTAMP = 1739221742

  describe(testOracle.name, () => {
    let owner: SignerWithAddress
    let user: SignerWithAddress
    let commitmentGasOracle: GasOracle
    let settlementGasOracle: GasOracle
    let oracle: Oracle
    let keeperOracle: KeeperOracle
    let storkOracleFactory: StorkFactory
    let oracleFactory: OracleFactory
    let marketFactory: MarketFactory
    let market: IMarket
    let margin: IMargin
    let dsu: IERC20Metadata
    let factorySigner: SignerWithAddress

    const fixture = async () => {
      await time.reset()
      await setup()
    }

    const setup = async () => {
      ;[owner, user] = await ethers.getSigners()

      dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, owner)
      await fundWallet(dsu, user)

      const powerTwoPayoff = await new PowerTwo__factory(owner).deploy()

      const oracleImpl = await new Oracle__factory(owner).deploy()
      oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
      await oracleFactory.initialize()
      await oracleFactory.connect(owner).updateParameter({
        maxGranularity: 10000,
        maxSyncFee: parse6decimal('500'),
        maxAsyncFee: parse6decimal('500'),
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
      storkOracleFactory = await new StorkFactory__factory(owner).deploy(
        STORK_ADDRESS,
        commitmentGasOracle.address,
        settlementGasOracle.address,
        keeperOracleImpl.address,
      )
      await storkOracleFactory.initialize(oracleFactory.address)
      await oracleFactory.register(storkOracleFactory.address)
      await storkOracleFactory.register(powerTwoPayoff.address)

      keeperOracle = testOracle.Oracle.connect(
        await storkOracleFactory.callStatic.create(STORK_ETH_USD_PRICE_FEED, STORK_ETH_USD_PRICE_FEED, {
          provider: ethers.constants.AddressZero,
          decimals: 0,
        }),
        owner,
      )
      await storkOracleFactory.create(STORK_ETH_USD_PRICE_FEED, STORK_ETH_USD_PRICE_FEED, {
        provider: ethers.constants.AddressZero,
        decimals: 0,
      })

      oracle = Oracle__factory.connect(
        await oracleFactory.callStatic.create(STORK_ETH_USD_PRICE_FEED, storkOracleFactory.address, 'ETHUSD'),
        owner,
      )
      await oracleFactory.create(STORK_ETH_USD_PRICE_FEED, storkOracleFactory.address, 'ETHUSD')

      marketFactory = await deployMarketFactory(owner, oracleFactory, dsu)
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
        minMinMaintenance: 0,
      })

      const riskParameter = {
        margin: parse6decimal('0.3'),
        maintenance: parse6decimal('0.3'),
        synBook: {
          d0: 0,
          d1: 0,
          d2: 0,
          d3: 0,
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
      market = Market__factory.connect(await marketFactory.callStatic.create(oracle.address), owner)
      await marketFactory.create(oracle.address)
      await market.updateParameter(marketParameter)
      await market.updateRiskParameter(riskParameter)

      await keeperOracle.register(oracle.address)
      await oracle.register(market.address)

      margin = IMargin__factory.connect(await market.margin(), owner)
      await dsu.connect(user).approve(margin.address, constants.MaxUint256)

      factorySigner = await impersonateWithBalance(storkOracleFactory.address, utils.parseEther('10'))

      await testOracle.gasMock()
    }

    describe('without initial price', async () => {
      const MIN_DELAY = 4

      beforeEach(async () => {
        await loadFixture(fixture)
      })

      it('can update single from batched update', async () => {
        await storkOracleFactory.updateParameter(1, parse6decimal('0.1'), 4, 10)

        await time.includeAt(
          async () =>
            await storkOracleFactory
              .connect(user)
              .commit([STORK_ETH_USD_PRICE_FEED], BATCHED_TIMESTAMP - MIN_DELAY, UPDATE_DATA),
          BATCHED_TIMESTAMP + 60,
        )

        expect((await keeperOracle.latest()).timestamp).to.equal(BATCHED_TIMESTAMP - MIN_DELAY)
        expect((await keeperOracle.latest()).valid).to.equal(true)
      })

      it('reverts if version outside range', async () => {
        await time.increaseTo(BATCHED_TIMESTAMP + 60)

        await expect(
          storkOracleFactory
            .connect(user)
            .commit([STORK_ETH_USD_PRICE_FEED], BATCHED_TIMESTAMP - MIN_DELAY, UPDATE_DATA),
        ).to.be.revertedWithCustomError(
          { interface: new ethers.utils.Interface(['error KeeperFactoryVersionOutsideRangeError()']) },
          'KeeperFactoryVersionOutsideRangeError',
        )
      })

      it('reverts if feed not created', async () => {
        await time.increaseTo(BATCHED_TIMESTAMP + 60)

        await expect(
          storkOracleFactory
            .connect(user)
            .commit(
              [STORK_ETH_USD_PRICE_FEED, '0x0000000000000000000000000000000000000000000000000000000000000000'],
              BATCHED_TIMESTAMP - MIN_DELAY,
              UPDATE_DATA,
            ),
        ).to.be.revertedWithCustomError(
          { interface: new ethers.utils.Interface(['error KeeperFactoryNotCreatedError()']) },
          'KeeperFactoryNotCreatedError',
        )
      })

      it('reverts if feed included twice in batched update', async () => {
        await time.increaseTo(BATCHED_TIMESTAMP + 60)

        await expect(
          storkOracleFactory
            .connect(user)
            .commit([STORK_ETH_USD_PRICE_FEED, STORK_ETH_USD_PRICE_FEED], BATCHED_TIMESTAMP - MIN_DELAY, UPDATE_DATA),
        ).to.be.revertedWithCustomError(storkOracleFactory, 'KeeperFactoryVersionOutsideRangeError')
      })
    })

    describe('with initial price', async () => {
      const OTHER_BATCHED_TIMESTAMP = 1739222192
      beforeEach(async () => {
        await loadFixture(fixture)

        await time.includeAt(async () => {
          await margin.connect(user).deposit(user.address, parse6decimal('10'))
          await storkOracleFactory.updateParameter(1, parse6decimal('0.1'), 4, 10)
          await storkOracleFactory.commit([STORK_ETH_USD_PRICE_FEED], BATCHED_TIMESTAMP - 4, UPDATE_DATA)
        }, BATCHED_TIMESTAMP)
      })

      describe('StorkFactory', async () => {
        context('#initialize', async () => {
          it('reverts if already initialized', async () => {
            const storkOracleFactory2 = await new StorkFactory__factory(owner).deploy(
              STORK_ADDRESS,
              commitmentGasOracle.address,
              settlementGasOracle.address,
              await storkOracleFactory.implementation(),
            )
            await storkOracleFactory2.initialize(oracleFactory.address)
            await expect(storkOracleFactory2.initialize(oracleFactory.address))
              .to.be.revertedWithCustomError(storkOracleFactory2, 'InitializableAlreadyInitializedError')
              .withArgs(1)
          })
        })

        context('#create', async () => {
          it('cant recreate price id', async () => {
            await expect(
              storkOracleFactory.create(STORK_ETH_USD_PRICE_FEED, STORK_ETH_USD_PRICE_FEED, {
                provider: ethers.constants.AddressZero,
                decimals: 0,
              }),
            ).to.be.revertedWithCustomError(storkOracleFactory, 'KeeperFactoryAlreadyCreatedError')
          })

          it('reverts when not owner', async () => {
            await expect(
              storkOracleFactory.connect(user).create(STORK_ETH_USD_PRICE_FEED, STORK_ETH_USD_PRICE_FEED, {
                provider: ethers.constants.AddressZero,
                decimals: 0,
              }),
            ).to.be.revertedWithCustomError(storkOracleFactory, 'OwnableNotOwnerError')
          })
        })

        context('#updateParameter', async () => {
          it('reverts when not owner', async () => {
            await expect(
              storkOracleFactory.connect(user).updateParameter(10, 13, 14, 15),
            ).to.be.revertedWithCustomError(storkOracleFactory, 'OwnableNotOwnerError')
          })
        })

        context('#register', async () => {
          it('reverts when not owner', async () => {
            await expect(
              storkOracleFactory.connect(user).register(ethers.constants.AddressZero),
            ).to.be.revertedWithCustomError(storkOracleFactory, 'OwnableNotOwnerError')
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

      describe('#constants', async () => {
        it('#MIN_VALID_TIME_AFTER_VERSION', async () => {
          expect((await storkOracleFactory.parameter()).validFrom).to.equal(4)
        })

        it('#MAX_VALID_TIME_AFTER_VERSION', async () => {
          expect((await storkOracleFactory.parameter()).validTo).to.equal(10)
        })

        it('#GRACE_PERIOD', async () => {
          expect(await keeperOracle.timeout()).to.equal(60)
        })
      })

      describe('#commit', async () => {
        beforeEach(async () => {
          await time.increaseTo(OTHER_BATCHED_TIMESTAMP - 2)
        })
        it('commits successfully', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,int256,int256,int256,address)'](
                  user.address,
                  1,
                  0,
                  parse6decimal('10'),
                  constants.AddressZero,
                ),
            OTHER_BATCHED_TIMESTAMP,
          )

          expect(await keeperOracle.localCallbacks(OTHER_BATCHED_TIMESTAMP)).to.deep.eq([user.address])

          expect(await keeperOracle.requests(1)).to.be.equal(OTHER_BATCHED_TIMESTAMP)
          expect(await keeperOracle.next()).to.be.equal(OTHER_BATCHED_TIMESTAMP)
          await expect(
            storkOracleFactory
              .connect(user)
              .commit([STORK_ETH_USD_PRICE_FEED], OTHER_BATCHED_TIMESTAMP - 4, OTHER_UPDATE_DATA, {
                maxFeePerGas: 100000000,
              }),
          )
            .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
            .withArgs({ timestamp: OTHER_BATCHED_TIMESTAMP - 4, price: '2674940471', valid: true })
        })

        it('does not commit a version that has already been committed', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,int256,int256,int256,address)'](
                  user.address,
                  1,
                  0,
                  parse6decimal('10'),
                  constants.AddressZero,
                ),
            OTHER_BATCHED_TIMESTAMP,
          )

          expect(await keeperOracle.localCallbacks(OTHER_BATCHED_TIMESTAMP)).to.deep.eq([user.address])

          await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x5F5E100'])
          expect(await keeperOracle.requests(1)).to.be.equal(OTHER_BATCHED_TIMESTAMP)
          expect(await keeperOracle.next()).to.be.equal(OTHER_BATCHED_TIMESTAMP)
          await expect(
            storkOracleFactory
              .connect(user)
              .commit([STORK_ETH_USD_PRICE_FEED], OTHER_BATCHED_TIMESTAMP - 4, OTHER_UPDATE_DATA, {
                maxFeePerGas: 100000000,
              }),
          )
            .to.emit(keeperOracle, 'OracleProviderVersionFulfilled')
            .withArgs({ timestamp: OTHER_BATCHED_TIMESTAMP - 4, price: '2674940471', valid: true })

          await expect(
            storkOracleFactory
              .connect(user)
              .commit([STORK_ETH_USD_PRICE_FEED], OTHER_BATCHED_TIMESTAMP - 4, OTHER_UPDATE_DATA, {
                maxFeePerGas: 100000000,
              }),
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleVersionOutsideRangeError')
        })

        it('rejects invalid update data', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,int256,int256,int256,address)'](
                  user.address,
                  1,
                  0,
                  parse6decimal('10'),
                  constants.AddressZero,
                ),
            OTHER_BATCHED_TIMESTAMP,
          )
          expect(await keeperOracle.requests(1)).to.be.equal(OTHER_BATCHED_TIMESTAMP)
          expect(await keeperOracle.next()).to.be.equal(OTHER_BATCHED_TIMESTAMP)
          await expect(
            storkOracleFactory.connect(user).commit([STORK_ETH_USD_PRICE_FEED], OTHER_BATCHED_TIMESTAMP - 4, '0x'),
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleInvalidPriceError')
        })

        it('reverts if feeds ids length different from price commitment', async () => {
          const MULTIPLE_UPDATE_DATA_TIMESTAMP = 1741107060
          await time.increaseTo(MULTIPLE_UPDATE_DATA_TIMESTAMP - 2)
          await expect(
            storkOracleFactory
              .connect(user)
              .commit([STORK_ETH_USD_PRICE_FEED], MULTIPLE_UPDATE_DATA_TIMESTAMP - 4, MULTIPLE_UPDATE_DATA, {
                maxFeePerGas: 100000000,
              }),
          ).to.be.revertedWithCustomError(storkOracleFactory, 'StorkFactoryInputLengthMismatchError')
        })

        it('reverts if correct feed ids but incorrect ids', async () => {
          await storkOracleFactory.create(STORK_BTC_USD_PRICE_FEED, STORK_BTC_USD_PRICE_FEED, {
            provider: ethers.constants.AddressZero,
            decimals: 0,
          })
          const MULTIPLE_UPDATE_DATA_TIMESTAMP = 1741107060
          await time.increaseTo(MULTIPLE_UPDATE_DATA_TIMESTAMP - 2)
          await expect(
            storkOracleFactory
              .connect(user)
              .commit(
                [STORK_BTC_USD_PRICE_FEED, STORK_ETH_USD_PRICE_FEED],
                MULTIPLE_UPDATE_DATA_TIMESTAMP - 4,
                MULTIPLE_UPDATE_DATA,
              ),
          ).to.be.revertedWithCustomError(storkOracleFactory, 'StorkFactoryInvalidIdError')
        })
      })

      describe('#status', async () => {
        beforeEach(async () => {
          await time.increaseTo(OTHER_BATCHED_TIMESTAMP - 2)
        })
        it('returns the correct versions', async () => {
          await market
            .connect(user)
            ['update(address,int256,int256,int256,address)'](
              user.address,
              1,
              0,
              parse6decimal('10'),
              constants.AddressZero,
            ) // make request to oracle (new price)
          await storkOracleFactory
            .connect(user)
            .commit([STORK_ETH_USD_PRICE_FEED], OTHER_BATCHED_TIMESTAMP - 4, OTHER_UPDATE_DATA, {
              value: 1,
            })
          const [latestIndex, currentIndex] = await keeperOracle.status()
          expect(latestIndex.valid).to.be.true
          expect(latestIndex.price).to.equal('2674940471')
          expect(currentIndex).to.equal(await time.currentBlockTimestamp())
        })
      })

      describe('#request', async () => {
        beforeEach(async () => {
          await time.increaseTo(OTHER_BATCHED_TIMESTAMP - 2)
        })
        it('can request a version', async () => {
          // No requested versions
          expect((await keeperOracle.global()).currentIndex).to.equal(0)
          await expect(
            time.includeAt(
              async () =>
                await market
                  .connect(user)
                  ['update(address,int256,int256,int256,address)'](
                    user.address,
                    1,
                    0,
                    parse6decimal('10'),
                    constants.AddressZero,
                  ), // make request to oracle (new price)
              OTHER_BATCHED_TIMESTAMP,
            ),
          )
            .to.emit(keeperOracle, 'OracleProviderVersionRequested')
            .withArgs('1739222192', true)
          // Now there is exactly one requested version
          expect(await keeperOracle.requests(1)).to.be.equal(OTHER_BATCHED_TIMESTAMP)
          expect((await keeperOracle.global()).currentIndex).to.equal(1)
        })

        it('can request a version w/ granularity', async () => {
          const parameter = await storkOracleFactory.parameter()
          await storkOracleFactory.updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)

          // No requested versions
          expect((await keeperOracle.global()).currentIndex).to.equal(0)
          await market
            .connect(user)
            ['update(address,int256,int256,int256,address)'](
              user.address,
              1,
              0,
              parse6decimal('10'),
              constants.AddressZero,
            ) // make request to oracle (new price)
          const currentTimestamp = await storkOracleFactory.current()

          // Now there is exactly one requested version
          expect(await keeperOracle.requests(1)).to.be.equal(currentTimestamp)
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
          ).to.be.revertedWithCustomError(keeperOracle, 'KeeperOracleNotOracleError')
        })

        it('a version can only be requested once (new, new)', async () => {
          await ethers.provider.send('evm_setAutomine', [false])
          await ethers.provider.send('evm_setIntervalMining', [0])

          await market
            .connect(user)
            ['update(address,int256,int256,int256,address)'](
              user.address,
              1,
              0,
              parse6decimal('10'),
              constants.AddressZero,
            ) // make request to oracle (new price)
          await market
            .connect(user)
            ['update(address,int256,int256,int256,address)'](user.address, 2, 0, 0, constants.AddressZero) // make request to oracle (new price)

          await ethers.provider.send('evm_mine', [])

          const currentTimestamp = await storkOracleFactory.current()
          expect(await keeperOracle.requests(1)).to.be.equal(currentTimestamp)
          expect(await keeperOracle.requests(2)).to.be.equal(0)
        })
      })

      describe('#latest', async () => {
        beforeEach(async () => {
          await time.increaseTo(OTHER_BATCHED_TIMESTAMP - 2)
        })
        it('returns the latest version', async () => {
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,int256,int256,int256,address)'](
                  user.address,
                  1,
                  0,
                  parse6decimal('10'),
                  constants.AddressZero,
                ), // make request to oracle (new price)
            OTHER_BATCHED_TIMESTAMP,
          )
          await storkOracleFactory
            .connect(user)
            .commit([STORK_ETH_USD_PRICE_FEED], OTHER_BATCHED_TIMESTAMP - 4, OTHER_UPDATE_DATA, {
              value: 1,
            })
          const latestValue = await keeperOracle.connect(user).latest()
          expect(latestValue.valid).to.be.true
          expect(latestValue.price).to.equal('2674940471')
        })
      })

      describe('#current', async () => {
        it('returns the current timestamp', async () => {
          expect(await keeperOracle.connect(user).current()).to.equal(await time.currentBlockTimestamp())
        })

        it('returns the current timestamp w/ granularity == 0', async () => {
          const parameter = await storkOracleFactory.parameter()
          await expect(
            storkOracleFactory
              .connect(owner)
              .updateParameter(0, parameter.oracleFee, parameter.validFrom, parameter.validTo),
          ).to.be.revertedWithCustomError(storkOracleFactory, 'KeeperOracleParameterStorageInvalidError')
        })

        it('returns the current timestamp w/ granularity > MAX', async () => {
          const parameter = await storkOracleFactory.parameter()
          await expect(
            storkOracleFactory
              .connect(owner)
              .updateParameter(10001, parameter.oracleFee, parameter.validFrom, parameter.validTo),
          ).to.be.revertedWithCustomError(storkOracleFactory, 'KeeperFactoryInvalidParameterError')
          await expect(
            storkOracleFactory
              .connect(owner)
              .updateParameter(10000, parameter.oracleFee, parameter.validFrom, parameter.validTo),
          ).to.be.not.reverted
        })

        it('returns the current timestamp w/ fresh granularity > 1', async () => {
          const parameter = await storkOracleFactory.parameter()
          await storkOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)

          const parameter2 = await storkOracleFactory.parameter()
          expect(parameter2.latestGranularity).to.equal(1)
          expect(parameter2.currentGranularity).to.equal(10)
          expect(parameter2.effectiveAfter).to.equal(await time.currentBlockTimestamp())

          expect(await keeperOracle.connect(user).current()).to.equal(await time.currentBlockTimestamp())
        })

        it('returns the current timestamp w/ settled granularity > 1', async () => {
          const parameter = await storkOracleFactory.parameter()
          expect(parameter.latestGranularity).to.equal(1)
          expect(parameter.currentGranularity).to.equal(1)
          expect(parameter.effectiveAfter).to.equal(BATCHED_TIMESTAMP)

          await storkOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)

          const parameter2 = await storkOracleFactory.parameter()
          expect(parameter2.latestGranularity).to.equal(1)
          expect(parameter2.currentGranularity).to.equal(10)
          expect(parameter2.effectiveAfter).to.equal(await time.currentBlockTimestamp())

          await time.increase(1)

          expect(await keeperOracle.connect(user).current()).to.equal(
            Math.ceil((await time.currentBlockTimestamp()) / 10) * 10,
          )
        })

        it('returns the current timestamp w/ fresh + fresh granularity > 1', async () => {
          const parameter = await storkOracleFactory.parameter()
          await storkOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          // hardhat automatically moves 1 second ahead so we have to do this twice
          await storkOracleFactory
            .connect(owner)
            .updateParameter(100, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          await expect(
            storkOracleFactory
              .connect(owner)
              .updateParameter(1000, parameter.oracleFee, parameter.validFrom, parameter.validTo),
          ).to.be.revertedWithCustomError(storkOracleFactory, 'KeeperFactoryInvalidParameterError')
        })

        it('returns the current timestamp w/ settled + fresh granularity > 1', async () => {
          const parameter = await storkOracleFactory.parameter()
          await storkOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          await time.increase(1)

          await storkOracleFactory
            .connect(owner)
            .updateParameter(100, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          const parameter2 = await storkOracleFactory.parameter()
          expect(parameter2.latestGranularity).to.equal(10)
          expect(parameter2.currentGranularity).to.equal(100)
          expect(parameter2.effectiveAfter).to.equal(Math.ceil((await time.currentBlockTimestamp()) / 10) * 10)

          expect(await keeperOracle.connect(user).current()).to.equal(
            Math.ceil((await time.currentBlockTimestamp()) / 10) * 10,
          )
        })

        it('returns the current timestamp w/ settled + settled granularity > 1', async () => {
          const parameter = await storkOracleFactory.parameter()
          await storkOracleFactory
            .connect(owner)
            .updateParameter(10, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          await time.increase(1)

          await storkOracleFactory
            .connect(owner)
            .updateParameter(100, parameter.oracleFee, parameter.validFrom, parameter.validTo)
          const parameter2 = await storkOracleFactory.parameter()
          expect(parameter2.latestGranularity).to.equal(10)
          expect(parameter2.currentGranularity).to.equal(100)
          expect(parameter2.effectiveAfter).to.equal(Math.ceil((await time.currentBlockTimestamp()) / 10) * 10)

          const previousCurrent = Math.ceil((await time.currentBlockTimestamp()) / 10) * 10
          await time.increase(previousCurrent - (await time.currentBlockTimestamp()) + 1)

          expect(await keeperOracle.connect(user).current()).to.equal(
            Math.ceil((await time.currentBlockTimestamp()) / 100) * 100,
          )
        })
      })

      describe('#atVersion', async () => {
        beforeEach(async () => {
          await time.increaseTo(OTHER_BATCHED_TIMESTAMP - 2)
        })
        it('returns the correct version', async () => {
          const parameter = await storkOracleFactory.parameter()
          await storkOracleFactory
            .connect(owner)
            .updateParameter(1, parse6decimal('0.1'), parameter.validFrom, parameter.validTo)
          await time.includeAt(
            async () =>
              await market
                .connect(user)
                ['update(address,int256,int256,int256,address)'](
                  user.address,
                  1,
                  0,
                  parse6decimal('10'),
                  constants.AddressZero,
                ), // make request to oracle (new price)
            OTHER_BATCHED_TIMESTAMP,
          )

          await storkOracleFactory
            .connect(user)
            .commit([STORK_ETH_USD_PRICE_FEED], OTHER_BATCHED_TIMESTAMP - 4, OTHER_UPDATE_DATA, {
              value: 1,
            })
          const version = await keeperOracle.connect(user).at(OTHER_BATCHED_TIMESTAMP - 4)
          expect(version[0].price).to.equal('2674940471')
          expect(version[0].valid).to.equal(true)
        })

        it('returns invalid version if that version was not requested', async () => {
          const version = await keeperOracle.connect(user).at(OTHER_BATCHED_TIMESTAMP)
          expect(version[0].valid).to.be.false
        })

        it('returns invalid version if that version was requested but not committed', async () => {
          await market
            .connect(user)
            ['update(address,int256,int256,int256,address)'](
              user.address,
              1,
              0,
              parse6decimal('10'),
              constants.AddressZero,
            ) // make request to oracle (new price)
          const version = await keeperOracle.connect(user).at(OTHER_BATCHED_TIMESTAMP)
          expect(version[0].valid).to.be.false
        })
      })
    })
  })
})
