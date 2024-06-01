import { smock } from '@defi-wonderland/smock'
import { use } from 'chai'

import { ArbGasInfo } from '../../../types/generated'

import { RunMultiInvokerTests } from './MultiInvoker.test'

use(smock.matchers)

RunMultiInvokerTests('MultiInvoker_Arbitrum', async () => {
  // Mock L1 gas pricing
  const gasInfo = await smock.fake<ArbGasInfo>('ArbGasInfo', {
    address: '0x000000000000000000000000000000000000006C',
  })
  gasInfo.getL1BaseFeeEstimate.returns(0)
})
