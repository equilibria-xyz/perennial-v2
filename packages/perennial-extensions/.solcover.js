module.exports = {
    skipFiles: [
        'contracts/interfaces/IKeeperManager.sol',
        'contracts/MultiInvokerRollup.sol'
    ],
    configureYulOptimizer: true,
    solcOptimizerDetails: {
        peephole: false,
        inliner: false,
        jumpdestRemover: false,
        orderLiterals: true,  // <-- TRUE! Stack too deep when false
        deduplicate: false,
        cse: false,
        constantOptimizer: false,
        yul: true
    }
  }