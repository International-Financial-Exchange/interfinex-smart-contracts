# Interfinex Smart Contracts

Documentation can be found here: https://interfinex.gitbook.io/interfinex/
Live demo of the contracts here: https://interfinex.io/app/swap

## Getting Started

```
git clone https://github.com/International-Financial-Exchange/interfinex-smart-contracts
cd interfinex-smart-contracts
npm install
```

To compile:

```
sudo npx hardhat compile
```

To test:

```
sudo npx hardhat test
```

Expected: 2 failing tests due to `testAccrueInterest` not being a function. These tests pass if `testAccrueInterest` is manually uncommented in `MarginMarket.vy`.