import type { IAgentRuntime } from "@elizaos/core";
import { z } from "zod";

export const okxEnvironmentSchema = z.object({
    OKX_API_KEY: z.string(),
    OKX_SECRET_KEY: z.string(),
    OKX_API_PASSPHRASE: z.string(),
    OKX_PROJECT_ID: z.string(),
    OKX_SOLANA_RPC_URL: z.string(),
    OKX_WALLET_ADDRESS: z.string(),
    OKX_WALLET_PRIVATE_KEY: z.string(),
    OKX_WS_ENDPOINT: z.string().optional(),
    OPENAI_API_KEY: z.string(),
});

export type OKXConfig = z.infer<typeof okxEnvironmentSchema>;

export async function validateOKXConfig( runtime: IAgentRuntime) : Promise<OKXConfig> {
    try {
        const config = {
            OKX_API_KEY: runtime.getSetting("OKX_API_KEY") || process.env.OKX_API_KEY,
            OKX_SECRET_KEY: runtime.getSetting("OKX_SECRET_KEY") || process.env.OKX_SECRET_KEY,
            OKX_API_PASSPHRASE: runtime.getSetting("OKX_API_PASSPHRASE") || process.env.OKX_API_PASSPHRASE,
            OKX_PROJECT_ID: runtime.getSetting("OKX_PROJECT_ID") || process.env.OKX_PROJECT_ID,
            OKX_SOLANA_RPC_URL: runtime.getSetting("OKX_SOLANA_RPC_URL") || process.env.OKX_SOLANA_RPC_URL,
            OKX_WALLET_ADDRESS: runtime.getSetting("OKX_WALLET_ADDRESS") || process.env.OKX_WALLET_ADDRESS,
            OKX_WALLET_PRIVATE_KEY: runtime.getSetting("OKX_WALLET_PRIVATE_KEY") || process.env.OKX_WALLET_PRIVATE_KEY,
            OKX_WS_ENDPOINT: runtime.getSetting("OKX_WS_ENDPOINT") || process.env.OKX_WS_ENDPOINT,
            OPENAI_API_KEY: runtime.getSetting("OPENAI_API_KEY") || process.env.OPENAI_API_KEY,
        };

        return okxEnvironmentSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessage = error.errors.map((e) => e.message).join("\n");
            throw new Error(`OKX Configuration Error:\n${errorMessage}`);
        }
        throw error;
    }
}