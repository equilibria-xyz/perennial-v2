#!/bin/bash

yarn test --grep '#verifyTake' &&
yarn test --grep 'opens long position with signature' &&
yarn test --grep 'reverts if signer is unauthorized' &&
yarn test:integration --grep 'opens, reduces, and closes a long position w\/ signed message'
