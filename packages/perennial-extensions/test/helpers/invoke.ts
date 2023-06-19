import { BigNumber, BigNumberish, utils } from 'ethers'
import { IMultiInvoker, MultiInvoker } from '../../types/generated'

export type OrderStruct = {
  isLong?: boolean
  isLimit?: boolean
  maxFee: BigNumberish
  execPrice?: BigNumberish
  size?: BigNumberish
}

// export type RawAction =
//     | 'UPDATE_POSITION'
//     | 'PLACE_ORDER'
//     | 'UPDATE_ORDER'
//     | 'CANCEL_ORDER'
//     | 'CLOSE_ORDER';
// export type MultiAction =
//     | 'UPDATE_POSITION'
//     | 'PLACE_ORDER'
//     | 'UPDATE_ORDER'
//     | 'CANCEL_ORDER'
//     | 'CLOSE_ORDER';

export type Actions = IMultiInvoker.InvocationStruct[]

export const buildUpdateMarket = ({
  market,
  long,
  short,
  collateral,
  handleWrap,
}: {
  market: string
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
}): Actions => {
  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        ['address', 'int256', 'int256', 'int256', 'int256', 'bool'],
        [
          market,
          '0',
          long ? long : '0',
          short ? short : '0',
          collateral ? collateral : '0',
          handleWrap ? handleWrap : false,
        ],
      ),
    },
  ]
}

// @todo check if setting position conflicts with isLimit
export const buildPlaceOrder = ({
  market,
  long,
  short,
  collateral,
  handleWrap,
  order,
}: {
  market: string
  long?: BigNumberish
  short?: BigNumberish
  collateral?: BigNumberish
  handleWrap?: boolean
  order: OrderStruct
}): Actions => {
  if (long && short) {
    if (BigNumber.from(long).gt(short)) {
      order.isLong = true
      order.size = BigNumber.from(long).sub(short)
    } else {
      order.isLong = false
      order.size = BigNumber.from(short).sub(long)
    }
  } else if (long) {
    order.isLong = true
    order.size = long
  } else if (short) {
    order.isLong = false
    order.size = short
  } else {
    long = order.isLong ? order.size : '0'
    short = !order.isLong ? order.size : '0'
  }

  return [
    {
      action: 1,
      args: utils.defaultAbiCoder.encode(
        ['address', 'int256', 'int256', 'int256', 'int256', 'bool'],
        [
          market,
          '0',
          long ? long : '0',
          short ? short : '0',
          collateral ? collateral : '0',
          handleWrap ? handleWrap : false,
        ],
      ),
    },
    {
      action: 2,
      args: utils.defaultAbiCoder.encode(
        ['address', 'tuple(bool,bool,int256,int256,uint256)'],
        [
          market,
          [
            order.isLimit ? order.isLimit : false,
            order.isLong ? order.isLong : false,
            order.maxFee,
            order.execPrice ? order.execPrice : '0',
            order.size ? order.size : '0',
          ],
        ],
      ),
    },
  ]
}

export const buildCancelOrder = ({ market, orderId }: { market: string; orderId: BigNumberish }): Actions => {
  return [
    {
      action: 3,
      args: utils.defaultAbiCoder.encode(['address', 'uint256'], [market, orderId]),
    },
  ]
}

// @todo remove in favor of cancel + place action
export const buildUpdateOrder = ({
  market,
  newExec,
  newMaxFee,
  newSize,
}: {
  market: string
  newExec: BigNumberish
  newMaxFee: BigNumberish
  newSize: BigNumberish
}): Actions => {
  return [
    {
      action: 3,
      args: utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'uint256', 'uint256'],
        [market, newExec, newMaxFee, newSize],
      ),
    },
  ]
}

export const buildExecOrder = ({
  user,
  market,
  orderId,
}: {
  user: string
  market: string
  orderId: BigNumberish
}): Actions => {
  return [
    {
      action: 4,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint256'], [user, market, orderId]),
    },
  ]
}

// @todo froentend helper to net orders into a single market update
export const buildNetOrder = {}

