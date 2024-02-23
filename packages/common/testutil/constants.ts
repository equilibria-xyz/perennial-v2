import { isArbitrum, isBase, isEthereum, isMainnet, isTestnet } from './network'

export function getMultisigAddress(networkName: string): string | null {
  if (isMainnet(networkName)) {
    if (isEthereum(networkName)) return '0xe3010e0a0f1a8e8Ac58BF2Cd83B7FaCAee4821Af'
    if (isArbitrum(networkName)) return '0x8074583B0F9CFA345405320119D4B6937C152304'
    if (isBase(networkName)) return '0x206e580a26003C93cdC3CAf65C2D7FbF09AD1930'
  } else if (isTestnet(networkName)) {
    if (isEthereum(networkName)) return '0xf6C02E15187c9b466E81B3aC72cCf32569EB19eD'
  }
  return null
}

export function getLabsMultisig(networkName: string): string | null {
  if (isMainnet(networkName)) {
    if (isArbitrum(networkName)) return '0xcc2A6ef429b402f7d8D72D6AEcd6Dfd0D787AcfF'
    if (isBase(networkName)) return '0x63716C3656C7C3937981ccE3D4F0451b40302429'
  }
  return null
}
