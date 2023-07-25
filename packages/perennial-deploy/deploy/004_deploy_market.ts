import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MarketFactory__factory, OracleFactory__factory, ProxyAdmin__factory } from '../types/generated'

const MARKETS = [
  ['0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', ''], // ETH / None
  ['0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', ''], // BTC / None
  ['0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', 'MilliPowerTwo'], // ETH / MilliPowerTwo
]

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Implementations
  const marketImpl = await deploy('MarketImpl', {
    contract: 'Market',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  await deploy('MarketFactoryImpl', {
    contract: 'MarketFactory',
    args: [(await get('OracleFactory')).address, (await get('PayoffFactory')).address, marketImpl.address],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Factory
  const marketFactoryInterface = new ethers.utils.Interface(['function initialize()'])
  await deploy('MarketFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('MarketFactoryImpl')).address,
      proxyAdmin.address,
      marketFactoryInterface.encodeFunctionData('initialize', []),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const marketFactory = new MarketFactory__factory(deployerSigner).attach((await get('MarketFactory')).address)
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  // Create markets
  for (const marketDefinition of MARKETS) {
    const oracleAddress = await oracleFactory.oracles(marketDefinition[0])
    const payoffAddress =
      marketDefinition[1] === '' ? ethers.constants.AddressZero : (await get(marketDefinition[1])).address

    if (
      (await marketFactory.markets(oracleAddress, payoffAddress)).toLowerCase() ===
      ethers.constants.AddressZero.toLowerCase()
    ) {
      process.stdout.write(`Creating market with oracle ${marketDefinition[0]} and payoff ${marketDefinition[1]}...`)
      await marketFactory.create({
        token: (await get('DSU')).address,
        oracle: oracleAddress,
        payoff: payoffAddress,
      })

      // TODO: setup market and risk parameter

      process.stdout.write('complete\n')
    }
  }

  // Authorize markets
  await oracleFactory.authorize(marketFactory.address)

  // Transfer pending ownership
  if ((await marketFactory.owner()).toLowerCase() !== (await get('TimelockController')).address.toLowerCase()) {
    process.stdout.write('Setting owner to timelock...')
    await marketFactory.updatePendingOwner((await get('TimelockController')).address)
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Market']
