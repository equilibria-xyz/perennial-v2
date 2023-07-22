// let pauser
// ;[owner, pauser, user, user2, btcUser1, btcUser2, liquidator, perennialUser] = await ethers.getSigners()
// factory = instanceVars.marketFactory
// oracleFactory = instanceVars.oracleFactory

// vaultOracleFactory = await smock.fake<IOracleFactory>('IOracleFactory')
// await oracleFactory.connect(owner).register(vaultOracleFactory.address)
// await oracleFactory.connect(owner).authorize(factory.address)

// oracle = await smock.fake<IOracleProvider>('IOracleProvider')
// const realVersion = {
//   timestamp: STARTING_TIMESTAMP,
//   price: BigNumber.from('2620237388'),
//   valid: true,
// }
// originalOraclePrice = realVersion.price

// oracle.status.returns([realVersion, realVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
// oracle.request.returns()
// oracle.latest.returns(realVersion)
// oracle.current.returns(realVersion.timestamp.add(LEGACY_ORACLE_DELAY))
// oracle.at.whenCalledWith(realVersion.timestamp).returns(realVersion)

// btcOracle = await smock.fake<IOracleProvider>('IOracleProvider')
// const btcRealVersion = {
//   timestamp: STARTING_TIMESTAMP,
//   price: BigNumber.from('38838362695'),
//   valid: true,
// }
// btcOriginalOraclePrice = btcRealVersion.price

// btcOracle.status.returns([btcRealVersion, btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY)])
// btcOracle.request.returns()
// btcOracle.latest.returns(btcRealVersion)
// btcOracle.current.returns(btcRealVersion.timestamp.add(LEGACY_ORACLE_DELAY))
// btcOracle.at.whenCalledWith(btcRealVersion.timestamp).returns(btcRealVersion)

// vaultOracleFactory.instances.whenCalledWith(oracle.address).returns(true)
// vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(oracle.address)
// vaultOracleFactory.instances.whenCalledWith(btcOracle.address).returns(true)
// vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcOracle.address)

// const vaultFactoryProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
//   instanceVars.marketFactory.address, // dummy contract
//   instanceVars.proxyAdmin.address,
//   [],
// )

// vaultOracleFactory.instances.whenCalledWith(oracle.address).returns(true)
// vaultOracleFactory.oracles.whenCalledWith(ETH_PRICE_FEE_ID).returns(oracle.address)
// vaultOracleFactory.instances.whenCalledWith(btcOracle.address).returns(true)
// vaultOracleFactory.oracles.whenCalledWith(BTC_PRICE_FEE_ID).returns(btcOracle.address)

// const rootOracle = IOracle__factory.connect(
//   await instanceVars.oracleFactory.connect(owner).callStatic.create(ETH_PRICE_FEE_ID, vaultOracleFactory.address),
//   owner,
// )
// await instanceVars.oracleFactory.connect(owner).create(ETH_PRICE_FEE_ID, vaultOracleFactory.address)

// leverage = parse6decimal('4.0')
// maxCollateral = parse6decimal('500000')

// const btcRootOracle = IOracle__factory.connect(
//   await instanceVars.oracleFactory.connect(owner).callStatic.create(BTC_PRICE_FEE_ID, vaultOracleFactory.address),
//   owner,
// )
// await instanceVars.oracleFactory.connect(owner).create(BTC_PRICE_FEE_ID, vaultOracleFactory.address)

// market = await deployProductOnMainnetFork({
//   factory: instanceVars.marketFactory,
//   token: instanceVars.dsu,
//   owner: owner,
//   name: 'Ethereum',
//   symbol: 'ETH',
//   oracle: rootOracle.address,
//   payoff: constants.AddressZero,
//   makerLimit: parse6decimal('1000'),
//   minMaintenance: parse6decimal('50'),
//   maxLiquidationFee: parse6decimal('25000'),
// })
// btcMarket = await deployProductOnMainnetFork({
//   factory: instanceVars.marketFactory,
//   token: instanceVars.dsu,
//   owner: owner,
//   name: 'Bitcoin',
//   symbol: 'BTC',
//   oracle: btcRootOracle.address,
//   payoff: constants.AddressZero,
//   minMaintenance: parse6decimal('50'),
//   maxLiquidationFee: parse6decimal('25000'),
// })

// const vaultImpl = await new Vault__factory(owner).deploy()
// const vaultFactoryImpl = await new VaultFactory__factory(owner).deploy(
//   instanceVars.marketFactory.address,
//   vaultImpl.address,
// )
// await instanceVars.proxyAdmin.upgrade(vaultFactoryProxy.address, vaultFactoryImpl.address)
// vaultFactory = IVaultFactory__factory.connect(vaultFactoryProxy.address, owner)
// await vaultFactory.initialize()

// vault = IVault__factory.connect(
//   await vaultFactory.callStatic.create(instanceVars.dsu.address, market.address, 'Blue Chip', 'BC'),
//   owner,
// )
// await vaultFactory.create(instanceVars.dsu.address, market.address, 'Blue Chip', 'BC')

// await vault.register(btcMarket.address)
// await vault.updateMarket(0, 4, leverage)
// await vault.updateMarket(1, 1, leverage)
// await vault.updateParameter({
//   cap: maxCollateral,
// })

// asset = IERC20Metadata__factory.connect(await vault.asset(), owner)
// await Promise.all([
//   asset.connect(liquidator).approve(vault.address, ethers.constants.MaxUint256),
//   asset.connect(perennialUser).approve(vault.address, ethers.constants.MaxUint256),
//   fundWallet(asset, liquidator),
//   fundWallet(asset, perennialUser),
//   fundWallet(asset, perennialUser),
//   fundWallet(asset, perennialUser),
//   fundWallet(asset, perennialUser),
//   fundWallet(asset, perennialUser),
//   fundWallet(asset, perennialUser),
//   fundWallet(asset, perennialUser),
//   asset.connect(user).approve(vault.address, ethers.constants.MaxUint256),
//   asset.connect(user2).approve(vault.address, ethers.constants.MaxUint256),
//   asset.connect(btcUser1).approve(vault.address, ethers.constants.MaxUint256),
//   asset.connect(btcUser2).approve(vault.address, ethers.constants.MaxUint256),
//   asset.connect(user).approve(market.address, ethers.constants.MaxUint256),
//   asset.connect(user2).approve(market.address, ethers.constants.MaxUint256),
//   asset.connect(btcUser1).approve(btcMarket.address, ethers.constants.MaxUint256),
//   asset.connect(btcUser2).approve(btcMarket.address, ethers.constants.MaxUint256),
// ])

// // Seed markets with some activity
// await market.connect(user).update(user.address, parse6decimal('200'), 0, 0, parse6decimal('100000'), false)
// await market.connect(user2).update(user2.address, 0, parse6decimal('100'), 0, parse6decimal('100000'), false)
// await btcMarket
//   .connect(btcUser1)
//   .update(btcUser1.address, parse6decimal('20'), 0, 0, parse6decimal('100000'), false)
// await btcMarket
//   .connect(btcUser2)
//   .update(btcUser2.address, 0, parse6decimal('10'), 0, parse6decimal('100000'), false)

// vaultSigner = await impersonate.impersonateWithBalance(vault.address, ethers.utils.parseEther('10'))

// return { instanceVars, vaultFactoryProxy, rootOracle }

// it('approves a vault to spend invokers DSU', async () => {

// })
