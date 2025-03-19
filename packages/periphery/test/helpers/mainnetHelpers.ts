import { BigNumber, utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { deployments } from 'hardhat'

import { impersonate } from '../../../common/testutil'
import { IERC20Metadata__factory } from '../../types/generated'

export const CHAINLINK_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' // chainlink eth oracle
export const PYTH_ADDRESS = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6'

export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199' // Maker PSM has 520mm USDC at height 17433155

export async function fundWalletDSU(wallet: SignerWithAddress, amount: BigNumber): Promise<void> {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, usdcHolder)
  const dsuIface = new utils.Interface(['function mint(uint256)'])
  const reserveAddress = (await deployments.get('DSUReserve')).address
  await usdc.connect(usdcHolder).approve(reserveAddress, amount)
  await usdcHolder.sendTransaction({
    to: reserveAddress,
    value: 0,
    data: dsuIface.encodeFunctionData('mint', [amount]),
  })
  const dsu = IERC20Metadata__factory.connect((await deployments.get('DSU')).address, usdcHolder)
  await dsu.transfer(wallet.address, amount)
}

export async function fundWalletUSDC(wallet: SignerWithAddress, amount: BigNumber): Promise<void> {
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  const usdc = IERC20Metadata__factory.connect((await deployments.get('USDC')).address, usdcHolder)
  await usdc.connect(usdcHolder).transfer(wallet.address, amount)
}
