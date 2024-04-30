import { smock } from '@defi-wonderland/smock'
import { use } from 'chai'

import { OptGasInfo } from '../../../types/generated'

import { RunMultiInvokerTests } from './MultiInvoker.test'

use(smock.matchers)

RunMultiInvokerTests('MultiInvoker_Optimism', async () => {
  // Mock L1 gas pricing
  const gasInfo = await smock.fake<OptGasInfo>('OptGasInfo', {
    address: '0x420000000000000000000000000000000000000F',
  })
  gasInfo.getL1GasUsed.returns(0)
  gasInfo.getL1GasUsed.returns(0)
  gasInfo.l1BaseFee.returns(0)
  gasInfo.baseFeeScalar.returns(684000)
  gasInfo.decimals.returns(6)
})
