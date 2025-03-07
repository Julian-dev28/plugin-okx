// src/api/dex.ts
import { DexAPI as DexApiSDK, NetworkConfigs } from '@okx-dex/okx-dex-sdk';
import { HTTPClient } from '@okx-dex/okx-dex-sdk/dist/core/http-client';
import {
    SwapParams,
    SlippageOptions,
    OKXConfig,
    QuoteParams,
    QuoteData,
    APIResponse,
    APIRequestParams,
    SwapResult,
    NetworkConfigs as NetworkConfigsType,
    ChainConfig,
    SwapResponseData,
    ChainData,
} from "../types";
import base58 from "bs58";
import * as solanaWeb3 from "@solana/web3.js";
import { Connection } from "@solana/web3.js";

export class DexAPI {
    private readonly dexApi: DexApiSDK;
    private readonly defaultNetworkConfigs: NetworkConfigsType = {
        "501": {
            id: "501",
            explorer: "https://solscan.io/tx",
            defaultSlippage: "0.5",
            maxSlippage: "1",
            computeUnits: 300000,
            confirmationTimeout: 60000,
            maxRetries: 3,
        },
    };
    private readonly config: OKXConfig;

    constructor(config: OKXConfig) {
        this.config = config;
        // Merge default configs with provided configs
        this.config.networks = {
            ...this.defaultNetworkConfigs,
            ...(config.networks || {}),
        };

        const httpClient = new HTTPClient({
            apiKey: config.apiKey,
            secretKey: config.secretKey,
            apiPassphrase: config.apiPassphrase,
            baseUrl: config.baseUrl || 'https://www.okx.com',
            projectId: config.projectId,
        });

        const feePayer = solanaWeb3.Keypair.fromSecretKey(
            base58.decode(config.solana.privateKey)
        );

        const configWithWallet = {
            ...config,
            solana: {
                ...config.solana,
                walletAddress: feePayer.publicKey.toString()
            }
        };

        this.dexApi = new DexApiSDK(httpClient, configWithWallet);
    }

    private getNetworkConfig(chainId: string): ChainConfig {
        const networkConfig = this.config.networks?.[chainId];
        if (!networkConfig) {
            throw new Error(`Network configuration not found for chain ${chainId}`);
        }
        return networkConfig;
    }

    // Convert params to API format
    private toAPIParams(params: Record<string, any>): APIRequestParams {
        const apiParams: APIRequestParams = {};

        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                if (key === "autoSlippage") {
                    apiParams[key] = value ? "true" : "false";
                } else {
                    apiParams[key] = String(value);
                }
            }
        }

        return apiParams;
    }

    async getQuote(params: QuoteParams): Promise<APIResponse<QuoteData>> {
        return this.dexApi.getQuote(params);
    }

    async getLiquidity(chainId: string): Promise<APIResponse<QuoteData>> {
        return this.dexApi.getLiquidity(chainId);
    }

    async getChainData(chainId: string): Promise<APIResponse<ChainData>> {
        return this.dexApi.getChainData(chainId);
    }

    async getSwapData(params: SwapParams): Promise<SwapResponseData> {
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
            throw new Error("maxAutoSlippageBps must be provided when autoSlippage is enabled");
        }

        return this.dexApi.getSwapData(params);
    }

    async getTokens(chainId: string): Promise<APIResponse<QuoteData>> {
        return this.dexApi.getTokens(chainId);
    }

    async executeSwap(params: SwapParams): Promise<SwapResult> {
        const swapData = await this.getSwapData(params);

        switch (params.chainId) {
            case "501": // Solana
                return this.executeSolanaSwap(swapData, params);
            default:
                throw new Error(`Chain ${params.chainId} not supported for swap execution`);
        }
    }

    // Update the executeSwap function to properly handle decimals
    private async executeSolanaSwap(swapData: SwapResponseData, params: SwapParams): Promise<SwapResult> {
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

            const connection = new Connection(this.config.solana.connection.rpcUrl, {
                commitment: "confirmed",
                wsEndpoint: this.config.solana.connection.wsEndpoint,
                confirmTransactionInitialTimeout: networkConfig.confirmationTimeout,
            });

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
            const decodedTransaction = base58.decode(txData);
            let transaction: solanaWeb3.Transaction | solanaWeb3.VersionedTransaction;

            try {
                transaction = solanaWeb3.VersionedTransaction.deserialize(decodedTransaction);
                (transaction as solanaWeb3.VersionedTransaction).message.recentBlockhash = blockhash;
            } catch {
                transaction = solanaWeb3.Transaction.from(decodedTransaction);
                (transaction as solanaWeb3.Transaction).recentBlockhash = blockhash;
                (transaction as solanaWeb3.Transaction).feePayer = feePayer.publicKey;

                const computeBudgetIx = solanaWeb3.ComputeBudgetProgram.setComputeUnitLimit({
                    units: this.config.solana.computeUnits || 300000,
                });
                (transaction as solanaWeb3.Transaction).add(computeBudgetIx);
            }

            if (transaction instanceof solanaWeb3.VersionedTransaction) {
                transaction.sign([feePayer]);
            } else {
                transaction.sign(feePayer);
            }

            const signature = await connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: false,
                maxRetries: networkConfig.maxRetries,
                preflightCommitment: "confirmed",
            });

            const confirmation = await connection.confirmTransaction(
                {
                    signature,
                    blockhash,
                    lastValidBlockHeight,
                },
                "confirmed"
            );

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            const fromDecimals = parseInt(routerResult.fromToken.decimal);
            const toDecimals = parseInt(routerResult.toToken.decimal);

            const displayFromAmount = (
                Number(routerResult.fromTokenAmount) / Math.pow(10, fromDecimals)
            ).toFixed(6);

            const displayToAmount = (
                Number(routerResult.toTokenAmount) / Math.pow(10, toDecimals)
            ).toFixed(6);

            return {
                success: true,
                transactionId: signature,
                explorerUrl: `${networkConfig.explorer}/${signature}`,
                details: {
                    fromToken: {
                        symbol: routerResult.fromToken.tokenSymbol,
                        amount: displayFromAmount,
                        decimal: routerResult.fromToken.decimal,
                    },
                    toToken: {
                        symbol: routerResult.toToken.tokenSymbol,
                        amount: displayToAmount,
                        decimal: routerResult.toToken.decimal,
                    },
                    priceImpact: routerResult.priceImpactPercentage,
                },
            };
        } catch (error) {
            console.error("Swap execution failed:", error);
            throw error;
        }
    }
}
