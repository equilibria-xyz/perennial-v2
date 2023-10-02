import HRE from 'hardhat'
import { expect } from 'chai'
import {
  MarketFactory,
  MarketFactory__factory,
  OracleFactory,
  OracleFactory__factory,
  ProxyAdmin__factory,
  VaultFactory,
  VaultFactory__factory,
  Vault__factory,
} from '../../../../types/generated'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { utils, constants } from 'ethers'
import { getLabsMultisig } from '../../../../../common/testutil/constants'

describe('Verify Vault', () => {
  let signer: SignerWithAddress
  let marketFactory: MarketFactory
  let vaultFactory: VaultFactory
  let oracleFactory: OracleFactory

  beforeEach(async () => {
    ;[signer] = await HRE.ethers.getSigners()
    marketFactory = MarketFactory__factory.connect((await HRE.deployments.get('MarketFactory')).address, signer)
    vaultFactory = VaultFactory__factory.connect((await HRE.deployments.get('VaultFactory')).address, signer)
    oracleFactory = OracleFactory__factory.connect((await HRE.deployments.get('OracleFactory')).address, signer)
  })

  it('VaultFactory', async () => {
    const proxyAdmin = ProxyAdmin__factory.connect((await HRE.deployments.get('ProxyAdmin')).address, signer)
    await expect(vaultFactory.callStatic.initialize()).to.be.reverted
    expect(await vaultFactory.callStatic.owner()).to.equal((await HRE.deployments.get('TimelockController')).address)
    expect(await vaultFactory.callStatic.pauser()).to.equal(getLabsMultisig('arbitrum'))
    expect(await vaultFactory.callStatic.implementation()).to.equal((await HRE.deployments.get('VaultImpl')).address)
    expect(await proxyAdmin.callStatic.getProxyAdmin(vaultFactory.address)).to.equal(proxyAdmin.address)
    expect(await proxyAdmin.callStatic.getProxyImplementation(vaultFactory.address)).to.equal(
      (await HRE.deployments.get('VaultFactoryImpl')).address,
    )
  })

  it('Aster Vault', async () => {
    const address = (await vaultFactory.queryFilter(vaultFactory.filters.InstanceRegistered()))[0]?.args.instance

    expect(!!address).to.be.true

    const asterVault = Vault__factory.connect(address, signer)
    expect((await asterVault.callStatic.parameter()).cap).to.equal(utils.parseUnits('5000000', 6))

    const ethRegistration = await asterVault.registrations(0)
    expect(ethRegistration.market).to.equal(
      await marketFactory.markets(
        await oracleFactory.oracles('0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'),
        constants.AddressZero,
      ),
    )
    expect(ethRegistration.weight).to.equal(1)
    expect(ethRegistration.leverage).to.equal(utils.parseUnits('1', 6))

    const btcRegistration = await asterVault.registrations(1)
    expect(btcRegistration.market).to.equal(
      await marketFactory.markets(
        await oracleFactory.oracles('0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'),
        constants.AddressZero,
      ),
    )
    expect(btcRegistration.weight).to.equal(1)
    expect(btcRegistration.leverage).to.equal(utils.parseUnits('1', 6))
  })

  it('Begonia Vault', async () => {
    const address = (await vaultFactory.queryFilter(vaultFactory.filters.InstanceRegistered()))[1]?.args.instance

    expect(!!address).to.be.true

    const begoniaVault = Vault__factory.connect(address, signer)
    expect((await begoniaVault.callStatic.parameter()).cap).to.equal(utils.parseUnits('2000000', 6))

    const solRegistration = await begoniaVault.registrations(0)
    expect(solRegistration.market).to.equal(
      await marketFactory.markets(
        await oracleFactory.oracles('0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'),
        constants.AddressZero,
      ),
    )
    expect(solRegistration.weight).to.equal(1)
    expect(solRegistration.leverage).to.equal(utils.parseUnits('1', 6))

    const maticRegistration = await begoniaVault.registrations(1)
    expect(maticRegistration.market).to.equal(
      await marketFactory.markets(
        await oracleFactory.oracles('0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52'),
        constants.AddressZero,
      ),
    )
    expect(maticRegistration.weight).to.equal(1)
    expect(maticRegistration.leverage).to.equal(utils.parseUnits('1', 6))
  })
})
