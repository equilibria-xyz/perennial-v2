#!/bin/bash

yarn test --grep 'Manager' &&
yarn test:integrationArbitrum --grep 'Manager_Arbitrum' &&
yarn test:integrationBase --grep 'Manager_Optimism'
