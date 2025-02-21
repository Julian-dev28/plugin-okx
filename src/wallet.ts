import * as web3 from "@solana/web3.js";
import base58 from "bs58";
import * as nacl from "tweetnacl";
import * as dotenv from "dotenv";

dotenv.config();

// const solanaWalletAddress = process.env.OKX_WALLET_ADDRESS;
const solanaPrivateKeyValue = process.env.OKX_WALLET_PRIVATE_KEY;
const solanaRpcUrl = process.env.OKX_SOLANA_RPC_URL;
// const solanaWsEndpoint = process.env.OKX_WS_ENDPONT;

// Interface for the wallet client
export interface SolanaWalletClientBase {
    getAddress(): string;
    balanceOf(address: string): Promise<string>;
    signTransaction(transaction: web3.Transaction): Promise<web3.Transaction>;
    signMessage(message: Uint8Array): Uint8Array;
    signMessageString(message: string): Uint8Array;
    getConnection(): web3.Connection;
}

class SolanaWallet implements SolanaWalletClientBase {
    private connection: web3.Connection;
    private keypair: web3.Keypair;

    constructor(privateKey: string, rpcUrl: string, wsEndpoint?: string) {
        this.connection = new web3.Connection(rpcUrl, {
            wsEndpoint: wsEndpoint,
        });
        this.keypair = web3.Keypair.fromSecretKey(base58.decode(privateKey));
    }

    getAddress(): string {
        return this.keypair.publicKey.toString();
    }

    async balanceOf(address: string): Promise<string> {
        const balance = await this.connection.getBalance(
            new web3.PublicKey(address),
        );
        return (balance / web3.LAMPORTS_PER_SOL).toString();
    }

    async signTransaction(
        transaction: web3.Transaction,
    ): Promise<web3.Transaction> {
        transaction.partialSign(this.keypair);
        return transaction;
    }

    signMessage(message: Uint8Array): Uint8Array {
        return nacl.sign.detached(message, this.keypair.secretKey);
    }

    signMessageString(message: string): Uint8Array {
        const messageBytes = new TextEncoder().encode(message);
        return this.signMessage(messageBytes);
    }

    getConnection(): web3.Connection {
        return this.connection;
    }
}

export function getSolanaWalletClient(
    getSetting: (key: string) => string | undefined,
): SolanaWalletClientBase | null {
    const privateKey = getSetting(solanaPrivateKeyValue);
    if (!privateKey) return null;

    const rpcUrl = getSetting(solanaRpcUrl);
    if (!rpcUrl) throw new Error("SOLANA_RPC_URL not configured");

    // const wsEndpoint = getSetting(solanaWsEndpoint);

    return new SolanaWallet(privateKey, rpcUrl); // add if needed wsEndpoint;
}

export function getSolanaWalletProvider(walletClient: SolanaWalletClientBase) {
    return {
        async get(): Promise<string | null> {
            try {
                const address = walletClient.getAddress();
                const balance = await walletClient.balanceOf(address);
                return `Solana Wallet Address: ${address}\nBalance: ${balance} SOL`;
            } catch (error) {
                console.error("Error in Solana wallet provider:", error);
                return null;
            }
        },
    };
}
