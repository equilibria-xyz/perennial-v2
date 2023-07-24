import defaultConfig from '../common/hardhat.default.config'

const config = defaultConfig({
  dependencyPaths: [
    '@equilibria/perennial-v2-payoff/contracts/PayoffFactory.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/Giga.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/Kilo.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/KiloPowerHalf.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/KiloPowerTwo.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/Mega.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/MegaPowerTwo.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/Micro.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/MicroPowerTwo.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/Milli.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/MilliPowerHalf.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/MilliPowerTwo.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/Nano.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/PowerHalf.sol',
    '@equilibria/perennial-v2-payoff/contracts/payoff/PowerTwo.sol',
  ],
})

export default config