// export const buildMultiAction = ({
//     action,
//     user,
//     market,
//     maker,
//     long,
//     short,
//     collateral,
//     handleWrap,
//     orderId,
//     isLong,
//     isLimit,
//     maxFee,
//     execPrice,
//     size
// }: {
//     action: MultiAction
//     user?: string
//     market?: string
//     maker?: BigNumberish
//     long?: BigNumberish
//     short?: BigNumberish
//     collateral?: BigNumberish
//     handleWrap?: boolean
//     orderId?: BigNumberish
//     isLong?: boolean
//     isLimit?: boolean
//     maxFee?: BigNumberish
//     execPrice?: BigNumberish
//     size?: BigNumberish
// }): Actions | undefined => {

//     switch (action) {
//         case 'UPDATE_POSITION':
//             return buildInvokerActions({
//                 user: '',
//                 market: market!,
//                 maker: maker!,
//                 long: long!,
//                 short: short!,
//                 collateral: collateral!,
//                 handleWrap: handleWrap!,
//                 orderId: '0',
//                 isLong: false,
//                 isLimit: false,
//                 maxFee: '0',
//                 execPrice: '0',
//                 size: '0'
//             }).UPDATE_POSITION
//         case 'PLACE_ORDER':
//             return buildInvokerActions({
//                 user: '',
//                 market: market!,
//                 maker: maker == undefined ? '0' : maker,
//                 long: long == undefined ? '0' : long,
//                 short: short == undefined ? '0' : short,
//                 collateral: collateral == undefined ? '0' : collateral,
//                 handleWrap: handleWrap!,
//                 orderId: '',
//                 isLong: isLong == undefined ? false : isLong,
//                 isLimit: isLimit!,
//                 maxFee: maxFee!,
//                 execPrice: execPrice!,
//                 size: size!
//             }).PLACE_ORDER
//         case 'UPDATE_ORDER':
//             return undefined
//         case 'CANCEL_ORDER':
//             return undefined
//         case 'CLOSE_ORDER':
//             return undefined
//     }
//     return undefined

// }

// export const buildInvokerActions = ({
//     user,
//     market,
//     maker,
//     long,
//     short,
//     collateral,
//     handleWrap,
//     orderId,
//     isLong,
//     isLimit,
//     maxFee,
//     execPrice,
//     size
// }: {
//     user: string
//     market: string
//     maker: BigNumberish
//     long: BigNumberish
//     short: BigNumberish
//     collateral: BigNumberish
//     handleWrap: boolean
//     orderId: BigNumberish
//     isLong: boolean
//     isLimit: boolean
//     maxFee: BigNumberish
//     execPrice: BigNumberish
//     size: BigNumberish
// }): { [action in MultiAction]: Actions } => {
//     return {
//         UPDATE_POSITION: [{
//                 action: 1,
//                 args: utils.defaultAbiCoder.encode(
//                     ['address', 'Fixed6', 'Fixed6', 'Fixed6', 'Fixed6', 'boolean'],
//                     [market, maker, long, short, collateral, handleWrap])
//         }],
//         PLACE_ORDER: [
//             {
//                 action: 1,
//                 args: utils.defaultAbiCoder.encode(
//                     ['address', 'Fixed6', 'Fixed6', 'Fixed6', 'Fixed6', 'boolean'],
//                     [market, maker, long, short, collateral, handleWrap])
//             },
//             {
//                 action: 2,
//                 args: utils.defaultAbiCoder.encode(
//                     ['address', 'tuple[bool,bool,uint256,uint256,uint256]'],
//                     [market, [isLimit,isLong,maxFee,execPrice,size]]
//                 )
//             }
//         ],
//         CLOSE_ORDER: [
//         ],
//         UPDATE_ORDER: [],
//         CANCEL_ORDER: []

//         // struct Order {
//         //     // slot 1
//         //     bool isLimit; // true/false = increase/decrease order size of market position upon execution
//         //     bool isLong;  // true/false = change long/short size of market position upon execution
//         //     Fixed6 maxFee; // @todo optimization: set as % with some precision

//         //     // slot 2&3
//         //     Fixed6 execPrice; // execute order when mkt price >= (-) execPrice or mkt price <= (+) execPrice
//         //     UFixed6 size;     // notional (?) magnitude of order on market position @todo add sign to replace isLong
//         // }

//     }
// }
