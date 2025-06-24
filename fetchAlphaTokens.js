// This script will fetch the top 100 alpha tokens from Binance using the API key and prepare for arbitrage logic.
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
// Configurable number of tokens to fetch
const NUM_TOKENS = 50; // Change this value to adjust how many tokens to track
const DEXSCREENER_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search';

async function getTokenInfoFromDexScreener(symbol) {
  try {
    // Search for the token on BSC (Binance Smart Chain)
    const response = await axios.get(`${DEXSCREENER_SEARCH_URL}?q=${symbol}/USDT`);
    // Filter for BSC pairs only
    const bscPairs = response.data.pairs.filter(pair => pair.chainId === 'bsc');
    if (bscPairs.length > 0) {
      // Return all BSC pairs for this symbol
      return bscPairs.map(pair => ({
        symbol: pair.baseToken.symbol,
        address: pair.baseToken.address,
        decimals: pair.baseToken.decimals || 18,
        quote: pair.quoteToken.symbol,
        quoteAddress: pair.quoteToken.address,
        pairAddress: pair.pairAddress,
        dexId: pair.dexId
      }));
    }
    return [];
  } catch (error) {
    console.error(`Error fetching info for ${symbol}:`, error.message);
    return [];
  }
}

// Optionally load alpha tokens from file
let alphaTokenSymbols = [];
try {
  alphaTokenSymbols = JSON.parse(fs.readFileSync('alpha-tokens.json'));
  console.log('Loaded alpha token symbols from alpha-tokens.json:', alphaTokenSymbols);
} catch (e) {
  alphaTokenSymbols = null;
}

async function fetchAlphaTokens() {
  try {
    let tokenList;
    if (alphaTokenSymbols && alphaTokenSymbols.length > 0) {
      tokenList = alphaTokenSymbols;
    } else {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
      // Filter for USDT, USDC, or BNB pairs
      const pairs = response.data.filter(ticker => {
        return (
          ticker.symbol.endsWith('USDT') ||
          ticker.symbol.endsWith('USDC') ||
          ticker.symbol.endsWith('BNB')
        );
      });
      // Sort by quoteVolume (descending) and take top N
      const topPairs = pairs
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, NUM_TOKENS);
      tokenList = topPairs.map(pair => pair.symbol);
    }
    console.log('Token list:', tokenList);
    // Fetch contract addresses and pairs for each token
    let tokenInfoList = [];
    for (const symbol of tokenList) {
      const infos = await getTokenInfoFromDexScreener(symbol);
      if (infos && infos.length > 0) tokenInfoList = tokenInfoList.concat(infos);
    }
    console.log('Token info with contract addresses and pairs:', tokenInfoList);
    fs.writeFileSync('tokens-info.json', JSON.stringify(tokenInfoList, null, 2));
    console.log('Token info saved to tokens-info.json');
    return tokenInfoList;
  } catch (error) {
    console.error('Error fetching alpha tokens:', error.message);
    return [];
  }
}

fetchAlphaTokens();
