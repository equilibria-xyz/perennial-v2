#!/bin/bash

yarn test --grep '#verifyFill' &&
yarn test --grep 'fills intent from a signed message' &&
yarn test:integration --grep 'fills a delegate-signed short intent with signature' &&
yarn test:integration --grep 'disables fills with mismatching markets'
