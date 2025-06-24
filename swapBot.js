// swapBot.js
// This script will load tokens-info.json and check price differences between PancakeSwap and 1inch for all tokens every 10 seconds.
const { ethers } = require('ethers');
require('dotenv').config();
const fs = require('fs');
const axios = require('axios');

const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_BSC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const ROUTERS = {
  pancakeswap: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  uniswap: "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506",
  "1inch": "0x1111111254EEB25477B68fb85Ed929f73A960582"
};

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const TOKENS = JSON.parse(fs.readFileSync('alpha-tokens.json'));

// Only use USDT as the base token
const BASE_TOKEN = {
  symbol: 'USDT',
  address: '0x55d398326f99059fF775485246999027B3197955',
  decimals: 18
};

// Only use tokens from alpha-tokens.json (BR and AVAIL with USDT quote)
const ARB_TOKENS = TOKENS.filter(t => t.quote === 'USDT');
const DEXES = [...new Set(ARB_TOKENS.map(t => t.dexId))];

const MAX_GAS_PRICE_GWEI = 5; // Maximum gas price in Gwei
const SLIPPAGE = 0.001; // 0.1% slippage
const DEADLINE_SECONDS = 10; // Transaction deadline

// Logging utility
function logHistory(message) {
  const logMsg = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync('arbitrage-history.log', logMsg);
  console.log(message);
}

