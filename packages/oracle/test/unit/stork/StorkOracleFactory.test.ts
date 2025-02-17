import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { mine } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  AggregatorV3Interface,
  IERC20Metadata,
  IMarket,
  Oracle,
  Oracle__factory,
  OracleFactory,
  OracleFactory__factory,
  IMarketFactory,
  KeeperOracle,
  KeeperOracle__factory,
  GasOracle,
  StorkFactory,
  StorkFactory__factory,
  IStork,
} from '../../../types/generated'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { utils, BigNumber, BigNumberish } from 'ethers'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'

const { ethers } = HRE

const STORK_ETH_USD_PRICE_FEED = '0x59102b37de83bdda9f38ac8254e596f0d9ac61d2035c07936675e87342817160'

const getVaa = (timestampNs: BigNumberish, quantizedValue: BigNumberish) => {
  const temporalNumericValue = {
    timestampNs: timestampNs,
    quantizedValue: quantizedValue,
  }

  const temporalNumericValueInput = []
  temporalNumericValueInput.push({
    temporalNumericValue: temporalNumericValue,
    id: STORK_ETH_USD_PRICE_FEED,
    publisherMerkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
    valueComputeAlgHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    r: '0x0000000000000000000000000000000000000000000000000000000000000000',
    s: '0x0000000000000000000000000000000000000000000000000000000000000000',
    v: 27,
  })

  // Encode the struct
  const encodedData = ethers.utils.defaultAbiCoder.encode(
    [
      'tuple(tuple(uint64 timestampNs, int192 quantizedValue) temporalNumericValue, bytes32 id, bytes32 publisherMerkleRoot, bytes32 valueComputeAlgHash, bytes32 r, bytes32 s, uint8 v)[]',
    ],
    [temporalNumericValueInput],
  )
  return encodedData
}

describe('StorkOracleFactory', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let stork: FakeContract<IStork>
  let commitmentGasOracle: FakeContract<GasOracle>
  let settlementGasOracle: FakeContract<GasOracle>
  let oracle: Oracle
  let keeperOracle: KeeperOracle
  let storkOracleFactory: StorkFactory
  let oracleFactory: OracleFactory
  let dsu: FakeContract<IERC20Metadata>
  let oracleSigner: SignerWithAddress
  let market: FakeContract<IMarket>
  let marketFactory: FakeContract<IMarketFactory>

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    stork = await smock.fake<IStork>('IStork')
    stork.storkPublicKey.returns('0x0000000000000000000000000000000000000000')
    stork.verifyStorkSignatureV1.returns(true)

    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
    dsu.transfer.returns(true)

    market = await smock.fake<IMarket>('IMarket')
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    market.factory.returns(marketFactory.address)
    marketFactory.instances.whenCalledWith(market.address).returns(true)
    market.settle.returns()
    market.token.returns(dsu.address)

    const oracleImpl = await new Oracle__factory(owner).deploy()
    oracleFactory = await new OracleFactory__factory(owner).deploy(oracleImpl.address)
    await oracleFactory.initialize()

    commitmentGasOracle = await smock.fake<GasOracle>('GasOracle')
    commitmentGasOracle.cost.whenCalledWith(1).returns(utils.parseEther('0.20'))
    settlementGasOracle = await smock.fake<GasOracle>('GasOracle')
    settlementGasOracle.cost.whenCalledWith(0).returns(utils.parseEther('0.05'))

    const keeperOracleImpl = await new KeeperOracle__factory(owner).deploy(60)
    storkOracleFactory = await new StorkFactory__factory(owner).deploy(
      stork.address,
      commitmentGasOracle.address,
      settlementGasOracle.address,
      keeperOracleImpl.address,
    )
    await storkOracleFactory.initialize(oracleFactory.address)
    await storkOracleFactory.updateParameter(1, 0, 4, 10)
    await oracleFactory.register(storkOracleFactory.address)

    keeperOracle = KeeperOracle__factory.connect(
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
      await oracleFactory.callStatic.create(STORK_ETH_USD_PRICE_FEED, storkOracleFactory.address, 'ETH-USD'),
      owner,
    )
    await oracleFactory.create(STORK_ETH_USD_PRICE_FEED, storkOracleFactory.address, 'ETH-USD')

    await keeperOracle.register(oracle.address)
    await oracle.register(market.address)

    oracleSigner = await impersonateWithBalance(oracle.address, utils.parseEther('10'))
  })

  it('factoryType is StorkFactory', async () => {
    expect(await storkOracleFactory.factoryType()).to.equal('StorkFactory')
    // hacks around issue mocking market.settle on subsequent test
    mine()
  })

  it('parses Stork exponents correctly', async () => {
    market.claimFee.returns(utils.parseUnits('0.25', 6))

    const minDelay = (await storkOracleFactory.parameter()).validFrom
    await keeperOracle.connect(oracleSigner).request(market.address, user.address)
    await storkOracleFactory
      .connect(user)
      .commit(
        [STORK_ETH_USD_PRICE_FEED],
        await keeperOracle.callStatic.next(),
        getVaa((await keeperOracle.callStatic.next()).add(minDelay).mul(1e9), ethers.utils.parseUnits('1', 18)),
        {
          value: 1,
        },
      )
    expect((await keeperOracle.callStatic.latest()).price).to.equal(ethers.utils.parseUnits('1', 6))

    await keeperOracle.connect(oracleSigner).request(market.address, user.address)
    await storkOracleFactory
      .connect(user)
      .commit(
        [STORK_ETH_USD_PRICE_FEED],
        await keeperOracle.callStatic.next(),
        getVaa((await keeperOracle.callStatic.next()).add(minDelay).mul(1e9), ethers.utils.parseUnits('2', 18)),
        {
          value: 1,
        },
      )
    expect((await keeperOracle.callStatic.latest()).price).to.equal(ethers.utils.parseUnits('2', 6))
  })

  describe('#updateId', async () => {
    it('updates max claim', async () => {
      expect(await storkOracleFactory.ids(keeperOracle.address)).to.equal(STORK_ETH_USD_PRICE_FEED)
      await storkOracleFactory.updateId(
        keeperOracle.address,
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      )
      expect(await storkOracleFactory.ids(keeperOracle.address)).to.equal(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      )
    })

    it('reverts if not owner', async () => {
      await expect(
        storkOracleFactory.connect(user).updateId(keeperOracle.address, STORK_ETH_USD_PRICE_FEED),
      ).to.be.revertedWithCustomError(storkOracleFactory, 'OwnableNotOwnerError')
    })
  })
})
