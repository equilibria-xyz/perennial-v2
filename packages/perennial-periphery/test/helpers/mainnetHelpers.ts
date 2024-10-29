import { BigNumber, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { impersonate } from '../../../common/testutil'
import { IERC20Metadata } from '../../types/generated'

export const DSU_ADDRESS = '0x605D26FBd5be761089281d5cec2Ce86eeA667109' // Digital Standard Unit, an 18-decimal token
export const DSU_BATCHER = '0xAEf566ca7E84d1E736f999765a804687f39D9094'
export const DSU_RESERVE = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // Arbitrum native USDC (not USDC.e), a 6-decimal token
export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199' // Maker PSM has 520mm USDC at height 17433155

export async function fundWalletDSU(
  dsu: IERC20Metadata,
  usdc: IERC20Metadata,
  wallet: SignerWithAddress,
  amountOverride?: BigNumber,
): Promise<void> {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  await usdc.connect(usdcHolder).approve(DSU_RESERVE, amountOverride ? amountOverride : BigNumber.from('2000000000000'))
  await usdcHolder.sendTransaction({
    to: DSU_RESERVE,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [
      amountOverride ? amountOverride.mul(1e12) : utils.parseEther('2000000'),
    ]),
  })
  await dsu
    .connect(usdcHolder)
    .transfer(wallet.address, amountOverride ? amountOverride.mul(1e12) : utils.parseEther('2000000'))
}

export async function fundWalletUSDC(
  usdc: IERC20Metadata,
  wallet: SignerWithAddress,
  amountOverride?: BigNumber,
): Promise<void> {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  await usdc
    .connect(usdcHolder)
    .transfer(wallet.address, amountOverride ? amountOverride : BigNumber.from('1000000000'))
}
