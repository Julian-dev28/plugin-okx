// src/actions.ts
import {
  generateText,
  ModelClass,
  composeContext
} from "@elizaos/core";

// src/okx/core/http-client.ts
import CryptoJS from "crypto-js";
var APIError = class extends Error {
  constructor(message, status, statusText, responseBody, requestDetails) {
    super(message);
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
    this.requestDetails = requestDetails;
    this.name = "APIError";
  }
};
var HTTPClient = class {
  config;
  constructor(config) {
    this.config = {
      baseUrl: "https://www.okx.com",
      maxRetries: 3,
      timeout: 3e4,
      ...config
    };
  }
  getHeaders(timestamp, method, path, queryString = "") {
    const stringToSign = timestamp + method + path + queryString;
    return {
      "Content-Type": "application/json",
      "OK-ACCESS-KEY": this.config.apiKey,
      "OK-ACCESS-SIGN": CryptoJS.enc.Base64.stringify(
        CryptoJS.HmacSHA256(stringToSign, this.config.secretKey)
      ),
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": this.config.apiPassphrase,
      "OK-ACCESS-PROJECT": this.config.projectId
    };
  }
  async handleErrorResponse(response, requestDetails) {
    let responseBody;
    try {
      responseBody = await response.json();
    } catch (e) {
      responseBody = await response.text();
    }
    throw new APIError(
      `HTTP error! status: ${response.status}`,
      response.status,
      response.statusText,
      responseBody,
      requestDetails
    );
  }
  async request(method, path, params) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const cleanParams = params ? Object.fromEntries(
      Object.entries(params).filter(([_, v]) => v !== void 0)
    ) : void 0;
    const queryString = cleanParams ? "?" + new URLSearchParams(cleanParams).toString() : "";
    const headers = this.getHeaders(timestamp, method, path, queryString);
    const requestDetails = {
      method,
      path,
      params: cleanParams,
      queryString,
      url: `${this.config.baseUrl}${path}${queryString}`
    };
    if (process.env.NODE_ENV === "development") {
      console.log("Request Details:", {
        url: requestDetails.url,
        method: requestDetails.method,
        headers: {
          ...headers,
          "OK-ACCESS-SIGN": "***",
          // Hide sensitive data
          "OK-ACCESS-KEY": "***",
          "OK-ACCESS-PASSPHRASE": "***"
        },
        params: requestDetails.params
      });
    }
    let retries = 0;
    while (retries < this.config.maxRetries) {
      try {
        const response = await fetch(`${this.config.baseUrl}${path}${queryString}`, {
          method,
          headers
        });
        if (!response.ok) {
          await this.handleErrorResponse(response, requestDetails);
        }
        const data = await response.json();
        if (process.env.NODE_ENV === "development") {
          console.log("Response:", JSON.stringify(data, null, 2));
        }
        if (data.code !== "0") {
          throw new APIError(
            `API Error: ${data.msg}`,
            response.status,
            response.statusText,
            data,
            requestDetails
          );
        }
        return data;
      } catch (error) {
        if (error instanceof APIError) {
          if (retries === this.config.maxRetries - 1) throw error;
        } else {
          if (retries === this.config.maxRetries - 1) {
            throw new APIError(
              error instanceof Error ? error.message : "Unknown error",
              void 0,
              void 0,
              void 0,
              requestDetails
            );
          }
        }
        retries++;
        await new Promise((resolve) => setTimeout(resolve, 1e3 * retries));
      }
    }
    throw new Error("Max retries exceeded");
  }
};

