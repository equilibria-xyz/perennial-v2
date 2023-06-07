// import { FakeContract, smock } from '@defi-wonderland/smock'
// import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
// import { expect, use } from 'chai'
// import HRE from 'hardhat'
// import { constants, utils } from 'ethers'

// import {
//     IMultiInvoker,
//     MultiInvoker,
//     MultiInvoker__factory,
//     IMarket,
//     IBatcher,
//     IEmptySetReserve,
//     IERC20,

// } from '../../../types/generated'
// import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

// const ethers = { HRE }
// use(smock.matchers)

// describe('MultiInvoker', () => {
//     let owner: SignerWithAddress
//     let user: SignerWithAddress
//     let usdc: FakeContract<IERC20>
//     let dsu: FakeContract<IERC20>
//     let batcher: FakeContract<IBatcher>
//     let reserve: FakeContract<IEmptySetReserve>
//     let multiInvoker: MultiInvoker

//     const multiInvokerFixture = async () => {
//         ;[owner, user] = await ethers.getSigners()
//       }

//     beforeEach(async () => {
//         await loadFixture(multiInvokerFixture)

//         usdc = await smock.fake<IERC20>('IERC20')
//         dsu = await smock.fake<IERC20>('IERC20')
//         batcher = await smock.fake<IBatcher>('Batcher')
//         reserve = await smock.fake<IEmptySetReserve>('IEmptySetReserve')
//     })

// })
