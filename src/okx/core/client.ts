// src/core/client.ts
import { DexAPI, BridgeAPI } from '@okx-dex/okx-dex-sdk';
import { HTTPClient } from '@okx-dex/okx-dex-sdk/dist/core/http-client';
import type { OKXConfig } from "../types";
import { Keypair } from "@solana/web3.js";
import base58 from "bs58";

export class OKXDexClient {
    public dex: DexAPI;
    public bridge: BridgeAPI;

    constructor(config: OKXConfig) {
        const defaultConfig = {
            baseUrl: "https://www.okx.com",
            maxRetries: 3,
            timeout: 30000,
            ...config,
        };

        const configWithWallet = {
            ...defaultConfig,
            solana: defaultConfig.solana ? {
                ...defaultConfig.solana,
                walletAddress: Keypair.fromSecretKey(
                    base58.decode(defaultConfig.solana.privateKey)
                ).publicKey.toString()
            } : undefined
        };

        const httpClient = new HTTPClient(configWithWallet);
        this.dex = new DexAPI(httpClient, configWithWallet);
        this.bridge = new BridgeAPI(httpClient);
    }
}
