import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { PerennialMetadata, PerennialMetadata__factory } from '../../../types/generated'
import { expect } from 'chai'

const { ethers } = HRE

describe('PerennialMetadata', () => {
  let owner: SignerWithAddress

  let metadata: PerennialMetadata

  before(async () => {
    ;[owner] = await ethers.getSigners()

    metadata = await new PerennialMetadata__factory(owner).deploy()
  })

  it('constructs', async () => {
    expect(await metadata.getText()).to.equal('')
    expect(await metadata.owner()).to.equal(owner.address)
  })

  it('writes and reads text', async () => {
    const text = JSON.stringify({ foo: 'bar' })
    await metadata.setText(text)
    const readText = await metadata.getText()

    expect(readText).to.equal(text)
  })
})
