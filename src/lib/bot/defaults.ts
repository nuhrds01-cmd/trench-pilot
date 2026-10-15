import type { BotSettings, BotState } from "./types";

/**
 * Tuned for a ~$45 starter bankroll (~0.43 SOL at ~$105/SOL).
 * Live mode stays disarmed until the user explicitly arms it.
 */
export const DEFAULT_SETTINGS: BotSettings = {
  mode: "paper",
  liveArmed: false,
  paperBalanceSol: 0.43,
  buySizeSol: 0.03,
  maxOpenPositions: 3,
  minScoreToBuy: 78,
  takeProfitPct: 45,
  stopLossPct: 15,
  trailingStopPct: 18,
  copySizeMultiplier: 0.4,
  copyMaxSol: 0.04,
  autoScanBuy: true,
  // Simulated whale mirrors stay off in live (see engine); paper can enable.
  copyTradeEnabled: true,
  mirrorSells: true,
  telegramNotifyTrades: true,
  scanIntervalMs: 5000,
  reserveSol: 0.02,
  maxLiveBuySol: 0.08,
  slippagePct: 18,
  autoBuyMaxAgeMs: 20_000,
};

export function createInitialState(): BotState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    balanceSol: DEFAULT_SETTINGS.paperBalanceSol,
    realizedPnlSol: 0,
    tokens: [],
    positions: [],
    trades: [],
    copyWallets: [],
    events: [
      {
        id: "boot",
        at: Date.now(),
        type: "info",
        message:
          "TrenchPilot booted · ~$45 profile. Auto-buy/copy off until you arm live or enable them.",
      },
    ],
    running: true,
    lastScanAt: null,
    telegramConnected: false,
    busy: false,
    lastError: null,
  };
}
