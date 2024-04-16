import { smock, FakeContract } from '@defi-wonderland/smock'
import { constants, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import HRE from 'hardhat'

import { IntentStruct } from '../../../types/generated/contracts/Verifier'
import { Verifier, Verifier__factory } from '../../../types/generated'
import { parse6decimal } from '../../../../common/testutil/types'

const { ethers } = HRE
use(smock.matchers)

function erc721Domain(verifier: Verifier) {
  return {
    name: 'Perennial',
    version: '1.0.0',
    chainId: 31337, // hardhat chain id
    verifyingContract: verifier.address,
  }
}

async function signIntent(signer: SignerWithAddress, verifier: Verifier, intent: IntentStruct): Promise<string> {
  const types = {
    Common: [
      { name: 'account', type: 'address' },
      { name: 'domain', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'group', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
    Intent: [
      { name: 'amount', type: 'int256' },
      { name: 'price', type: 'int256' },
      { name: 'common', type: 'Common' },
    ],
  }

  return await signer._signTypedData(erc721Domain(verifier), types, intent)
}

describe('Coordinator', () => {
  let owner: SignerWithAddress
  let market: SignerWithAddress
  let caller: SignerWithAddress
  let caller2: SignerWithAddress
  let verifier: Verifier

  beforeEach(async () => {
    ;[owner, market, caller, caller2] = await ethers.getSigners()

    verifier = await new Verifier__factory(owner).deploy()
  })

  describe('#verifyIntent', () => {
    it('should verify a correct intent message', async () => {
      const intent = {
        amount: parse6decimal('10'),
        price: parse6decimal('123'),
        common: {
          account: caller.address,
          domain: market.address,
          nonce: 1,
          group: 17,
          expiry: 0,
        },
      }

      const signature = await signIntent(caller, verifier, intent)

      const result = await verifier.connect(market).callStatic.verifyIntent(intent, signature)
      await expect(verifier.connect(market).verifyIntent(intent, signature))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 1)

      expect(result).to.eq(caller.address)
      expect(await verifier.nonces(caller.address, 1)).to.eq(true)
    })
  })

  describe('#cancelNonce', () => {
    it('should cancel the nonce for the account', async () => {
      await expect(verifier.connect(caller).cancelNonce(1))
        .to.emit(verifier, 'NonceCancelled')
        .withArgs(caller.address, 1)

      expect(await verifier.nonces(caller.address, 1)).to.eq(true)
    })
  })

  describe('#cancelGroup', () => {
    it('should cancel the group for the account', async () => {
      await expect(verifier.connect(caller).cancelGroup(1))
        .to.emit(verifier, 'GroupCancelled')
        .withArgs(caller.address, 1)

      expect(await verifier.groups(caller.address, 1)).to.eq(true)
    })
  })
})
