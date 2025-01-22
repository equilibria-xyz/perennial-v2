#!/bin/bash

yarn test:integrationArbitrum --grep 'relays take messages' &&
yarn test --grep 'Controller_Incentivized' &&
yarn test --grep '#relayed'
