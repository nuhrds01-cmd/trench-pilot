export type BotMode = "paper" | "live";

export type TokenStatus = "bonding" | "graduating" | "migrated";

export interface ScannedToken {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  createdAt: number;
  marketCapUsd: number;
  liquiditySol: number;
  bondingProgress: number;
  holders: number;
  uniqueBuyers1m: number;
  volume1mSol: number;
  devHoldingPct: number;
  sniperPct: number;
  hasTwitter: boolean;
  hasTelegram: boolean;
  hasWebsite: boolean;
  status: TokenStatus;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  priceSol: number;
  change1mPct: number;
  /** Live feed: true when curve/pair is SOL-quoted (required for live buys). */
  solQuoted?: boolean;
}

export interface ScoreBreakdown {
  momentum: number;
  social: number;
  holderQuality: number;
  risk: number;
  curve: number;
}

export interface Position {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  entryPriceSol: number;
  amountTokens: number;
  costSol: number;
  openedAt: number;
  source: "scanner" | "copy" | "manual";
  copyWallet?: string;
  peakPnlPct: number;
  txSignature?: string;
}

export interface Trade {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  priceSol: number;
  pnlSol?: number;
  pnlPct?: number;
  at: number;
  source: "scanner" | "copy" | "manual" | "tp" | "sl";
  note?: string;
  txSignature?: string;
  explorerUrl?: string;
}

export interface CopyWallet {
  address: string;
  label: string;
  enabled: boolean;
  addedAt: number;
  mirroredBuys: number;
  mirroredSells: number;
  lastSeenAt?: number;
}

export interface BotSettings {
  mode: BotMode;
  /** Must be true (via Go Live) before live buys/sells execute on-chain. */
  liveArmed: boolean;
  paperBalanceSol: number;
  buySizeSol: number;
  maxOpenPositions: number;
  minScoreToBuy: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct: number;
  copySizeMultiplier: number;
  copyMaxSol: number;
  autoScanBuy: boolean;
  copyTradeEnabled: boolean;
  mirrorSells: boolean;
  telegramNotifyTrades: boolean;
  scanIntervalMs: number;
  /** Keep this much SOL for fees / rent; never spend below it in live. */
  reserveSol: number;
  /** Hard cap per live buy (also clamped by buySizeSol). */
  maxLiveBuySol: number;
  slippagePct: number;
  /** Only auto-buy tokens first seen within this many ms (paper default: 20s). */
  autoBuyMaxAgeMs: number;
}

export interface BotEvent {
  id: string;
  at: number;
  type:
    | "scan"
    | "buy"
    | "sell"
    | "copy_signal"
    | "auto_skip"
    | "info"
    | "error"
    | "telegram";
  message: string;
}

export interface BotState {
  settings: BotSettings;
  balanceSol: number;
  realizedPnlSol: number;
  tokens: ScannedToken[];
  positions: Position[];
  trades: Trade[];
  copyWallets: CopyWallet[];
  events: BotEvent[];
  running: boolean;
  lastScanAt: number | null;
  telegramConnected: boolean;
  busy: boolean;
  lastError: string | null;
}

export type BotAction =
  | { type: "start" }
  | { type: "stop" }
  | { type: "buy"; mint: string; solAmount?: number; source?: Position["source"] }
  | { type: "sell"; mint: string; reason?: Trade["source"] }
  | { type: "update_settings"; patch: Partial<BotSettings> }
  | { type: "add_copy_wallet"; address: string; label?: string }
  | { type: "remove_copy_wallet"; address: string }
  | { type: "toggle_copy_wallet"; address: string; enabled: boolean }
  | { type: "reset_paper" }
  | { type: "arm_live" }
  | { type: "disarm_live" }
  | { type: "sync_balance" }
  | { type: "clear_ghosts" };
