# Arbitrage Trading Bot for BSC DEXs

This bot fetches the top 100 alpha tokens from Binance, checks for arbitrage opportunities between PancakeSwap, 1inch, and other top BSC DEXs, and can execute swaps on-chain.

## Setup
1. Add your Binance API key, Alchemy BSC endpoint, and private key to the `.env` file.
2. Run `npm install` to install dependencies.
3. Use `node fetchAlphaTokens.js` to fetch tokens (arbitrage logic coming next).

## Security
**Never share your private key.**

## Next Steps
- Integrate arbitrage logic and DEX swap execution.
- Automate token list updates and volume checks.