// Helper: Get price from DexScreener for a given pair and DEX
async function getDexPrice(symbol, quote, dexId) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${symbol}/${quote}`;
    const res = await axios.get(url);
    const pair = res.data.pairs.find(p => p.dexId === dexId && p.chainId === 'bsc');
    if (pair) return parseFloat(pair.priceUsd);
    return null;
  } catch (e) {
    return null;
  }
}

// Helper: Get wallet token balance
async function getTokenBalance(token) {
  const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
  const balance = await contract.balanceOf(wallet.address);
  return Number(ethers.formatUnits(balance, token.decimals));
}

// Helper: Approve token spending if needed
async function approveIfNeeded(token, routerName, amount) {
  const contract = new ethers.Contract(token.address, ERC20_ABI, wallet);
  const allowance = await contract.allowance(wallet.address, ROUTERS[routerName]);
  if (allowance < amount) {
    const tx = await contract.approve(ROUTERS[routerName], ethers.MaxUint256);
    await tx.wait();
    console.log(`Approved ${token.symbol} for ${routerName}`);
  }
}

// Helper: Get current gas price and enforce max
async function getSafeGasPrice() {
  let gasPrice = await provider.getGasPrice();
  const maxGas = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
  if (gasPrice > maxGas) gasPrice = maxGas;
  return gasPrice;
}

// Helper: Anti-MEV - send with max gas, short deadline, and randomize nonce
function getTxOptions() {
  return {
    gasLimit: 400000, // Reasonable upper bound for swap
    // gasPrice will be set per tx
    nonce: undefined // Let ethers pick, or randomize for advanced anti-MEV
  };
}

async function executeSwap(token, routerName, amountIn, minAmountOut) {
  const router = new ethers.Contract(ROUTERS[routerName], ROUTER_ABI, wallet);
  const path = [token.address, token.quoteAddress];
  const to = wallet.address;
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;
  const gasPrice = await getSafeGasPrice();
  const txOpts = getTxOptions();
  txOpts.gasPrice = gasPrice;
  const tx = await router.swapExactTokensForTokens(
    amountIn,
    minAmountOut,
    path,
    to,
    deadline,
    txOpts
  );
  console.log(`Swap tx sent: ${tx.hash}`);
  await tx.wait();
  console.log('Swap confirmed.');
}

// Helper: Get all token balances from wallet and filter for nonzero
async function getWalletTokens() {
  // List of tokens to check (could be from a static list or a service like BSCscan)
  const tokens = TOKENS;
  const balances = [];
  for (const token of tokens) {
    const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
    const balance = await contract.balanceOf(wallet.address);
    const formatted = Number(ethers.formatUnits(balance, token.decimals));
    if (formatted > 0) {
      balances.push({ ...token, balance: formatted });
    }
  }
  return balances;
}

// Helper: Get BNB balance
async function getBNBBalance() {
  const balance = await provider.getBalance(wallet.address);
  return Number(ethers.formatUnits(balance, 18));
}

// Helper: Get ERC20 balance
async function getERC20Balance(token) {
  const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
  const balance = await contract.balanceOf(wallet.address);
  return Number(ethers.formatUnits(balance, token.decimals));
}

// Estimate gas cost in USDT
async function estimateGasCostInUSDT() {
  try {
    const gasPrice = await getSafeGasPrice();
    // Estimate 200,000 gas per swap (conservative)
    const gasCost = gasPrice * 200000n;
    // Get BNB price in USDT (using DexScreener)
    const res = await axios.get('https://api.dexscreener.com/latest/dex/search?q=BNB/USDT');
    const bnbPair = res.data.pairs.find(p => p.chainId === 'bsc');
    const bnbPrice = bnbPair ? parseFloat(bnbPair.priceUsd) : 600; // fallback
    const gasCostBNB = Number(ethers.formatUnits(gasCost, 18));
    return gasCostBNB * bnbPrice;
  } catch (e) {
    logHistory('Error estimating gas cost: ' + e.message);
    return 1; // fallback $1
  }
}

// Main: Check arbitrage routes for BR and AVAIL with USDT every 10 seconds
async function tryArbitrage() {
  try {
    // 1. Check wallet USDT balance
    const usdtBalance = await getERC20Balance(BASE_TOKEN);
    logHistory('--- WALLET BALANCE ---');
    logHistory(`${BASE_TOKEN.symbol}: ${usdtBalance}`);
    let foundArb = false;
    if (usdtBalance === 0) {
      logHistory('No USDT balance. No arbitrage possible.');
      return;
    }
    // 2. For each token (BR, AVAIL), check all DEX pairs
    for (const token of ARB_TOKENS) {
      if (token.symbol === 'USDT') continue;
      for (const buyDex of DEXES) {
        for (const sellDex of DEXES) {
          if (buyDex === sellDex) continue;
          // Only check if both DEXes have this token
          const buyToken = ARB_TOKENS.find(t => t.symbol === token.symbol && t.dexId === buyDex);
          const sellToken = ARB_TOKENS.find(t => t.symbol === token.symbol && t.dexId === sellDex);
          if (!buyToken || !sellToken) continue;
          // 1. Get price for USDT -> token on buyDex
          const buyRouter = new ethers.Contract(ROUTERS[buyDex], ROUTER_ABI, provider);
          let amountIn = ethers.parseUnits(usdtBalance.toString(), BASE_TOKEN.decimals);
          let path1 = [BASE_TOKEN.address, token.address];
          let buyOut;
          try {
            buyOut = await buyRouter.getAmountsOut(amountIn, path1);
          } catch (e) {
            logHistory(`Error getting buyOut for ${token.symbol} on ${buyDex}: ${e.message}`);
            continue;
          }
          // 2. Get price for token -> USDT on sellDex
          const sellRouter = new ethers.Contract(ROUTERS[sellDex], ROUTER_ABI, provider);
          let path2 = [token.address, BASE_TOKEN.address];
          let sellOut;
          try {
            sellOut = await sellRouter.getAmountsOut(buyOut[1], path2);
          } catch (e) {
            logHistory(`Error getting sellOut for ${token.symbol} on ${sellDex}: ${e.message}`);
            continue;
          }
          // 3. Calculate profit
          const profit = Number(ethers.formatUnits(sellOut[1], BASE_TOKEN.decimals)) - Number(ethers.formatUnits(amountIn, BASE_TOKEN.decimals));
          const gasCost = await estimateGasCostInUSDT();
          const netProfit = profit - gasCost;
          logHistory(`Arb check: USDT->${token.symbol}->USDT | Buy on ${buyDex}, Sell on ${sellDex} | Gross: ${profit.toFixed(4)} | Gas: ${gasCost.toFixed(4)} | Net: ${netProfit.toFixed(4)}`);
          if (netProfit > 0.1) { // Only execute if net profit > $0.1
            foundArb = true;
            logHistory(`PROFITABLE ARB: USDT->${token.symbol}->USDT | Buy on ${buyDex}, Sell on ${sellDex} | Net Profit: ${netProfit.toFixed(4)}`);
            // Approve if needed
            await approveIfNeeded(BASE_TOKEN, buyDex, amountIn);
            await approveIfNeeded(token, sellDex, buyOut[1]);
            // 1. Buy token on buyDex
            try {
              const minBuyOut = buyOut[1] - BigInt(buyOut[1] * BigInt(Math.floor(SLIPPAGE * 1000)) / 1000n); // slippage
              const buyRouter = new ethers.Contract(ROUTERS[buyDex], ROUTER_ABI, wallet);
              const buyTx = await buyRouter.swapExactTokensForTokens(
                amountIn,
                minBuyOut,
                [BASE_TOKEN.address, token.address],
                wallet.address,
                Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
                { gasLimit: 400000, gasPrice: await getSafeGasPrice() }
              );
              logHistory(`Buy swap sent: ${buyTx.hash}`);
              await buyTx.wait();
              logHistory('Buy swap confirmed.');
            } catch (e) {
              logHistory(`Buy swap failed: ${e.message}`);
              continue;
            }
            // 2. Sell token on sellDex
            try {
              // Get actual token balance after buy
              const tokenBalance = await getTokenBalance(token);
              const minSellOut = sellOut[1] - BigInt(sellOut[1] * BigInt(Math.floor(SLIPPAGE * 1000)) / 1000n); // slippage
              const sellRouter = new ethers.Contract(ROUTERS[sellDex], ROUTER_ABI, wallet);
              const sellTx = await sellRouter.swapExactTokensForTokens(
                ethers.parseUnits(tokenBalance.toString(), token.decimals),
                minSellOut,
                [token.address, BASE_TOKEN.address],
                wallet.address,
                Math.floor(Date.now() / 1000) + DEADLINE_SECONDS,
                { gasLimit: 400000, gasPrice: await getSafeGasPrice() }
              );
              logHistory(`Sell swap sent: ${sellTx.hash}`);
              await sellTx.wait();
              logHistory('Sell swap confirmed.');
            } catch (e) {
              logHistory(`Sell swap failed: ${e.message}`);
              continue;
            }
          }
        }
      }
    }
    if (!foundArb) {
      logHistory('No arbitrage opportunities found at this time.');
    }
    // Log wallet balances after attempt
    const afterBalance = await getERC20Balance(BASE_TOKEN);
    logHistory(`AFTER: ${BASE_TOKEN.symbol} balance: ${afterBalance}`);
  } catch (err) {
    logHistory('Fatal error in tryArbitrage: ' + err.message);
  }
}

setInterval(tryArbitrage, 10000);
logHistory('Arbitrage bot (ethers.js) started. Checking BR and AVAIL arbitrage with USDT every 10 seconds...');
