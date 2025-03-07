// src/actions.ts
import {
  generateText,
  ModelClass,
  composeContext
} from "@elizaos/core";

// src/okx/core/client.ts
import { DexAPI, BridgeAPI } from "@okx-dex/okx-dex-sdk";
import { HTTPClient } from "@okx-dex/okx-dex-sdk/dist/core/http-client";
import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
var OKXDexClient = class {
  dex;
  bridge;
  constructor(config) {
    const defaultConfig = {
      baseUrl: "https://www.okx.com",
      maxRetries: 3,
      timeout: 3e4,
      ...config
    };
    const configWithWallet = {
      ...defaultConfig,
      solana: defaultConfig.solana ? {
        ...defaultConfig.solana,
        walletAddress: Keypair.fromSecretKey(
          base58.decode(defaultConfig.solana.privateKey)
        ).publicKey.toString()
      } : void 0
    };
    const httpClient = new HTTPClient(configWithWallet);
    this.dex = new DexAPI(httpClient, configWithWallet);
    this.bridge = new BridgeAPI(httpClient);
  }
};

// src/actions.ts
function formatSolanaAddress(address) {
  address = address.trim();
  if (address.toLowerCase() === "11111111111111111111111111111111") {
    return "11111111111111111111111111111111";
  }
  if (address.toLowerCase() === "sol") {
    return "11111111111111111111111111111111";
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw new Error(`Invalid Solana address format: ${address}`);
  }
  return address;
}
async function extractSwapParams(message, client) {
  var _a;
  let messageContent = "";
  if (typeof message.content === "string") {
    messageContent = message.content;
  } else if (message.content && typeof message.content === "object") {
    messageContent = message.content.text || JSON.stringify(message.content);
  }
  console.log("Processing message content:", messageContent);
  messageContent = messageContent.trim();
  const patterns = [
    // Match "300 <address> to <address>"
    /(?:quote|swap)?\s*(?:for)?\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*([\w.-]+)\s*(?:to|for|->|=>)\s*([\w.-]+)/i,
    // Match "from <address> to <address> amount 300"
    /from\s*([\w.-]+)\s*(?:to|for|->|=>)\s*([\w.-]+)\s*(?:amount|quantity)?\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i,
    // Legacy format
    /from_token:\s*([\w.-]+)\s*to_token:\s*([\w.-]+)\s*amount:\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i
  ];
  let fromToken = "";
  let toToken = "";
  let amount = "";
  for (const pattern of patterns) {
    const match = messageContent.match(pattern);
    if (match) {
      if (pattern.source.startsWith("from")) {
        [, fromToken, toToken, amount] = match;
      } else {
        [, amount, fromToken, toToken] = match;
      }
      console.log("Pattern matched:", {
        pattern: pattern.source,
        fromToken,
        toToken,
        amount
      });
      break;
    }
  }
  if (!amount || !fromToken || !toToken) {
    const amountMatch = messageContent.match(
      /([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/
    );
    const fromMatch = messageContent.match(/from\s*([\w.-]+)/i) || messageContent.match(/(?:^|\s)([\w.-]+)(?:\s|$)/);
    const toMatch = messageContent.match(/to\s*([\w.-]+)/i);
    amount = amount || (amountMatch == null ? void 0 : amountMatch[1]) || "";
    fromToken = fromToken || (fromMatch == null ? void 0 : fromMatch[1]) || "";
    toToken = toToken || (toMatch == null ? void 0 : toMatch[1]) || "";
  }
  try {
    fromToken = formatSolanaAddress(fromToken);
    toToken = formatSolanaAddress(toToken);
  } catch (error) {
    throw new Error(
      `Address format error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  console.log("Processed tokens:", { fromToken, toToken });
  if (!fromToken) {
    throw new Error(
      "Could not determine the source token address. Please provide a valid Solana token address. Example: 'quote for 300 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v to 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'"
    );
  }
  if (!toToken) {
    throw new Error(
      "Could not determine the target token address. Please provide a valid Solana token address. Example: 'quote for 300 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v to 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'"
    );
  }
  if (!amount) {
    throw new Error(
      "Could not determine the amount to swap. Please specify the amount. Example: 'quote for 300 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v to 6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN'"
    );
  }
  try {
    const preQuote = await client.dex.getQuote({
      chainId: "501",
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      amount: "10000000000",
      // Dummy amount to get token info
      slippage: "0.1"
    });
    if (preQuote.code !== "0" || !((_a = preQuote.data) == null ? void 0 : _a[0])) {
      throw new Error(preQuote.msg || "Failed to get token information");
    }
    const fromDecimals = parseInt(preQuote.data[0].fromToken.decimal);
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount)) {
      throw new Error(`Invalid amount value: ${amount}`);
    }
    const amountInSmallestUnit = Math.floor(
      parsedAmount * Math.pow(10, fromDecimals)
    ).toString();
    console.log("Conversion details:", {
      originalAmount: amount,
      parsedAmount,
      fromDecimals,
      amountInSmallestUnit
    });
    return {
      fromTokenAddress: fromToken,
      toTokenAddress: toToken,
      amount: amountInSmallestUnit
    };
  } catch (error) {
    console.error("Error in extractSwapParams:", error);
    throw new Error(
      `Failed to process swap parameters: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function formatQuoteResponse(data) {
  const quote = "routerResult" in data ? data.routerResult : data;
  const fromDecimals = parseInt(quote.fromToken.decimal);
  const toDecimals = parseInt(quote.toToken.decimal);
  const displayFromAmount = (Number(quote.fromTokenAmount) / Math.pow(10, fromDecimals)).toFixed(6);
  const displayToAmount = (Number(quote.toTokenAmount) / Math.pow(10, toDecimals)).toFixed(6);
  return {
    success: true,
    quote: {
      fromToken: {
        symbol: quote.fromToken.tokenSymbol,
        amount: displayFromAmount,
        decimal: quote.fromToken.decimal,
        unitPrice: quote.fromToken.tokenUnitPrice
      },
      toToken: {
        symbol: quote.toToken.tokenSymbol,
        amount: displayToAmount,
        decimal: quote.toToken.decimal,
        unitPrice: quote.toToken.tokenUnitPrice
      },
      priceImpact: quote.priceImpactPercentage + "%",
      dexRoutes: quote.quoteCompareList.map((route) => ({
        dex: route.dexName,
        amountOut: route.amountOut,
        fee: route.tradeFee
      }))
    },
    summary: `Quote for ${displayFromAmount} ${quote.fromToken.tokenSymbol} to ${quote.toToken.tokenSymbol}:
Expected output: ${displayToAmount} ${quote.toToken.tokenSymbol}
Price impact: ${quote.priceImpactPercentage}%`
  };
}
function getActionHandler(actionName, actionDescription, client) {
  return async (runtime, message, state, options, callback) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    let currentState = state ?? await runtime.composeState(message);
    currentState = await runtime.updateRecentMessageState(currentState);
    try {
      let result;
      switch (actionName) {
        case "GET_CHAIN_DATA":
          const chainData = await client.dex.getChainData("501");
          result = {
            chains: chainData.data.map((chain) => ({
              id: chain.chainId,
              name: chain.chainName,
              dexApprovalAddress: chain.dexTokenApproveAddress || null
            }))
          };
          break;
        case "GET_LIQUIDITY_PROVIDERS":
          result = await client.dex.getLiquidity("501");
          break;
        case "GET_SWAP_QUOTE": {
          const params = await extractSwapParams(message, client);
          console.log("Sending quote request with params:", params);
          const quoteResult = await client.dex.getQuote({
            chainId: "501",
            fromTokenAddress: params.fromTokenAddress,
            toTokenAddress: params.toTokenAddress,
            amount: params.amount,
            slippage: "0.1",
            userWalletAddress: process.env.OKX_WALLET_ADDRESS
          });
          console.log(
            "Received quote result:",
            JSON.stringify(quoteResult, null, 2)
          );
          if (quoteResult.code === "0" && ((_a = quoteResult.data) == null ? void 0 : _a[0])) {
            result = formatQuoteResponse(quoteResult.data[0]);
          } else {
            throw new Error(
              quoteResult.msg || "Failed to get quote"
            );
          }
          break;
        }
        case "GET_SWAP_TRANSACTION_DATA": {
          const params = await extractSwapParams(message, client);
          const swapResponse = await client.dex.getSwapData({
            chainId: "501",
            fromTokenAddress: params.fromTokenAddress,
            toTokenAddress: params.toTokenAddress,
            amount: params.amount,
            slippage: "0.5",
            // autoSlippage: true,
            // maxAutoSlippage: "1000",
            userWalletAddress: process.env.OKX_WALLET_ADDRESS
          });
          if (swapResponse.code !== "0" || !((_b = swapResponse.data) == null ? void 0 : _b[0])) {
            throw new Error(
              swapResponse.msg || "Failed to get swap transaction data"
            );
          }
          result = formatQuoteResponse(swapResponse.data[0]);
          const swapData = swapResponse.data[0];
          const transactionData = {
            chainId: swapData.routerResult.chainId,
            estimateGasFee: swapData.routerResult.estimateGasFee,
            tx: swapData.tx || null
          };
          const txData = {
            ...formatQuoteResponse(swapData),
            transaction: transactionData
          };
          console.log("OKX Swap Result:", JSON.stringify(txData, null, 2));
          break;
        }
        case "GET_AVAILABLE_TOKENS":
          result = await client.dex.getTokens("501");
          break;
        case "EXECUTE_SWAP": {
          const params = await extractSwapParams(message, client);
          console.log("Getting swap data with params:", params);
          const swapResponse = await client.dex.getSwapData({
            chainId: "501",
            fromTokenAddress: params.fromTokenAddress,
            toTokenAddress: params.toTokenAddress,
            amount: params.amount,
            slippage: "0.5",
            userWalletAddress: process.env.OKX_WALLET_ADDRESS
          });
          console.log(
            "Received swap data response:",
            JSON.stringify(swapResponse, null, 2)
          );
          if (swapResponse.code !== "0" || !((_c = swapResponse.data) == null ? void 0 : _c[0])) {
            throw new Error(
              (swapResponse == null ? void 0 : swapResponse.msg) || "Failed to get swap data"
            );
          }
          const routerResult = swapResponse.data[0];
          const txData = swapResponse.data[0].tx;
          if (!((_e = (_d = routerResult.routerResult) == null ? void 0 : _d.fromToken) == null ? void 0 : _e.decimal) || !((_g = (_f = routerResult.routerResult) == null ? void 0 : _f.toToken) == null ? void 0 : _g.decimal)) {
            console.error(
              "Missing decimal information in token data:",
              routerResult
            );
            throw new Error("Invalid token decimal information");
          }
          const { routerResult: swapResult } = routerResult;
          const fromDecimals = parseInt(swapResult.fromToken.decimal);
          const toDecimals = parseInt(swapResult.toToken.decimal);
          const displayFromAmount = (parseFloat(swapResult.fromTokenAmount) / Math.pow(10, fromDecimals)).toFixed(6);
          const displayToAmount = (parseFloat(swapResult.toTokenAmount) / Math.pow(10, toDecimals)).toFixed(6);
          console.log("Executing swap with data:", {
            fromToken: swapResult.fromToken.tokenSymbol,
            toToken: swapResult.toToken.tokenSymbol,
            fromAmount: displayFromAmount,
            expectedOutput: displayToAmount,
            priceImpact: swapResult.priceImpactPercentage
          });
          const executeResult = await client.dex.executeSwap({
            chainId: "501",
            fromTokenAddress: params.fromTokenAddress,
            toTokenAddress: params.toTokenAddress,
            amount: params.amount,
            slippage: "0.5",
            userWalletAddress: process.env.OKX_WALLET_ADDRESS
          });
          const formattedResult = {
            success: executeResult.success,
            transaction: {
              id: executeResult.transactionId,
              explorerUrl: executeResult.explorerUrl
            },
            swapDetails: {
              fromToken: {
                symbol: swapResult.fromToken.tokenSymbol,
                amount: displayFromAmount,
                decimal: swapResult.fromToken.decimal
              },
              toToken: {
                symbol: swapResult.toToken.tokenSymbol,
                amount: displayToAmount,
                decimal: swapResult.toToken.decimal
              },
              priceImpact: swapResult.priceImpactPercentage + "%",
              route: ((_h = swapResult.quoteCompareList[0]) == null ? void 0 : _h.dexName) || "Unknown",
              txData: txData == null ? void 0 : txData.data
            },
            summary: `Swap executed successfully!
Swapped ${displayFromAmount} ${swapResult.fromToken.tokenSymbol} for approximately ${displayToAmount} ${swapResult.toToken.tokenSymbol}
Price Impact: ${swapResult.priceImpactPercentage}%
Transaction ID: ${executeResult.transactionId}
View on Explorer: ${executeResult.explorerUrl}`
          };
          result = formattedResult;
          break;
        }
        default:
          throw new Error(`Unknown action: ${actionName}`);
      }
      const response = await generateText({
        runtime,
        context: composeContext({
          state: currentState,
          template: JSON.stringify(result)
        }),
        modelClass: ModelClass.SMALL
      });
      callback == null ? void 0 : callback({
        text: response,
        content: result
      });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorResponse = await generateText({
        runtime,
        context: composeContext({
          state: currentState,
          template: `Error: ${errorMessage}`
        }),
        modelClass: ModelClass.SMALL
      });
      callback == null ? void 0 : callback({
        text: errorResponse,
        content: { error: errorMessage }
      });
      return false;
    }
  };
}
async function getOKXActions(getSetting) {
  const actionsWithoutHandler = [
    {
      name: "GET_CHAIN_DATA",
      description: "Get Solana chain data from OKX DEX",
      similes: [],
      validate: async () => true,
      examples: []
    },
    {
      name: "GET_LIQUIDITY_PROVIDERS",
      description: "Get liquidity providers on Solana from OKX DEX",
      similes: [],
      validate: async () => true,
      examples: []
    },
    {
      name: "GET_SWAP_QUOTE",
      description: "Get a swap quote for tokens on Solana",
      similes: [],
      validate: async () => true,
      examples: [
        [
          {
            user: "user",
            content: {
              text: "Get quote from_token: SOL123 to_token: USDC456 amount: 1.5"
            }
          },
          {
            user: "assistant",
            content: {
              text: "Getting quote for swapping 1.5 SOL123 to USDC456..."
            }
          }
        ],
        [
          {
            user: "user",
            content: {
              text: "Get quote from SOL123 to USDC456 amount 1.5"
            }
          },
          {
            user: "assistant",
            content: {
              text: "Fetching quote for 1.5 tokens from SOL123 to USDC456..."
            }
          }
        ]
      ]
    },
    {
      name: "GET_SWAP_TRANSACTION_DATA",
      description: "Get swap transaction data for tokens on Solana",
      similes: [],
      validate: async () => true,
      examples: [
        [
          {
            user: "user",
            content: {
              text: "Get swap transaction data from_token: SOL123 to_token: USDC456 amount: 1.5"
            }
          },
          {
            user: "assistant",
            content: {
              text: "Getting swap transaction data for 1.5 SOL123 to USDC456..."
            }
          }
        ]
      ]
    },
    {
      name: "GET_AVAILABLE_TOKENS",
      description: "Get available tokens for swapping on Solana",
      similes: [],
      validate: async () => true,
      examples: []
    },
    {
      name: "EXECUTE_SWAP",
      description: "Execute a token swap on Solana using OKX DEX",
      similes: [],
      validate: async () => true,
      examples: [
        [
          {
            user: "user",
            content: {
              text: "Swap from_token: SOL123 to_token: USDC456 amount: 1.5"
            }
          },
          {
            user: "assistant",
            content: {
              text: "Executing swap of 1.5 tokens from SOL123 to USDC456..."
            }
          }
        ],
        [
          {
            user: "user",
            content: { text: "Swap 1.5 from SOL123 to USDC456" }
          },
          {
            user: "assistant",
            content: {
              text: "Processing swap of 1.5 tokens from SOL123 to USDC456..."
            }
          }
        ]
      ]
    }
  ];
  const client = new OKXDexClient({
    apiKey: getSetting("OKX_API_KEY"),
    secretKey: getSetting("OKX_SECRET_KEY"),
    apiPassphrase: getSetting("OKX_API_PASSPHRASE"),
    projectId: getSetting("OKX_PROJECT_ID"),
    solana: {
      connection: {
        rpcUrl: getSetting("OKX_SOLANA_RPC_URL")
        // wsEndpoint: getSetting("OKX_WS_ENDPONT"),
      },
      privateKey: getSetting("OKX_WALLET_PRIVATE_KEY")
    }
  });
  return actionsWithoutHandler.map((action) => ({
    ...action,
    handler: getActionHandler(action.name, action.description, client)
  }));
}

// src/index.ts
var OKXPlugin = async (character) => {
  const getSetting = (key) => {
    var _a, _b;
    return ((_b = (_a = character.settings) == null ? void 0 : _a.secrets) == null ? void 0 : _b[key]) || process.env[key];
  };
  const requiredSettings = [
    "OKX_API_KEY",
    "OKX_SECRET_KEY",
    "OKX_API_PASSPHRASE",
    "OKX_PROJECT_ID",
    "OKX_SOLANA_RPC_URL",
    "OKX_WALLET_PRIVATE_KEY"
  ];
  const missingSettings = requiredSettings.filter(
    (setting) => !getSetting(setting)
  );
  if (missingSettings.length > 0) {
    console.warn(
      `Missing required settings for OKX plugin: ${missingSettings.join(", ")}`
    );
    return {
      name: "OKX DEX Plugin",
      description: "OKX DEX integration for Solana swaps",
      providers: [],
      evaluators: [],
      services: [],
      actions: []
    };
  }
  try {
    console.log("Initializing OKX DEX Plugin...");
    const actions = await getOKXActions(getSetting);
    console.log("\nAvailable Actions:");
    actions.forEach((action) => {
      console.log(`- ${action.name}: ${action.description}`);
    });
    return {
      name: "OKX DEX Plugin",
      description: "OKX DEX integration for Solana swaps",
      providers: [],
      evaluators: [],
      services: [],
      actions
    };
  } catch (error) {
    console.error("Error initializing OKX plugin:", error);
    throw error;
  }
};
var index_default = OKXPlugin;
export {
  OKXPlugin,
  index_default as default
};
//# sourceMappingURL=index.js.map