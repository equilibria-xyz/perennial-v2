import { expect } from 'chai'
import { ethers } from 'hardhat'
import { constants } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { parse6decimal } from '../../../../common/testutil/types'
import {
  RebalanceConfigLib,
  RebalanceConfigLib__factory,
  RebalanceConfigTester__factory,
} from '../../../types/generated'
import {
  RebalanceConfigStruct,
  RebalanceConfigTester,
} from '../../../types/generated/contracts/CollateralAccounts/test/RebalanceConfigTester'

describe('RebalanceConfig', () => {
  let owner: SignerWithAddress
  let rebalanceConfigLib: RebalanceConfigLib
  let tester: RebalanceConfigTester

  const VALID_REBALANCE_CONFIG: RebalanceConfigStruct = {
    target: parse6decimal('0.60'),
    threshold: parse6decimal('0.05'),
  }

  before(async () => {
    ;[owner] = await ethers.getSigners()
    rebalanceConfigLib = await new RebalanceConfigLib__factory(owner).deploy()
    tester = await new RebalanceConfigTester__factory(
      {
        'contracts/CollateralAccounts/types/RebalanceConfig.sol:RebalanceConfigLib': rebalanceConfigLib.address,
      },
      owner,
    ).deploy()
  })

  describe('#store', () => {
    it('stores a valid configuration', async () => {
      await tester.store(VALID_REBALANCE_CONFIG)

      const value = await tester.read()
      expect(value.target).to.equal(parse6decimal('0.60'))
      expect(value.threshold).to.equal(parse6decimal('0.05'))
    })

    it('reverts if target out of range', async () => {
      await expect(
        tester.store({
          ...VALID_REBALANCE_CONFIG,
          target: parse6decimal('1.1'),
        }),
      ).to.be.revertedWithCustomError(rebalanceConfigLib, 'RebalanceConfigStorageInvalidError')

      await expect(
        tester.store({
          ...VALID_REBALANCE_CONFIG,
          target: constants.MaxUint256,
        }),
      ).to.be.revertedWithCustomError(rebalanceConfigLib, 'RebalanceConfigStorageInvalidError')
    })

    it('reverts if threshold out of range', async () => {
      await expect(
        tester.store({
          ...VALID_REBALANCE_CONFIG,
          threshold: parse6decimal('1.2'),
        }),
      ).to.be.revertedWithCustomError(rebalanceConfigLib, 'RebalanceConfigStorageInvalidError')

      await expect(
        tester.store({
          ...VALID_REBALANCE_CONFIG,
          threshold: constants.MaxUint256,
        }),
      ).to.be.revertedWithCustomError(rebalanceConfigLib, 'RebalanceConfigStorageInvalidError')
    })
  })
})
