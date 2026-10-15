import { scoreToken } from "@/lib/bot/scoring";
import type { ScannedToken } from "@/lib/bot/types";

type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  priceUsd?: string;
  priceNative?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { m5?: number; h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h24?: number };
  txns?: { m5?: { buys?: number; sells?: number }; h1?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  info?: {
    socials?: { type?: string; url?: string }[];
    websites?: { url?: string }[];
  };
};

const WSOL = "So11111111111111111111111111111111111111112";

function isSolQuote(pair: DexPair) {
  const q = pair.quoteToken?.address;
  if (!q) return false;
  return q === WSOL || q === "11111111111111111111111111111111";
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Pull recent Solana tokens that look like pump.fun mints, enrich via DexScreener. */
export async function fetchLivePumpCandidates(limit = 24): Promise<ScannedToken[]> {
  const profiles =
    (await fetchJson<
      { chainId?: string; tokenAddress?: string; description?: string; links?: { type?: string; url?: string }[] }[]
    >("https://api.dexscreener.com/token-profiles/latest/v1")) ?? [];

  const boosts =
    (await fetchJson<{ chainId?: string; tokenAddress?: string }[]>(
      "https://api.dexscreener.com/token-boosts/latest/v1",
    )) ?? [];

  const mintSet = new Set<string>();
  for (const row of [...profiles, ...boosts]) {
    if (row.chainId !== "solana") continue;
    const mint = row.tokenAddress;
    if (!mint || !mint.toLowerCase().endsWith("pump")) continue;
    mintSet.add(mint);
  }

  const mints = [...mintSet].slice(0, 18);
  const tokens: ScannedToken[] = [];

  await Promise.all(
    mints.map(async (mint) => {
      const data = await fetchJson<{ pairs?: DexPair[] }>(
        `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      );
      const pairs = (data?.pairs ?? []).filter(
        (p) => p.chainId === "solana" && (p.dexId === "pumpfun" || p.dexId === "pumpswap"),
      );
      // Prefer SOL-quoted pumpfun, then SOL PumpSwap (graduated)
      const pair =
        pairs.find((p) => p.dexId === "pumpfun" && isSolQuote(p)) ??
        pairs.find((p) => p.dexId === "pumpswap" && isSolQuote(p)) ??
        pairs.find((p) => p.dexId === "pumpfun") ??
        pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (!pair?.baseToken?.address) return;
      const solQuoted = isSolQuote(pair);
      // Skip non-SOL pairs — bot only spends SOL
      if (!solQuoted) return;

      const priceUsd = Number(pair.priceUsd ?? 0);
      const priceNative = Number(pair.priceNative ?? 0);
      const mcap = pair.marketCap ?? pair.fdv ?? 0;
      const buys = pair.txns?.m5?.buys ?? pair.txns?.h1?.buys ?? 0;
      const volUsd = pair.volume?.m5 ?? pair.volume?.h1 ?? 0;
      // rough SOL volume using native price if present
      const volume1mSol = priceNative > 0 ? volUsd / Math.max(priceUsd / priceNative, 1e-12) / 12 : volUsd / 150 / 12;
      const liqSol = (pair.liquidity?.quote ?? 0) || (pair.liquidity?.usd ?? 0) / 105;
      const createdAt = pair.pairCreatedAt ?? Date.now();
      const bondingProgress =
        pair.dexId === "pumpswap" ? 100 : Math.min(99, Math.max(1, (mcap / 69_000) * 100));

      const socials = pair.info?.socials ?? [];
      const hasTwitter = socials.some((s) => s.type === "twitter");
      const hasTelegram = socials.some((s) => s.type === "telegram");
      const hasWebsite = (pair.info?.websites?.length ?? 0) > 0;

      const base = {
        id: mint,
        mint,
        name: pair.baseToken.name || pair.baseToken.symbol || "Unknown",
        symbol: pair.baseToken.symbol || mint.slice(0, 6),
        createdAt,
        marketCapUsd: mcap,
        liquiditySol: liqSol,
        bondingProgress,
        holders: Math.max(buys * 3, 10),
        uniqueBuyers1m: buys,
        volume1mSol: Math.max(0.01, volume1mSol),
        devHoldingPct: 12,
        sniperPct: 15,
        hasTwitter,
        hasTelegram,
        hasWebsite,
        status:
          bondingProgress >= 100
            ? ("migrated" as const)
            : bondingProgress >= 85
              ? ("graduating" as const)
              : ("bonding" as const),
        priceSol: priceNative > 0 ? priceNative : priceUsd / 105,
        change1mPct: pair.priceChange?.m5 ?? pair.priceChange?.h1 ?? 0,
        solQuoted,
      };

      const { score, scoreBreakdown } = scoreToken(base);
      tokens.push({ ...base, score, scoreBreakdown });
    }),
  );

  tokens.sort((a, b) => b.score - a.score);
  return tokens.slice(0, limit);
}
