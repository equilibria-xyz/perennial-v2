import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ProxyAdmin__factory } from '@equilibria/perennial-v2/types/generated'
import { OracleFactory__factory, PythFactory__factory } from '@equilibria/perennial-v2-oracle/types/generated'

const ORACLE_IDS = [
  '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace', // ETH
  '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43', // BTC
]

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  const proxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  // Deploy Oracle Implementations
  await deploy('OracleImpl', {
    contract: 'Oracle',
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  await deploy('OracleFactoryImpl', {
    contract: 'OracleFactory',
    args: [(await get('OracleImpl')).address],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Oracle Factory
  const oracleFactoryInterface = new ethers.utils.Interface(['function initialize(address)'])
  await deploy('OracleFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('OracleFactoryImpl')).address,
      proxyAdmin.address,
      oracleFactoryInterface.encodeFunctionData('initialize', [(await get('DSU')).address]),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const oracleFactory = new OracleFactory__factory(deployerSigner).attach((await get('OracleFactory')).address)

  // Deploy Pyth Implementations
  await deploy('PythOracleImpl', {
    contract: 'PythOracle',
    args: [(await get('Pyth')).address],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  await deploy('PythFactoryImpl', {
    contract: 'PythFactory',
    args: [
      (await get('PythOracleImpl')).address,
      (await get('ChainlinkETHUSDFeed')).address,
      (await get('DSU')).address,
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  // Deploy Pyth Factory
  const pythFactoryInterface = new ethers.utils.Interface(['function initialize(address)'])
  await deploy('PythFactory', {
    contract: 'TransparentUpgradeableProxy',
    args: [
      (await get('PythFactoryImpl')).address,
      proxyAdmin.address,
      pythFactoryInterface.encodeFunctionData('initialize', [(await get('OracleFactory')).address]),
    ],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const pythFactory = new PythFactory__factory(deployerSigner).attach((await get('PythFactory')).address)

  // Register Pyth Factory
  await oracleFactory.register(pythFactory.address)

  // Authorize Oracle Factory
  await pythFactory.authorize(oracleFactory.address)

  // Create Instances
  for (const id of ORACLE_IDS) {
    if ((await pythFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating pyth oracle ${id}...`)
      await pythFactory.create(id)
      process.stdout.write('complete\n')
    }
    if ((await oracleFactory.oracles(id)).toLowerCase() === ethers.constants.AddressZero.toLowerCase()) {
      process.stdout.write(`Creating oracle ${id}...`)
      oracleFactory.create(id, pythFactory.address)
      process.stdout.write('complete\n')
    }
  }

  // Transfer pending ownership
  if ((await oracleFactory.owner()).toLowerCase() !== (await get('TimelockController')).address.toLowerCase()) {
    process.stdout.write('Setting owner to timelock...')
    await oracleFactory.updatePendingOwner((await get('TimelockController')).address)
    process.stdout.write('complete\n')
  }
  if ((await pythFactory.owner()).toLowerCase() !== (await get('TimelockController')).address.toLowerCase()) {
    process.stdout.write('Setting owner to timelock...')
    await pythFactory.updatePendingOwner((await get('TimelockController')).address)
    process.stdout.write('complete\n')
  }
}

export default func
func.tags = ['Payoff']
