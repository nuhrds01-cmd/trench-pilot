import {
  OnlinePumpSdk,
  PUMP_SDK,
  CashbackCoinNotSupportedError,
  getBuyTokenAmountFromSolAmount,
  getBuyV3TokenAmountFromQuoteAmount,
  getSellSolAmountFromTokenAmount,
  isSolLikeQuoteMint,
} from "@pump-fun/pump-sdk";
import {
  OnlinePumpAmmSdk,
  PUMP_AMM_SDK,
  canonicalPumpPoolPda,
} from "@pump-fun/pump-swap-sdk";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { getBotKeypair, getConnection } from "@/lib/wallet/bot-wallet";

const DEFAULT_SLIPPAGE = 18;

export type SellVenue = "bonding" | "pumpswap";

export type LiveTradeResult =
  | {
      ok: true;
      signature: string;
      solAmount: number;
      tokenAmount: number;
      priceSol: number;
      explorerUrl: string;
      venue?: SellVenue;
    }
  | { ok: false; message: string; ghostPosition?: boolean };

/** Where a mint currently trades: bonding curve or PumpSwap after migration. */
export async function resolveSellVenue(mintStr: string): Promise<SellVenue> {
  const mint = new PublicKey(mintStr);
  const online = new OnlinePumpSdk(getConnection());
  const curve = await online.fetchBondingCurve(mint);
  return curve.complete ? "pumpswap" : "bonding";
}

function explorer(sig: string) {
  return `https://solscan.io/tx/${sig}`;
}

function formatProgramError(err: unknown): string {
  const raw = JSON.stringify(err);
  if (raw.includes("6042") || raw.includes("BuySlippageBelowMinTokensOut")) {
    return "Slippage too tight — price moved before the buy landed. Try again (or raise slippage).";
  }
  if (raw.includes("6024") || raw.includes("TooMuchSolRequired")) {
    return "Buy exceeded max SOL (slippage). Try again.";
  }
  if (raw.includes("6025") || raw.includes("TooLittleSolReceived")) {
    return "Sell got less SOL than min out (slippage). Try again.";
  }
  if (raw.includes("6010") || raw.includes("AccountTypeNotSupported")) {
    return "This coin is not SOL-quoted (e.g. WIF/USDC/pump-coin pair). Bot only trades SOL bonding curves.";
  }
  return `On-chain tx failed: ${raw}`;
}

/** True when the mint's pump bonding curve is priced in SOL/WSOL. */
export async function isSolQuotedPumpMint(mintStr: string): Promise<boolean> {
  try {
    const mint = new PublicKey(mintStr);
    const connection = getConnection();
    const online = new OnlinePumpSdk(connection);
    const curve = await online.fetchBondingCurve(mint);
    return isSolLikeQuoteMint(curve.quoteMint);
  } catch {
    return false;
  }
}

async function sendIxs(ixs: TransactionInstruction[]) {
  const kp = getBotKeypair();
  if (!kp) throw new Error("Bot wallet not configured");
  const connection = getConnection();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const all = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    ...ixs,
  ];

  const message = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: blockhash,
    instructions: all,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([kp]);
  const signature = await connection.sendTransaction(tx, {
    skipPreflight: false,
    maxRetries: 3,
  });
  const conf = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(formatProgramError(conf.value.err));
  }

  // Double-check: some RPCs confirm before meta.err is visible
  const statuses = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  const st = statuses.value[0];
  if (st?.err) {
    throw new Error(formatProgramError(st.err));
  }
  return signature;
}

