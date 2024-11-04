import { BigNumber, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { impersonate } from '../../../common/testutil'
import { IERC20Metadata__factory } from '../../types/generated'

export const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // chainlink eth oracle
export const PYTH_ADDRESS = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6'

export const DSU_ADDRESS = '0x605D26FBd5be761089281d5cec2Ce86eeA667109' // Digital Standard Unit, an 18-decimal token
export const DSU_BATCHER = '0xAEf566ca7E84d1E736f999765a804687f39D9094'
export const DSU_RESERVE = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // Arbitrum native USDC (not USDC.e), a 6-decimal token
export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199' // Maker PSM has 520mm USDC at height 17433155

export async function fundWalletDSU(
  wallet: SignerWithAddress,
  amount: BigNumber, // old impl defaulted to utils.parseEther('2000000')
): Promise<void> {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, usdcHolder)
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  await usdc.connect(usdcHolder).approve(DSU_RESERVE, amount)
  await usdcHolder.sendTransaction({
    to: DSU_RESERVE,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [amount]),
  })
  const dsu = IERC20Metadata__factory.connect(DSU_ADDRESS, usdcHolder)
  await dsu.transfer(wallet.address, amount)
}

export async function fundWalletUSDC(
  wallet: SignerWithAddress,
  amount: BigNumber, // old impl defaulted to BigNumber.from('1000000000')
): Promise<void> {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect(USDC_ADDRESS, usdcHolder)
  await usdc.connect(usdcHolder).transfer(wallet.address, amount)
}
