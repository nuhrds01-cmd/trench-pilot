import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

export type WalletInfo = {
  configured: boolean;
  address: string | null;
  balanceSol: number | null;
  rpcUrl: string;
  liveTradingReady: boolean;
};

function getRpcUrl() {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function getConnection() {
  return new Connection(getRpcUrl(), "confirmed");
}

export function getBotKeypair(): Keypair | null {
  const secret = process.env.BOT_WALLET_SECRET_KEY?.trim();
  if (!secret) return null;
  try {
    const bytes = bs58.decode(secret);
    return Keypair.fromSecretKey(bytes);
  } catch {
    try {
      const json = JSON.parse(secret) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(json));
    } catch {
      return null;
    }
  }
}

export function getBotAddress(): string | null {
  const fromEnv = process.env.BOT_WALLET_ADDRESS?.trim();
  if (fromEnv) return fromEnv;
  const kp = getBotKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}

export async function getWalletInfo(): Promise<WalletInfo> {
  const address = getBotAddress();
  const kp = getBotKeypair();
  const rpcUrl = getRpcUrl();
  if (!address) {
    return {
      configured: false,
      address: null,
      balanceSol: null,
      rpcUrl,
      liveTradingReady: false,
    };
  }

  let balanceSol: number | null = null;
  try {
    const connection = getConnection();
    const lamports = await connection.getBalance(new PublicKey(address));
    balanceSol = lamports / LAMPORTS_PER_SOL;
  } catch {
    balanceSol = null;
  }

  return {
    configured: Boolean(kp),
    address,
    balanceSol,
    rpcUrl,
    liveTradingReady: Boolean(kp),
  };
}

export async function withdrawSol(to: string, amountSol: number) {
  const kp = getBotKeypair();
  if (!kp) {
    return { ok: false as const, message: "Bot wallet secret key not configured." };
  }
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    return { ok: false as const, message: "Amount must be positive." };
  }

  let destination: PublicKey;
  try {
    destination = new PublicKey(to.trim());
  } catch {
    return { ok: false as const, message: "Invalid destination address." };
  }

  const connection = getConnection();
  const balance = await connection.getBalance(kp.publicKey);
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  // leave a little for fees
  const feeBuffer = 5000;
  if (lamports + feeBuffer > balance) {
    return {
      ok: false as const,
      message: `Insufficient balance. On-chain: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
    };
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: destination,
      lamports,
    }),
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [kp], {
    commitment: "confirmed",
  });

  return {
    ok: true as const,
    message: `Sent ${amountSol} SOL`,
    signature,
    explorerUrl: `https://solscan.io/tx/${signature}`,
  };
}

export function exportSecretKey() {
  const secret = process.env.BOT_WALLET_SECRET_KEY?.trim();
  const address = getBotAddress();
  if (!secret || !address) {
    return { ok: false as const, message: "Wallet not configured." };
  }
  return {
    ok: true as const,
    address,
    secretKeyBase58: secret,
    message:
      "Save this private key offline. Anyone with it can take the SOL. Import it into Phantom → Import private key.",
  };
}