async function resolveTokenProgram(mint: PublicKey) {
  const connection = getConnection();
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error("Mint account not found");
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

export async function liveBuyExactSol(
  mintStr: string,
  solAmount: number,
  slippage = DEFAULT_SLIPPAGE,
): Promise<LiveTradeResult> {
  const kp = getBotKeypair();
  if (!kp) return { ok: false, message: "Bot wallet secret not configured." };
  if (!Number.isFinite(solAmount) || solAmount <= 0) {
    return { ok: false, message: "Buy size must be positive." };
  }

  try {
    const mint = new PublicKey(mintStr);
    const connection = getConnection();
    const online = new OnlinePumpSdk(connection);
    const global = await online.fetchGlobal();
    const feeConfig = await online.fetchFeeConfig();
    const tokenProgram = await resolveTokenProgram(mint);
    const buyState = await online.fetchBuyState(
      mint,
      kp.publicKey,
      tokenProgram,
    );

    if (!isSolLikeQuoteMint(buyState.bondingCurve.quoteMint)) {
      return {
        ok: false,
        message:
          "Skipped: not a SOL-quoted pump curve (quoted in another token). Only SOL pairs are supported.",
      };
    }

    const quoteAmount = new BN(Math.floor(solAmount * 1e9));
    const venue: SellVenue = buyState.bondingCurve.complete
      ? "pumpswap"
      : "bonding";
    let ixs: TransactionInstruction[];
    let tokenAmountBn = new BN(0);

    if (venue === "pumpswap") {
      const ammOnline = new OnlinePumpAmmSdk(connection);
      const pool = canonicalPumpPoolPda(mint);
      const poolInfo = await connection.getAccountInfo(pool);
      if (!poolInfo) {
        return {
          ok: false,
          message:
            "Migrated coin but PumpSwap pool not found yet — retry in a moment.",
        };
      }
      const swapState = await ammOnline.swapSolanaState(pool, kp.publicKey);
      ixs = await PUMP_AMM_SDK.buyQuoteInput(swapState, quoteAmount, slippage);
    } else {
      try {
        tokenAmountBn = getBuyV3TokenAmountFromQuoteAmount({
          global,
          feeConfig,
          mintSupply: buyState.bondingCurve.tokenTotalSupply,
          bondingCurve: buyState.bondingCurve,
          amount: quoteAmount,
          curveBaseTokenBalance: buyState.curveBaseTokenBalance,
        });
        if (tokenAmountBn.isZero()) {
          return { ok: false, message: "Quote returned zero tokens." };
        }
        ixs = await PUMP_SDK.buyExactQuoteInV3Instructions({
          bondingCurve: buyState.bondingCurve,
          associatedUserAccountInfo: buyState.associatedUserAccountInfo,
          mint,
          user: kp.publicKey,
          amount: tokenAmountBn,
          quoteAmount,
          slippage,
          tokenProgram,
          quoteTokenProgram: buyState.quoteTokenProgram,
        });
      } catch (e) {
        if (!(e instanceof CashbackCoinNotSupportedError)) throw e;
        tokenAmountBn = getBuyTokenAmountFromSolAmount({
          global,
          feeConfig,
          mintSupply: buyState.bondingCurve.tokenTotalSupply,
          bondingCurve: buyState.bondingCurve,
          amount: quoteAmount,
          quoteMint: buyState.quoteMint,
        });
        ixs = await PUMP_SDK.buyInstructions({
          global,
          bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
          bondingCurve: buyState.bondingCurve,
          associatedUserAccountInfo: buyState.associatedUserAccountInfo,
          mint,
          user: kp.publicKey,
          solAmount: quoteAmount,
          amount: tokenAmountBn,
          slippage,
          tokenProgram,
        });
      }
    }

    const ata = getAssociatedTokenAddressSync(
      mint,
      kp.publicKey,
      false,
      tokenProgram,
    );
    let balBefore = BigInt(0);
    try {
      balBefore = (
        await getAccount(connection, ata, "confirmed", tokenProgram)
      ).amount;
    } catch {
      balBefore = BigInt(0);
    }

    const signature = await sendIxs(ixs);

    // Prefer actual post-buy ATA balance over the quote estimate
    let tokenAmount = Number(tokenAmountBn.toString()) / 1e6;
    try {
      const account = await getAccount(
        connection,
        ata,
        "confirmed",
        tokenProgram,
      );
      const mintInfo = await connection.getParsedAccountInfo(mint);
      const decimals =
        (mintInfo.value?.data &&
        typeof mintInfo.value.data === "object" &&
        "parsed" in mintInfo.value.data
          ? (mintInfo.value.data.parsed?.info?.decimals as number | undefined)
          : undefined) ?? 6;
      const delta = account.amount - balBefore;
      tokenAmount = Number(delta) / 10 ** decimals;
      if (tokenAmount <= 0) {
        tokenAmount = Number(account.amount) / 10 ** decimals;
      }
    } catch {
      // fall back to quote amount if ATA read races
    }

    if (tokenAmount <= 0) {
      return {
        ok: false,
        message:
          "Buy did not produce a token balance (likely slippage revert). No position opened.",
      };
    }

    const priceSol = solAmount / tokenAmount;
    return {
      ok: true,
      signature,
      solAmount,
      tokenAmount,
      priceSol,
      explorerUrl: explorer(signature),
      venue,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Live buy failed",
    };
  }
}

export async function liveSellAll(
  mintStr: string,
  slippage = DEFAULT_SLIPPAGE,
): Promise<LiveTradeResult> {
  const kp = getBotKeypair();
  if (!kp) return { ok: false, message: "Bot wallet secret not configured." };

  try {
    const mint = new PublicKey(mintStr);
    const connection = getConnection();
    const online = new OnlinePumpSdk(connection);
    const global = await online.fetchGlobal();
    const feeConfig = await online.fetchFeeConfig();
    const tokenProgram = await resolveTokenProgram(mint);
    const ata = getAssociatedTokenAddressSync(
      mint,
      kp.publicKey,
      false,
      tokenProgram,
    );

    let tokenAmountRaw: BN;
    let decimals = 6;
    try {
      const account = await getAccount(
        connection,
        ata,
        "confirmed",
        tokenProgram,
      );
      tokenAmountRaw = new BN(account.amount.toString());
      const mintInfo = await connection.getParsedAccountInfo(mint);
      decimals =
        (mintInfo.value?.data &&
        typeof mintInfo.value.data === "object" &&
        "parsed" in mintInfo.value.data
          ? (mintInfo.value.data.parsed?.info?.decimals as number | undefined)
          : undefined) ?? 6;
    } catch {
      return {
        ok: false,
        message: "No token balance to sell — clearing ghost position.",
        ghostPosition: true,
      };
    }

    if (tokenAmountRaw.isZero()) {
      return {
        ok: false,
        message: "Token balance is zero — clearing ghost position.",
        ghostPosition: true,
      };
    }

    const sellState = await online.fetchSellState(
      mint,
      kp.publicKey,
      tokenProgram,
    );

    const venue: SellVenue = sellState.bondingCurve.complete
      ? "pumpswap"
      : "bonding";

    const solBefore = await connection.getBalance(kp.publicKey, "confirmed");
    let ixs: TransactionInstruction[];
    let expectedSolOut = 0;

    if (venue === "pumpswap") {
      const ammOnline = new OnlinePumpAmmSdk(connection);
      const pool = canonicalPumpPoolPda(mint);
      const poolInfo = await connection.getAccountInfo(pool);
      if (!poolInfo) {
        return {
          ok: false,
          message:
            "Curve marked complete but PumpSwap pool not found yet — migration may still be pending. Retry shortly.",
        };
      }
      const swapState = await ammOnline.swapSolanaState(pool, kp.publicKey);
      // SDK slippage is percent (18 = 18%)
      ixs = await PUMP_AMM_SDK.sellBaseInput(
        swapState,
        tokenAmountRaw,
        slippage,
      );
    } else {
      const solOut = getSellSolAmountFromTokenAmount({
        global,
        feeConfig,
        mintSupply: sellState.bondingCurve.tokenTotalSupply,
        bondingCurve: sellState.bondingCurve,
        amount: tokenAmountRaw,
      });
      expectedSolOut = Number(solOut.toString()) / 1e9;
      try {
        ixs = await PUMP_SDK.sellV3Instructions({
          bondingCurve: sellState.bondingCurve,
          mint,
          user: kp.publicKey,
          amount: tokenAmountRaw,
          quoteAmount: solOut,
          slippage,
          tokenProgram,
          quoteTokenProgram: sellState.quoteTokenProgram,
        });
      } catch (e) {
        if (!(e instanceof CashbackCoinNotSupportedError)) throw e;
        ixs = await PUMP_SDK.sellInstructions({
          global,
          bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
          bondingCurve: sellState.bondingCurve,
          mint,
          user: kp.publicKey,
          amount: tokenAmountRaw,
          solAmount: solOut,
          slippage,
          tokenProgram,
          mayhemMode: Boolean(sellState.bondingCurve.isMayhemMode),
        });
      }
    }

    const signature = await sendIxs(ixs);
    const solAfter = await connection.getBalance(kp.publicKey, "confirmed");
    const solAmount =
      Math.max(0, (solAfter - solBefore) / 1e9) || expectedSolOut;
    const tokenAmount = Number(tokenAmountRaw.toString()) / 10 ** decimals;
    const priceSol = tokenAmount > 0 ? solAmount / tokenAmount : 0;
    return {
      ok: true,
      signature,
      solAmount,
      tokenAmount,
      priceSol,
      explorerUrl: explorer(signature),
      venue,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Live sell failed",
    };
  }
}

export async function fetchOnchainSolBalance() {
  const kp = getBotKeypair();
  if (!kp) return null;
  const lamports = await getConnection().getBalance(kp.publicKey, "confirmed");
  return lamports / 1e9;
}

/** Read wallet token balance for a mint without sending a tx. */
export async function fetchTokenBalanceUi(mintStr: string): Promise<number> {
  const kp = getBotKeypair();
  if (!kp) return 0;
  try {
    const mint = new PublicKey(mintStr);
    const connection = getConnection();
    const tokenProgram = await resolveTokenProgram(mint);
    const ata = getAssociatedTokenAddressSync(
      mint,
      kp.publicKey,
      false,
      tokenProgram,
    );
    const account = await getAccount(
      connection,
      ata,
      "confirmed",
      tokenProgram,
    );
    const mintInfo = await connection.getParsedAccountInfo(mint);
    const decimals =
      (mintInfo.value?.data &&
      typeof mintInfo.value.data === "object" &&
      "parsed" in mintInfo.value.data
        ? (mintInfo.value.data.parsed?.info?.decimals as number | undefined)
        : undefined) ?? 6;
    return Number(account.amount) / 10 ** decimals;
  } catch {
    return 0;
  }
}
