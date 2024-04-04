import { expect } from 'chai'
import HRE from 'hardhat'
import { createMarket, deployProtocolForOracle, InstanceVarsBasic } from '../helpers/setupHelpers'
import { parse6decimal } from '../../../../common/testutil/types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { Market } from '@equilibria/perennial-v2-oracle/types/generated'

// arbitrum addresses
const ORACLE_FACTORY = '0x8CDa59615C993f925915D3eb4394BAdB3feEF413'
const ETH_USDC_ORACLE_PROVIDER = '0x048BeB57D408b9270847Af13F6827FB5ea4F617A'
const DSU_MINTER = '0x0d49c416103Cbd276d9c3cd96710dB264e3A0c27'

describe('End to End Flow', () => {
  let instanceVars: InstanceVarsBasic
  let market: Market

  const realOracleFixture = async () => {
    const oracleFactory = await HRE.ethers.getContractAt('IOracleProviderFactory', ORACLE_FACTORY)
    const oracleProvider = await HRE.ethers.getContractAt('IOracleProvider', ETH_USDC_ORACLE_PROVIDER)

    expect(oracleProvider.address).to.not.be.undefined
    instanceVars = await deployProtocolForOracle(oracleFactory, oracleProvider, DSU_MINTER)
  }

  beforeEach(async () => {
    await loadFixture(realOracleFixture)
    const { user, oracle, dsu } = instanceVars

    market = await createMarket(instanceVars, oracle)
    await dsu.connect(user).approve(market.address, parse6decimal('1000').mul(1e12))
  })

  it('creates a market using real oracle', async () => {
    expect(market.address).to.not.be.undefined
    console.log('created market', market.address)
  })
})
