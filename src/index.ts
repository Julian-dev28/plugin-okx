// src/index.ts
import type { Plugin, Character } from "@elizaos/core";
import { getOKXActions } from "./actions";

export const OKXPlugin = async (character: Character): Promise<Plugin> => {
    const getSetting = (key: string) => character.settings?.secrets?.[key] || process.env[key];
    
    // Validate required settings
    const requiredSettings = [
        "OKX_API_KEY",
        "OKX_SECRET_KEY",
        "OKX_API_PASSPHRASE",
        "OKX_PROJECT_ID",
        "OKX_SOLANA_RPC_URL",
        "OKX_WALLET_PRIVATE_KEY",
    ];

    const missingSettings = requiredSettings.filter(
        (setting) => !getSetting(setting),
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
        
        // Simple action display
        console.log("\nAvailable Actions:");
        actions.forEach(action => {
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

export default OKXPlugin;