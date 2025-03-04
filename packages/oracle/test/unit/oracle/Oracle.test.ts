import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE from 'hardhat'

import {
  IERC20Metadata,
  IMarket,
  IMarketFactory,
  IOracleFactory,
  IOracleProvider,
  Oracle,
  Oracle__factory,
} from '../../../types/generated'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { DEFAULT_ORACLE_RECEIPT, parse6decimal } from '../../../../common/testutil/types'
import { impersonate } from '../../../../common/testutil'
import { utils } from 'ethers'
import { OracleReceiptStruct, OracleVersionStruct } from '../../../types/generated/contracts/Oracle'
import exp from 'constants'

const { ethers } = HRE

function mockVersion(
  oracle: FakeContract<IOracleProvider>,
  latestVersion: OracleVersionStruct,
  latestReceipt: OracleReceiptStruct,
  currentTimestamp: number,
) {
  oracle.request.returns()
  oracle.status.returns([latestVersion, currentTimestamp])
  oracle.latest.returns(latestVersion)
  oracle.current.returns(currentTimestamp)
  oracle.at.whenCalledWith(latestVersion.timestamp).returns([latestVersion, latestReceipt])
}

describe('Oracle', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let beneficiary: SignerWithAddress

  let oracle: Oracle
  let underlying0: FakeContract<IOracleProvider>
  let underlying1: FakeContract<IOracleProvider>
  let underlying0Signer: SignerWithAddress
  let underlying1Signer: SignerWithAddress
  let oracleFactory: FakeContract<IOracleFactory>
  let oracleFactorySigner: SignerWithAddress
  let market: FakeContract<IMarket>
  let marketSigner: SignerWithAddress
  let marketFactory: FakeContract<IMarketFactory>
  let dsu: FakeContract<IERC20Metadata>

  beforeEach(async () => {
    ;[owner, user, beneficiary] = await ethers.getSigners()
    market = await smock.fake<IMarket>('IMarket')
    marketSigner = await impersonate.impersonateWithBalance(market.address, utils.parseEther('10'))
    marketFactory = await smock.fake<IMarketFactory>('IMarketFactory')
    market.factory.returns(marketFactory.address)
    marketFactory.instances.whenCalledWith(market.address).returns(true)
    oracle = await new Oracle__factory(owner).deploy()
    underlying0 = await smock.fake<IOracleProvider>('IOracleProvider')
    underlying1 = await smock.fake<IOracleProvider>('IOracleProvider')
    underlying0Signer = await impersonate.impersonateWithBalance(underlying0.address, ethers.utils.parseEther('1000'))
    underlying1Signer = await impersonate.impersonateWithBalance(underlying1.address, ethers.utils.parseEther('1000'))
    oracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
    oracleFactorySigner = await impersonate.impersonateWithBalance(oracleFactory.address, utils.parseEther('10'))
    oracleFactory.owner.returns(owner.address)
    dsu = await smock.fake<IERC20Metadata>('IERC20Metadata')
  })

  describe('#initializer', async () => {
    it('sets initial oracle w/o initial version', async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 0,
          price: parse6decimal('0'),
          valid: false,
        },
        {
          settlementFee: 1234,
          oracleFee: 5678,
        },
        0,
      )

      await expect(oracle.connect(oracleFactorySigner).initialize(underlying0.address, 'ETH-USD'))
        .to.emit(oracle, 'OracleUpdated')
        .withArgs(underlying0.address)

      expect(await oracle.factory()).to.equal(oracleFactory.address)
      expect((await oracle.global()).current).to.equal(1)
      expect((await oracle.global()).latest).to.equal(1)
      expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
      expect((await oracle.oracles(1)).timestamp).to.equal(0)
    })

    it('sets initial oracle w/ initial version', async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 1687229000,
          price: parse6decimal('999'),
          valid: true,
        },
        {
          settlementFee: 1234,
          oracleFee: 5678,
        },
        1687229905,
      )

      await expect(oracle.connect(oracleFactorySigner).initialize(underlying0.address, 'ETH-USD'))
        .to.emit(oracle, 'OracleUpdated')
        .withArgs(underlying0.address)

      expect(await oracle.factory()).to.equal(oracleFactory.address)
      expect((await oracle.global()).current).to.equal(1)
      expect((await oracle.global()).latest).to.equal(1)
      expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
      expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
    })

    it('reverts if already initialized', async () => {
      await oracle.connect(oracleFactorySigner).initialize(underlying0.address, 'ETH-USD')

      await expect(oracle.connect(oracleFactorySigner).initialize(underlying0.address, 'ETH-USD'))
        .to.be.revertedWithCustomError(oracle, 'InitializableAlreadyInitializedError')
        .withArgs(1)
    })
  })

  describe('#withdraw', async () => {
    beforeEach(async () => {
      await oracle.connect(oracleFactorySigner).initialize(underlying0.address, 'ETH-USD')
      await oracle.register(market.address)
    })

    it('can withdraw balance', async () => {
      await expect(oracle.connect(owner).updateBeneficiary(beneficiary.address))
        .to.emit(oracle, 'BeneficiaryUpdated')
        .withArgs(beneficiary.address)

      dsu.balanceOf.whenCalledWith(oracle.address).returns(ethers.utils.parseEther('10000'))
      dsu.transfer.whenCalledWith(beneficiary.address, ethers.utils.parseEther('10000')).returns(true)

      await oracle.connect(beneficiary).withdraw(dsu.address)

      expect(dsu.transfer).to.have.been.calledWith(beneficiary.address, ethers.utils.parseEther('10000'))
    })

    it('reverts if not owner', async () => {
      dsu.transfer.whenCalledWith(owner.address, ethers.utils.parseEther('10000')).returns(true)

      await expect(oracle.connect(user).withdraw(dsu.address)).to.be.revertedWithCustomError(
        oracle,
        'OracleNotBeneficiaryError',
      )
    })
  })

  describe('#update', async () => {
    beforeEach(async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 1687229000,
          price: parse6decimal('999'),
          valid: true,
        },
        {
          settlementFee: 1234,
          oracleFee: 5678,
        },
        1687229905,
      )
      await oracle.connect(oracleFactorySigner).initialize(underlying0.address, 'ETH-USD')
      await oracle.register(market.address)
    })

    context('updates the oracle w/o sync', async () => {
      beforeEach(async () => {
        await expect(oracle.connect(oracleFactorySigner).update(underlying1.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying1.address)
      })

      it('updates the oracle', async () => {
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(0)

        const [latestVersion, currentTimestamp] = await oracle.status()
        expect(latestVersion.timestamp).to.equal(1687229000)
        expect(latestVersion.price).to.equal(parse6decimal('999'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(0)

        expect((await oracle.at(1687229000))[0]).to.deep.equal(latestVersion)
        expect((await oracle.at(1687229000))[1].settlementFee).to.deep.equal(1234)
        expect((await oracle.at(1687229000))[1].oracleFee).to.deep.equal(5678)
      })

      it('syncs another version', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230605,
            price: parse6decimal('1006'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        // Latest should not be updated until we call request
        expect((await oracle.global()).latest).to.equal(1)

        const [latestVersionDirect, currentTimestampDirect] = [await oracle.latest(), await oracle.current()]
        const [latestVersion, currentTimestamp] = await oracle.status()
        await oracle.connect(marketSigner).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230000)
        expect(latestVersion.price).to.equal(parse6decimal('1000'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(2)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687229905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('reverts when oracle out of sync', async () => {
        const underlying2 = await smock.fake<IOracleProvider>('IOracleProvider')

        await expect(oracle.connect(oracleFactorySigner).update(underlying2.address)).to.revertedWithCustomError(
          oracle,
          'OracleOutOfSyncError',
        )
      })
    })

    context('updates the oracle w/ sync', async () => {
      beforeEach(async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230005,
            price: parse6decimal('1001'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687230905,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687230905,
        )
        await oracle.connect(marketSigner).request(market.address, user.address)
        await expect(oracle.connect(oracleFactorySigner).update(underlying1.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying1.address)
      })

      it('updates the oracle', async () => {
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687230905)

        underlying0.at.whenCalledWith(1687230905).returns([
          {
            timestamp: 1687230905,
            price: parse6decimal('987'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
        ])
        underlying1.at.whenCalledWith(1687230905).returns([
          {
            timestamp: 1687230905,
            price: parse6decimal('988'),
            valid: true,
          },
          {
            settlementFee: 1235,
            oracleFee: 5679,
          },
        ])
        expect((await oracle.at(1687230905))[0].timestamp).to.equal(1687230905)
        expect((await oracle.at(1687230905))[0].price).to.equal(parse6decimal('987'))
        expect((await oracle.at(1687230905))[0].valid).to.equal(true)
      })

      it('requests another before current has cleared', async () => {
        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [await oracle.latest(), await oracle.current()]
        const [latestVersion, currentTimestamp] = await oracle.status()
        await oracle.connect(marketSigner).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230005)
        expect(latestVersion.price).to.equal(parse6decimal('1001'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687230905)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687230905)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.been.called
        expect(underlying1.request).to.have.not.been.called
      })

      it('syncs another version with previous latest', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230605,
            price: parse6decimal('1006'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [await oracle.latest(), await oracle.current()]
        const [latestVersion, currentTimestamp] = await oracle.status()
        await oracle.connect(marketSigner).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230605)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('syncs another version equal to latest', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230905,
            price: parse6decimal('1006'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [await oracle.latest(), await oracle.current()]
        const [latestVersion, currentTimestamp] = await oracle.status()
        await oracle.connect(marketSigner).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230905)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('syncs another version after latest before current', async () => {
        underlying0.at.whenCalledWith(1687230905).returns([
          {
            timestamp: 1687230905,
            price: parse6decimal('1006'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
        ])
        mockVersion(
          underlying0,
          {
            timestamp: 1687230955,
            price: parse6decimal('1008'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1007'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [await oracle.latest(), await oracle.current()]
        const [latestVersion, currentTimestamp] = await oracle.status()
        await oracle.connect(marketSigner).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230905)
        expect(latestVersion.price).to.equal(parse6decimal('1006'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('syncs another version after latest after current', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230955,
            price: parse6decimal('1008'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230955,
            price: parse6decimal('1007'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [await oracle.latest(), await oracle.current()]
        const [latestVersion, currentTimestamp] = await oracle.status()
        await oracle.connect(marketSigner).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687230955)
        expect(latestVersion.price).to.equal(parse6decimal('1007'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687231005)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(2)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231005)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('syncs another version after all up-to-date', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230955,
            price: parse6decimal('1008'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230955,
            price: parse6decimal('1007'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        await oracle.connect(marketSigner).request(market.address, user.address)

        mockVersion(
          underlying1,
          {
            timestamp: 1687235000,
            price: parse6decimal('1015'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687235080,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        const [latestVersionDirect, currentTimestampDirect] = [await oracle.latest(), await oracle.current()]
        const [latestVersion, currentTimestamp] = await oracle.status()
        await oracle.connect(marketSigner).request(market.address, user.address)

        expect(latestVersion.timestamp).to.equal(1687235000)
        expect(latestVersion.price).to.equal(parse6decimal('1015'))
        expect(latestVersion.valid).to.equal(true)
        expect(currentTimestamp).to.equal(1687235080)
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(2)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687230905)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687235080)
        expect(latestVersionDirect).to.deep.equal(latestVersion)
        expect(currentTimestampDirect).to.deep.equal(currentTimestamp)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })

      it('properly triages at', async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230955,
            price: parse6decimal('1008'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230955,
            price: parse6decimal('1007'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )

        underlying0.request.reset()
        underlying1.request.reset()

        await oracle.connect(marketSigner).request(market.address, user.address)

        expect((await oracle.at(0))[0].timestamp).to.equal(0)
        expect((await oracle.at(0))[0].price).to.equal(parse6decimal('0'))
        expect((await oracle.at(0))[0].valid).to.equal(false)
        underlying0.at.whenCalledWith(1677229905).returns([
          {
            timestamp: 1677229905,
            price: parse6decimal('800'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
        ])
        expect((await oracle.at(1677229905))[0].timestamp).to.equal(1677229905)
        expect((await oracle.at(1677229905))[0].price).to.equal(parse6decimal('800'))
        expect((await oracle.at(1677229905))[0].valid).to.equal(true)
        underlying0.at.whenCalledWith(1687230905).returns([
          {
            timestamp: 1687230905,
            price: parse6decimal('999'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
        ])
        expect((await oracle.at(1687230905))[0].timestamp).to.equal(1687230905)
        expect((await oracle.at(1687230905))[0].price).to.equal(parse6decimal('999'))
        expect((await oracle.at(1687230905))[0].valid).to.equal(true)
        underlying1.at.whenCalledWith(1687230906).returns([
          {
            timestamp: 1687230906,
            price: parse6decimal('1001'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
        ])
        expect((await oracle.at(1687230906))[0].timestamp).to.equal(1687230906)
        expect((await oracle.at(1687230906))[0].price).to.equal(parse6decimal('1001'))
        expect((await oracle.at(1687230906))[0].valid).to.equal(true)

        expect(underlying0.request).to.have.not.been.called
        expect(underlying1.request).to.have.been.called
      })
    })

    context('updates the oracle w/ non-requested latest', async () => {
      beforeEach(async () => {
        mockVersion(
          underlying0,
          {
            timestamp: 1687230005,
            price: parse6decimal('1001'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687230905,
        )
        await oracle.connect(marketSigner).request(market.address, user.address)

        mockVersion(
          underlying0,
          {
            timestamp: 1687231005,
            price: parse6decimal('1001'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231905,
        )
        mockVersion(
          underlying1,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231905,
        )
        await expect(oracle.connect(oracleFactorySigner).update(underlying1.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying1.address)
      })

      it('updates the oracle without going back in time', async () => {
        expect((await oracle.global()).current).to.equal(2)
        expect((await oracle.global()).latest).to.equal(1)
        expect((await oracle.oracles(1)).provider).to.equal(underlying0.address)
        expect((await oracle.oracles(1)).timestamp).to.equal(1687231005)
        expect((await oracle.oracles(2)).provider).to.equal(underlying1.address)
        expect((await oracle.oracles(2)).timestamp).to.equal(1687231905)

        underlying0.at.whenCalledWith(1687231005).returns([
          {
            timestamp: 1687231005,
            price: parse6decimal('987'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
        ])
        underlying1.at.whenCalledWith(1687231005).returns([
          {
            timestamp: 1687231005,
            price: parse6decimal('988'),
            valid: true,
          },
          {
            settlementFee: 1235,
            oracleFee: 5679,
          },
        ])
        expect((await oracle.at(1687231005))[0].timestamp).to.equal(1687231005)
        expect((await oracle.at(1687231005))[0].price).to.equal(parse6decimal('987'))
        expect((await oracle.at(1687231005))[0].valid).to.equal(true)
      })
    })

    context('updates the oracle from a blank oracle', async () => {
      beforeEach(async () => {
        oracle = await new Oracle__factory(owner).deploy()
        await oracle.connect(oracleFactorySigner).initialize(underlying1.address, 'ETH-USD')
        await oracle.register(market.address)
      })

      it('updates the oracle', async () => {
        const underlying2 = await smock.fake<IOracleProvider>('IOracleProvider')
        await expect(oracle.connect(oracleFactorySigner).update(underlying2.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying2.address)

        expect((await oracle.global()).latest).to.equal(1)

        mockVersion(
          underlying2,
          {
            timestamp: 1687230000,
            price: parse6decimal('1000'),
            valid: true,
          },
          {
            settlementFee: 1234,
            oracleFee: 5678,
          },
          1687231005,
        )
        underlying1.request.reset()
        underlying2.request.reset()
        await oracle.connect(marketSigner).request(market.address, user.address)

        expect((await oracle.global()).latest).to.equal(2)
        expect((await oracle.oracles(1)).timestamp).to.equal(0)
      })

      it('cannot update the oracle to two successive blank oracles', async () => {
        const underlying2 = await smock.fake<IOracleProvider>('IOracleProvider')
        await expect(oracle.connect(oracleFactorySigner).update(underlying2.address))
          .to.emit(oracle, 'OracleUpdated')
          .withArgs(underlying2.address)

        const underlying3 = await smock.fake<IOracleProvider>('IOracleProvider')
        await expect(oracle.connect(oracleFactorySigner).update(underlying3.address)).to.revertedWithCustomError(
          oracle,
          'OracleOutOfSyncError',
        )
      })
    })

    it('reverts when not the owner', async () => {
      await expect(oracle.connect(user).update(underlying1.address)).to.revertedWithCustomError(
        oracle,
        'InstanceNotFactoryError',
      )
    })
  })

  describe('#claimFee', async () => {
    beforeEach(async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 1687229000,
          price: parse6decimal('999'),
          valid: true,
        },
        {
          settlementFee: 1234,
          oracleFee: 5678,
        },
        1687229905,
      )
      await oracle.connect(oracleFactorySigner).initialize(underlying0.address, 'ETH-USD')
      await oracle.connect(owner).register(market.address)
    })

    it('claims the assets', async () => {
      market.claimFee.returns(parse6decimal('15'))
      market.token.returns(dsu.address)

      dsu.transfer.whenCalledWith(underlying0.address, parse6decimal('10').mul(1e12)).returns(true)

      await expect(oracle.connect(underlying0Signer).claimFee(parse6decimal('10')))
        .to.emit(oracle, 'FeeReceived')
        .withArgs(parse6decimal('10'), parse6decimal('5'))

      expect(dsu.transfer).to.have.been.calledWith(underlying0.address, parse6decimal('10').mul(1e12))
    })

    it('reverts if not instance', async () => {
      await expect(oracle.connect(user).claimFee(parse6decimal('10'))).to.be.revertedWithCustomError(
        oracle,
        'OracleNotSubOracleError',
      )
    })
  })

  describe('#register', async () => {
    beforeEach(async () => {
      mockVersion(
        underlying0,
        {
          timestamp: 1687229000,
          price: parse6decimal('999'),
          valid: true,
        },
        {
          settlementFee: 1234,
          oracleFee: 5678,
        },
        1687229905,
      )
      await oracle.connect(oracleFactorySigner).initialize(underlying0.address, 'ETH-USD')
    })

    it('reverts when not the authorized', async () => {
      await expect(oracle.connect(user).request(market.address, user.address)).to.revertedWithCustomError(
        oracle,
        'OracleNotMarketError',
      )
    })
  })
})
