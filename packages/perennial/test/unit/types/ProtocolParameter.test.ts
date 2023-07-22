import { smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { ProtocolParameterTester, ProtocolParameterTester__factory } from '../../../types/generated'
import { BigNumber } from 'ethers'
import { ProtocolParameterStruct } from '../../../types/generated/contracts/MarketFactory'

const { ethers } = HRE
use(smock.matchers)

export const VALID_PROTOCOL_PARAMETER: ProtocolParameterStruct = {
  protocolFee: 2,
  maxFee: 3,
  maxFeeAbsolute: 4,
  maxCut: 5,
  maxRate: 6,
  minMaintenance: 7,
  minEfficiency: 8,
}

describe('ProtocolParameter', () => {
  let owner: SignerWithAddress

  let protocolParameter: ProtocolParameterTester

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    protocolParameter = await new ProtocolParameterTester__factory(owner).deploy()
  })

  describe('#store', () => {
    it('stores a new value', async () => {
      await protocolParameter.store(VALID_PROTOCOL_PARAMETER)

      const value = await protocolParameter.read()
      expect(value.protocolFee).to.equal(2)
      expect(value.maxFee).to.equal(3)
      expect(value.maxFeeAbsolute).to.equal(4)
      expect(value.maxCut).to.equal(5)
      expect(value.maxRate).to.equal(6)
      expect(value.minMaintenance).to.equal(7)
      expect(value.minEfficiency).to.equal(8)
    })

    context('.protocolFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await protocolParameter.store({
          ...VALID_PROTOCOL_PARAMETER,
          protocolFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await protocolParameter.read()
        expect(value.protocolFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          protocolParameter.store({
            ...VALID_PROTOCOL_PARAMETER,
            protocolFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(protocolParameter, 'ProtocolParameterStorageInvalidError')
      })
    })

    context('.maxFee', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await protocolParameter.store({
          ...VALID_PROTOCOL_PARAMETER,
          maxFee: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await protocolParameter.read()
        expect(value.maxFee).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          protocolParameter.store({
            ...VALID_PROTOCOL_PARAMETER,
            maxFee: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(protocolParameter, 'ProtocolParameterStorageInvalidError')
      })
    })

    context('.maxFeeAbsolute', async () => {
      const STORAGE_SIZE = 48
      it('saves if in range', async () => {
        await protocolParameter.store({
          ...VALID_PROTOCOL_PARAMETER,
          maxFeeAbsolute: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await protocolParameter.read()
        expect(value.maxFeeAbsolute).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          protocolParameter.store({
            ...VALID_PROTOCOL_PARAMETER,
            maxFeeAbsolute: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(protocolParameter, 'ProtocolParameterStorageInvalidError')
      })
    })

    context('.maxCut', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await protocolParameter.store({
          ...VALID_PROTOCOL_PARAMETER,
          maxCut: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await protocolParameter.read()
        expect(value.maxCut).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          protocolParameter.store({
            ...VALID_PROTOCOL_PARAMETER,
            maxCut: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(protocolParameter, 'ProtocolParameterStorageInvalidError')
      })
    })

    context('.maxRate', async () => {
      const STORAGE_SIZE = 32
      it('saves if in range', async () => {
        await protocolParameter.store({
          ...VALID_PROTOCOL_PARAMETER,
          maxRate: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await protocolParameter.read()
        expect(value.maxRate).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          protocolParameter.store({
            ...VALID_PROTOCOL_PARAMETER,
            maxRate: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(protocolParameter, 'ProtocolParameterStorageInvalidError')
      })
    })

    context('.minMaintenance', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await protocolParameter.store({
          ...VALID_PROTOCOL_PARAMETER,
          minMaintenance: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await protocolParameter.read()
        expect(value.minMaintenance).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          protocolParameter.store({
            ...VALID_PROTOCOL_PARAMETER,
            minMaintenance: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(protocolParameter, 'ProtocolParameterStorageInvalidError')
      })
    })

    context('.minEfficiency', async () => {
      const STORAGE_SIZE = 24
      it('saves if in range', async () => {
        await protocolParameter.store({
          ...VALID_PROTOCOL_PARAMETER,
          minEfficiency: BigNumber.from(2).pow(STORAGE_SIZE).sub(1),
        })
        const value = await protocolParameter.read()
        expect(value.minEfficiency).to.equal(BigNumber.from(2).pow(STORAGE_SIZE).sub(1))
      })

      it('reverts if out of range', async () => {
        await expect(
          protocolParameter.store({
            ...VALID_PROTOCOL_PARAMETER,
            minEfficiency: BigNumber.from(2).pow(STORAGE_SIZE),
          }),
        ).to.be.revertedWithCustomError(protocolParameter, 'ProtocolParameterStorageInvalidError')
      })
    })
  })
})