// src/okx/api/dex.ts
import base58 from "bs58";
import * as solanaWeb3 from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
var DexAPI = class {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.config.networks = {
      ...this.defaultNetworkConfigs,
      ...config.networks || {}
    };
  }
  defaultNetworkConfigs = {
    "501": {
      id: "501",
      explorer: "https://solscan.io/tx",
      defaultSlippage: "0.5",
      maxSlippage: "1",
      computeUnits: 3e5,
      confirmationTimeout: 6e4,
      maxRetries: 3
    }
  };
  getNetworkConfig(chainId) {
    const networkConfig = this.config.networks?.[chainId];
    if (!networkConfig) {
      throw new Error(
        `Network configuration not found for chain ${chainId}`
      );
    }
    return networkConfig;
  }
  // Convert params to API format
  toAPIParams(params) {
    const apiParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== void 0) {
        if (key === "autoSlippage") {
          apiParams[key] = value ? "true" : "false";
        } else {
          apiParams[key] = String(value);
        }
      }
    }
    return apiParams;
  }
  async getQuote(params) {
    return this.client.request(
      "GET",
      "/api/v5/dex/aggregator/quote",
      this.toAPIParams(params)
    );
  }
  async getLiquidity(chainId) {
    return this.client.request(
      "GET",
      "/api/v5/dex/aggregator/get-liquidity",
      this.toAPIParams({ chainId })
    );
  }
  async getSupportedChains(chainId) {
    return this.client.request(
      "GET",
      "/api/v5/dex/aggregator/supported/chain",
      this.toAPIParams({ chainId })
    );
  }
  async getSwapData(params) {
    if (!params.slippage && !params.autoSlippage) {
      throw new Error("Either slippage or autoSlippage must be provided");
    }
    if (params.slippage) {
      const slippageValue = parseFloat(params.slippage);
      if (isNaN(slippageValue) || slippageValue < 0 || slippageValue > 1) {
        throw new Error("Slippage must be between 0 and 1");
      }
    }
    if (params.autoSlippage && !params.maxAutoSlippage) {
      throw new Error(
        "maxAutoSlippageBps must be provided when autoSlippage is enabled"
      );
    }
    return this.client.request(
      "GET",
      "/api/v5/dex/aggregator/swap",
      this.toAPIParams(params)
    );
  }
  async getTokens(chainId) {
    return this.client.request(
      "GET",
      "/api/v5/dex/aggregator/all-tokens",
      this.toAPIParams({ chainId })
    );
  }
  async executeSwap(params) {
    const swapData = await this.getSwapData(params);
    switch (params.chainId) {
      case "501":
        return this.executeSolanaSwap(swapData, params);
      default:
        throw new Error(
          `Chain ${params.chainId} not supported for swap execution`
        );
    }
  }
  // Update the executeSwap function to properly handle decimals
  async executeSolanaSwap(swapData, params) {
    const networkConfig = this.getNetworkConfig(params.chainId);
    if (!this.config.solana) {
      throw new Error("Solana configuration required");
    }
    const quoteData = swapData.data?.[0];
    if (!quoteData?.routerResult) {
      throw new Error("Invalid swap data: missing router result");
    }
    const { routerResult } = quoteData;
    if (!routerResult.fromToken?.decimal || !routerResult.toToken?.decimal) {
      throw new Error(
        `Missing decimal information for tokens: ${routerResult.fromToken?.tokenSymbol} -> ${routerResult.toToken?.tokenSymbol}`
      );
    }
    const txData = quoteData.tx?.data;
    if (!txData) {
      throw new Error("Missing transaction data");
    }
    try {
      const feePayer = solanaWeb3.Keypair.fromSecretKey(
        base58.decode(this.config.solana.privateKey)
      );
      const connection = new Connection(
        this.config.solana.connection.rpcUrl,
        {
          commitment: "confirmed",
          wsEndpoint: this.config.solana.connection.wsEndpoint,
          confirmTransactionInitialTimeout: networkConfig.confirmationTimeout
        }
      );
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const decodedTransaction = base58.decode(txData);
      let transaction;
      try {
        transaction = solanaWeb3.VersionedTransaction.deserialize(
          decodedTransaction
        );
        transaction.message.recentBlockhash = blockhash;
      } catch {
        transaction = solanaWeb3.Transaction.from(decodedTransaction);
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = feePayer.publicKey;
        const computeBudgetIx = solanaWeb3.ComputeBudgetProgram.setComputeUnitLimit({
          units: this.config.solana.computeUnits || 3e5
        });
        transaction.add(computeBudgetIx);
      }
      if (transaction instanceof solanaWeb3.VersionedTransaction) {
        transaction.sign([feePayer]);
      } else {
        transaction.sign(feePayer);
      }
      const signature = await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          maxRetries: networkConfig.maxRetries,
          preflightCommitment: "confirmed"
        }
      );
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight
        },
        "confirmed"
      );
      if (confirmation.value.err) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(
            confirmation.value.err
          )}`
        );
      }
      const fromDecimals = parseInt(routerResult.fromToken.decimal);
      const toDecimals = parseInt(routerResult.toToken.decimal);
      const displayFromAmount = (Number(routerResult.fromTokenAmount) / Math.pow(10, fromDecimals)).toFixed(6);
      const displayToAmount = (Number(routerResult.toTokenAmount) / Math.pow(10, toDecimals)).toFixed(6);
      return {
        success: true,
        transactionId: signature,
        explorerUrl: `${networkConfig.explorer}/${signature}`,
        details: {
          fromToken: {
            symbol: routerResult.fromToken.tokenSymbol,
            amount: displayFromAmount,
            decimal: routerResult.fromToken.decimal
          },
          toToken: {
            symbol: routerResult.toToken.tokenSymbol,
            amount: displayToAmount,
            decimal: routerResult.toToken.decimal
          },
          priceImpact: routerResult.priceImpactPercentage
        }
      };
    } catch (error) {
      console.error("Swap execution failed:", error);
      throw error;
    }
  }
};

// src/okx/api/bridge.ts
var BridgeAPI = class {
  constructor(client) {
    this.client = client;
  }
  // Get tokens supported for cross-chain transfers
  async getSupportedTokens(chainId) {
    return this.client.request("GET", "/api/v5/dex/cross-chain/supported/tokens", { chainId });
  }
  // Get supported bridges for a chain
  async getSupportedBridges(chainId) {
    return this.client.request("GET", "/api/v5/dex/cross-chain/supported/bridges", { chainId });
  }
  // Get token pairs available for bridging
  async getBridgeTokenPairs(fromChainId) {
    return this.client.request(
      "GET",
      "/api/v5/dex/cross-chain/supported/bridge-tokens-pairs",
      { fromChainId }
    );
  }
  // Get quote for a cross-chain swap
  async getCrossChainQuote(params) {
    const slippageValue = parseFloat(params.slippage);
    if (isNaN(slippageValue) || slippageValue < 2e-3 || slippageValue > 0.5) {
      throw new Error("Slippage must be between 0.002 (0.2%) and 0.5 (50%)");
    }
    return this.client.request("GET", "/api/v5/dex/cross-chain/quote", params);
  }
  // Build cross-chain swap transaction
  async buildCrossChainSwap(params) {
    if (!params.userWalletAddress) {
      throw new Error("userWalletAddress is required");
    }
    return this.client.request("GET", "/api/v5/dex/cross-chain/build-tx", params);
  }
};

// src/okx/core/client.ts
var OKXDexClient = class {
  config;
  httpClient;
  dex;
  bridge;
  constructor(config) {
    this.config = {
      baseUrl: "https://www.okx.com",
      maxRetries: 3,
      timeout: 3e4,
      ...config
    };
    this.httpClient = new HTTPClient(this.config);
    this.dex = new DexAPI(this.httpClient, this.config);
    this.bridge = new BridgeAPI(this.httpClient);
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
    amount = amount || amountMatch?.[1] || "";
    fromToken = fromToken || fromMatch?.[1] || "";
    toToken = toToken || toMatch?.[1] || "";
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
    if (preQuote.code !== "0" || !preQuote.data?.[0]) {
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
    let currentState = state ?? await runtime.composeState(message);
    currentState = await runtime.updateRecentMessageState(currentState);
    try {
      let result;
      switch (actionName) {
        case "GET_CHAIN_DATA":
          const chainData = await client.dex.getSupportedChains("501");
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
          if (quoteResult.code === "0" && quoteResult.data?.[0]) {
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
          if (swapResponse.code !== "0" || !swapResponse.data?.[0]) {
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
          if (swapResponse.code !== "0" || !swapResponse.data?.[0]) {
            throw new Error(
              swapResponse?.msg || "Failed to get swap data"
            );
          }
          const routerResult = swapResponse.data[0];
          const txData = swapResponse.data[0].tx;
          if (!routerResult.routerResult?.fromToken?.decimal || !routerResult.routerResult?.toToken?.decimal) {
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
              route: swapResult.quoteCompareList[0]?.dexName || "Unknown",
              txData: txData?.data
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
      callback?.({
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
      callback?.({
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
  const getSetting = (key) => character.settings?.secrets?.[key] || process.env[key];
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