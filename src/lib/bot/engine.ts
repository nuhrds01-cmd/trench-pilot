import { randomUUID } from "crypto";
import { fetchLivePumpCandidates } from "@/lib/live/dex-scanner";
import {
  fetchOnchainSolBalance,
  fetchTokenBalanceUi,
  liveBuyExactSol,
  liveSellAll,
  resolveSellVenue,
} from "@/lib/live/pump-trade";
import { createInitialState, DEFAULT_SETTINGS } from "./defaults";
import { randomMint, randomTokenIdentity, randomWallet } from "./names";
import { scoreToken } from "./scoring";
import type {
  BotAction,
  BotEvent,
  BotState,
  CopyWallet,
  Position,
  ScannedToken,
  TokenStatus,
  Trade,
} from "./types";

type Listener = (state: BotState) => void;
type ActionResult = { ok: boolean; message: string };

const MAX_TOKENS = 40;
const MAX_EVENTS = 100;
const MAX_TRADES = 100;

class BotEngine {
  private state: BotState = createInitialState();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private started = false;
  private looping = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.ensureLoop();
  }

  ensureLoop() {
    if (this.timer) return;
    if (!this.state.running) return;
    this.timer = setInterval(() => {
      void this.loop();
    }, this.state.settings.scanIntervalMs);
  }

  stopLoop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): BotState {
    return structuredClone(this.state);
  }

  setTelegramConnected(connected: boolean) {
    this.state.telegramConnected = connected;
    this.emit();
  }

  async dispatch(action: BotAction): Promise<ActionResult> {
    switch (action.type) {
      case "start":
        this.state.running = true;
        this.pushEvent("info", "Engine started.");
        this.ensureLoop();
        this.emit();
        return { ok: true, message: "Engine started." };
      case "stop":
        this.state.running = false;
        this.stopLoop();
        this.pushEvent("info", "Engine paused.");
        this.emit();
        return { ok: true, message: "Engine paused." };
      case "buy":
        return this.buy(
          action.mint,
          action.solAmount,
          action.source ?? "manual",
        );
      case "sell":
        return this.sell(action.mint, action.reason ?? "manual");
      case "update_settings":
        return this.updateSettings(action.patch);
      case "add_copy_wallet":
        return this.addCopyWallet(action.address, action.label);
      case "remove_copy_wallet":
        return this.removeCopyWallet(action.address);
      case "toggle_copy_wallet":
        return this.toggleCopyWallet(action.address, action.enabled);
      case "reset_paper":
        return this.resetPaper();
      case "arm_live":
        return this.armLive();
      case "disarm_live":
        return this.disarmLive();
      case "sync_balance":
        return this.syncBalance();
      case "clear_ghosts":
        return this.clearGhosts();
      default:
        return { ok: false, message: "Unknown action." };
    }
  }

  /** Drop live positions that have zero on-chain token balance. */
  private async clearGhosts(): Promise<ActionResult> {
    if (this.state.settings.mode !== "live") {
      return { ok: false, message: "Ghost cleanup is for live mode." };
    }
    const kept: Position[] = [];
    let removed = 0;
    for (const pos of this.state.positions) {
      const bal = await fetchTokenBalanceUi(pos.mint);
      if (bal <= 0) {
        removed += 1;
        this.pushEvent(
          "info",
          `Cleared ghost ${pos.symbol} (0 tokens on-chain).`,
        );
        continue;
      }
      kept.push(pos);
    }
    this.state.positions = kept;
    this.state.lastError = null;
    this.emit();
    return {
      ok: true,
      message:
        removed > 0
          ? `Cleared ${removed} ghost position(s).`
          : "No ghost positions found.",
    };
  }

  private async armLive(): Promise<ActionResult> {
    const bal = await fetchOnchainSolBalance();
    if (bal == null) {
      return {
        ok: false,
        message: "Bot wallet not configured. Run npm run wallet:create.",
      };
    }
    if (bal < this.state.settings.reserveSol + 0.01) {
      return {
        ok: false,
        message: `Need more SOL on-chain. Balance ${bal.toFixed(4)} SOL; deposit first (keep ≥${this.state.settings.reserveSol} SOL reserve).`,
      };
    }
    this.state.settings.mode = "live";
    this.state.settings.liveArmed = true;
    this.state.settings.autoScanBuy = true;
    // Never enable simulated copy-trade against real SOL
    this.state.settings.copyTradeEnabled = false;
    this.state.settings.maxOpenPositions = Math.max(
      this.state.settings.maxOpenPositions,
      3,
    );
    this.state.balanceSol = bal;
    this.state.lastError = null;
    this.pushEvent(
      "info",
      `LIVE ARMED · on-chain ${bal.toFixed(4)} SOL · auto-buy ON · max ${this.state.settings.maxOpenPositions} bags · max buy ${this.state.settings.maxLiveBuySol} SOL · simulated copy stays OFF`,
    );
    this.emit();
    void this.refreshLiveScanner();
    return {
      ok: true,
      message: `Live armed with ${bal.toFixed(4)} SOL. Auto-buy on (paper-style), max ${this.state.settings.maxOpenPositions} positions.`,
    };
  }

  private disarmLive(): ActionResult {
    this.state.settings.liveArmed = false;
    this.state.settings.mode = "paper";
    this.state.balanceSol = this.state.settings.paperBalanceSol;
    this.state.positions = [];
    this.pushEvent("info", "Live disarmed — back to paper mode.");
    this.emit();
    return { ok: true, message: "Back to paper mode." };
  }

  private async syncBalance(): Promise<ActionResult> {
    if (this.state.settings.mode !== "live") {
      return { ok: false, message: "Balance sync is for live mode." };
    }
    const bal = await fetchOnchainSolBalance();
    if (bal == null) return { ok: false, message: "Wallet not configured." };
    this.state.balanceSol = bal;
    this.emit();
    return { ok: true, message: `Synced balance: ${bal.toFixed(4)} SOL` };
  }

  private updateSettings(patch: Partial<BotState["settings"]>): ActionResult {
    const prevInterval = this.state.settings.scanIntervalMs;
    // Never silently arm live via patch
    if (patch.liveArmed && !this.state.settings.liveArmed) {
      delete patch.liveArmed;
    }
    if (patch.mode === "live" && !this.state.settings.liveArmed) {
      delete patch.mode;
    }
    this.state.settings = { ...this.state.settings, ...patch };
    if (patch.paperBalanceSol != null && this.state.settings.mode === "paper") {
      if (this.state.positions.length === 0 && this.state.trades.length === 0) {
        this.state.balanceSol = this.state.settings.paperBalanceSol;
      }
    }
    if (
      patch.scanIntervalMs &&
      patch.scanIntervalMs !== prevInterval &&
      this.state.running
    ) {
      this.stopLoop();
      this.ensureLoop();
    }
    this.pushEvent("info", "Settings updated.");
    this.emit();
    return { ok: true, message: "Settings updated." };
  }

  private resetPaper(): ActionResult {
    if (this.state.settings.mode === "live" && this.state.settings.liveArmed) {
      return {
        ok: false,
        message: "Disarm live before resetting the paper account.",
      };
    }
    const copyWallets = this.state.copyWallets;
    const telegramConnected = this.state.telegramConnected;
    this.state = createInitialState();
    this.state.copyWallets = copyWallets;
    this.state.telegramConnected = telegramConnected;
    this.pushEvent("info", "Paper account reset.");
    this.stopLoop();
    if (this.state.running) this.ensureLoop();
    this.emit();
    return { ok: true, message: "Paper account reset." };
  }

  private addCopyWallet(address: string, label?: string): ActionResult {
    const trimmed = address.trim();
    if (trimmed.length < 32) {
      return { ok: false, message: "Wallet address looks too short." };
    }
    if (this.state.copyWallets.some((w) => w.address === trimmed)) {
      return { ok: false, message: "Wallet already on the copy list." };
    }
    const wallet: CopyWallet = {
      address: trimmed,
      label: label?.trim() || `Whale ${this.state.copyWallets.length + 1}`,
      enabled: true,
      addedAt: Date.now(),
      mirroredBuys: 0,
      mirroredSells: 0,
    };
    this.state.copyWallets.unshift(wallet);
    this.pushEvent("info", `Copying ${wallet.label} (${short(trimmed)}).`);
    this.emit();
    return { ok: true, message: `Added ${wallet.label}.` };
  }

  private removeCopyWallet(address: string): ActionResult {
    const before = this.state.copyWallets.length;
    this.state.copyWallets = this.state.copyWallets.filter(
      (w) => w.address !== address,
    );
    if (this.state.copyWallets.length === before) {
      return { ok: false, message: "Wallet not found." };
    }
    this.pushEvent("info", `Stopped copying ${short(address)}.`);
    this.emit();
    return { ok: true, message: "Removed wallet." };
  }

  private toggleCopyWallet(address: string, enabled: boolean): ActionResult {
    const wallet = this.state.copyWallets.find((w) => w.address === address);
    if (!wallet) return { ok: false, message: "Wallet not found." };
    wallet.enabled = enabled;
    this.emit();
    return { ok: true, message: enabled ? "Wallet enabled." : "Wallet paused." };
  }

  private async loop() {
    if (!this.state.running || this.looping) return;
    this.looping = true;
    try {
      this.tick += 1;
      if (this.state.settings.mode === "live" && this.state.settings.liveArmed) {
        await this.refreshLiveScanner();
        const bal = await fetchOnchainSolBalance();
        if (bal != null) this.state.balanceSol = bal;
        // Simulated copy-trade is disabled in live (would spend real SOL on fake signals)
        await this.autoManagePositions();
        await this.maybeAutoBuy();
      } else {
        this.evolveMarkets();
        this.spawnLaunch();
        void this.maybeCopyTrade();
        void this.autoManagePositions();
        void this.maybeAutoBuy();
      }
      this.state.lastScanAt = Date.now();
      this.emit();
    } finally {
      this.looping = false;
    }
  }

  private async refreshLiveScanner() {
    try {
      const live = await fetchLivePumpCandidates(20);
      if (live.length) {
        // Keep held tokens visible even if they drop off the feed
        const held = this.state.positions.map((p) => p.mint);
        const prevByMint = new Map(this.state.tokens.map((t) => [t.mint, t]));
        const byMint = new Map<string, ScannedToken>();

        for (const t of live) {
          const prev = prevByMint.get(t.mint);
          // Paper-like freshness: clock starts when WE first see the mint
          const createdAt = prev?.createdAt ?? Date.now();
          byMint.set(t.mint, { ...t, createdAt });
        }
        for (const t of this.state.tokens) {
          if (held.includes(t.mint) && !byMint.has(t.mint)) byMint.set(t.mint, t);
        }
        this.state.tokens = [...byMint.values()]
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_TOKENS);
        this.pushEvent(
          "scan",
          `Live feed refreshed · ${live.length} pump candidates`,
        );
      }
    } catch (e) {
      this.pushEvent(
        "error",
        `Live scanner error: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }

  private spawnLaunch() {
    if (this.tick % 2 !== 0) return;
    const seed = Date.now() + this.tick * 17;
    const { name, symbol } = randomTokenIdentity(seed);
    const mint = randomMint(seed);
    const base = {
      id: randomUUID(),
      mint,
      name,
      symbol,
      createdAt: Date.now(),
      marketCapUsd: 4_000 + rand(0, 45_000),
      liquiditySol: 2 + rand(0, 28),
      bondingProgress: rand(1, 42),
      holders: Math.floor(8 + rand(0, 160)),
      uniqueBuyers1m: Math.floor(2 + rand(0, 55)),
      volume1mSol: rand(0.2, 40),
      devHoldingPct: rand(0, 28),
      sniperPct: rand(0, 35),
      hasTwitter: Math.random() > 0.45,
      hasTelegram: Math.random() > 0.55,
      hasWebsite: Math.random() > 0.7,
      status: "bonding" as const,
      priceSol: 0.00000001 * (1 + rand(0, 40)),
      change1mPct: rand(-20, 120),
    };
    const { score, scoreBreakdown } = scoreToken(base);
    const token: ScannedToken = { ...base, score, scoreBreakdown };
    this.state.tokens = [token, ...this.state.tokens].slice(0, MAX_TOKENS);
    this.pushEvent(
      "scan",
      `New launch ${symbol} · score ${score.toFixed(0)} · MC $${Math.round(token.marketCapUsd).toLocaleString()}`,
    );
  }

  private evolveMarkets() {
    this.state.tokens = this.state.tokens.map((t) => {
      const drift = rand(-8, 14);
      const change1mPct = clamp(t.change1mPct * 0.7 + drift, -60, 220);
      const priceSol = Math.max(1e-12, t.priceSol * (1 + change1mPct / 400));
      const bondingProgress = clamp(
        t.bondingProgress + rand(-0.4, 2.2),
        0,
        100,
      );
      const status: TokenStatus =
        bondingProgress >= 100
          ? "migrated"
          : bondingProgress >= 85
            ? "graduating"
            : "bonding";
      const next: Omit<ScannedToken, "score" | "scoreBreakdown"> = {
        ...t,
        change1mPct,
        priceSol,
        bondingProgress,
        status,
        marketCapUsd: Math.max(500, t.marketCapUsd * (1 + change1mPct / 500)),
        volume1mSol: Math.max(0.05, t.volume1mSol * (0.85 + Math.random() * 0.4)),
        uniqueBuyers1m: Math.max(
          1,
          Math.floor(t.uniqueBuyers1m * (0.8 + Math.random() * 0.5)),
        ),
        holders: t.holders + (Math.random() > 0.6 ? 1 : 0),
      };
      const { score, scoreBreakdown } = scoreToken(next);
      return { ...next, score, scoreBreakdown };
    });
  }

  private async maybeCopyTrade() {
    if (this.state.settings.mode === "live") return;
    if (!this.state.settings.copyTradeEnabled) return;
    const active = this.state.copyWallets.filter((w) => w.enabled);
    if (!active.length || !this.state.tokens.length) return;
    if (Math.random() > 0.35) return;

    const wallet = active[Math.floor(Math.random() * active.length)];
    const token =
      this.state.tokens[
        Math.floor(Math.random() * Math.min(8, this.state.tokens.length))
      ];
    const side: "buy" | "sell" = Math.random() > 0.35 ? "buy" : "sell";
    wallet.lastSeenAt = Date.now();

    if (side === "buy") {
      const leadSol = rand(0.05, 1.8);
      const size = Math.min(
        this.state.settings.copyMaxSol,
        leadSol * this.state.settings.copySizeMultiplier,
      );
      this.pushEvent(
        "copy_signal",
        `${wallet.label} bought ${token.symbol} (~${leadSol.toFixed(2)} SOL)`,
      );
      const result = await this.buy(token.mint, size, "copy", wallet.address);
      if (result.ok) wallet.mirroredBuys += 1;
      return;
    }

    const pos = this.state.positions.find(
      (p) => p.mint === token.mint && p.copyWallet === wallet.address,
    );
    if (!pos || !this.state.settings.mirrorSells) {
      this.pushEvent(
        "copy_signal",
        `${wallet.label} sold ${token.symbol} (no mirrored position)`,
      );
      return;
    }
    const result = await this.sell(token.mint, "copy");
    if (result.ok) wallet.mirroredSells += 1;
  }

  private async maybeAutoBuy() {
    if (!this.state.settings.autoScanBuy) return;
    if (this.state.busy) return;
    if (this.state.positions.length >= this.state.settings.maxOpenPositions) return;

    const windowMs = this.state.settings.autoBuyMaxAgeMs ?? 20_000;
    const candidates = this.state.tokens
      .filter((t) => t.createdAt > Date.now() - windowMs)
      // Bonding curve or graduated PumpSwap — both are buyable in live
      .filter((t) => t.status === "bonding" || t.status === "migrated")
      .filter((t) => t.score >= this.state.settings.minScoreToBuy)
      .filter((t) => !this.state.positions.some((p) => p.mint === t.mint))
      // Live path only spends SOL — skip WIF/USDC/pump-quoted curves
      .filter(
        (t) => this.state.settings.mode !== "live" || t.solQuoted === true,
      )
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best) return;
    if (this.state.settings.mode === "paper" && Math.random() > 0.55) {
      this.pushEvent(
        "auto_skip",
        `Watching ${best.symbol} (score ${best.score.toFixed(0)}) — waiting for cleaner entry`,
      );
      return;
    }
    await this.buy(best.mint, this.state.settings.buySizeSol, "scanner");
  }

  private async autoManagePositions() {
    if (this.state.busy) return;
    for (const pos of [...this.state.positions]) {
      // Refresh venue/status for open bags (bonding vs PumpSwap)
      if (this.state.settings.mode === "live" && this.state.settings.liveArmed) {
        try {
          const venue = await resolveSellVenue(pos.mint);
          const scanned = this.state.tokens.find((t) => t.mint === pos.mint);
          if (scanned) {
            if (venue === "pumpswap") {
              scanned.status = "migrated";
              scanned.bondingProgress = 100;
            } else if (scanned.status === "migrated") {
              scanned.status = "bonding";
            }
          }
        } catch {
          // ignore RPC blips; sell path will re-check
        }
      }

      const token = this.state.tokens.find((t) => t.mint === pos.mint);
      if (!token || token.priceSol <= 0 || pos.entryPriceSol <= 0) continue;
      const pnlPct =
        ((token.priceSol - pos.entryPriceSol) / pos.entryPriceSol) * 100;
      pos.peakPnlPct = Math.max(pos.peakPnlPct, pnlPct);

      if (pnlPct >= this.state.settings.takeProfitPct) {
        await this.sell(pos.mint, "tp");
        continue;
      }
      if (pnlPct <= -this.state.settings.stopLossPct) {
        await this.sell(pos.mint, "sl");
        continue;
      }
      if (
        pos.peakPnlPct >= this.state.settings.trailingStopPct &&
        pnlPct <= pos.peakPnlPct - this.state.settings.trailingStopPct
      ) {
        await this.sell(pos.mint, "tp");
      }
    }
  }

  private async buy(
    mint: string,
    solAmount?: number,
    source: Position["source"] = "manual",
    copyWallet?: string,
  ): Promise<ActionResult> {
    if (this.state.busy) {
      return { ok: false, message: "Bot is busy with another trade." };
    }

    let token = this.state.tokens.find((t) => t.mint === mint);
    if (!token && this.state.settings.mode === "live") {
      // Allow buying a mint pasted manually by synthesizing a stub row
      token = {
        id: mint,
        mint,
        name: short(mint),
        symbol: mint.slice(0, 4).toUpperCase(),
        createdAt: Date.now(),
        marketCapUsd: 0,
        liquiditySol: 0,
        bondingProgress: 50,
        holders: 0,
        uniqueBuyers1m: 0,
        volume1mSol: 0,
        devHoldingPct: 0,
        sniperPct: 0,
        hasTwitter: false,
        hasTelegram: false,
        hasWebsite: false,
        status: "bonding",
        score: this.state.settings.minScoreToBuy,
        scoreBreakdown: {
          momentum: 0,
          social: 0,
          holderQuality: 0,
          risk: 0,
          curve: 0,
        },
        priceSol: 0,
        change1mPct: 0,
      };
      this.state.tokens.unshift(token);
    }
    if (!token) return { ok: false, message: "Token not found in scanner." };
    if (this.state.positions.some((p) => p.mint === mint)) {
      return { ok: false, message: `Already holding ${token.symbol}.` };
    }
    if (this.state.positions.length >= this.state.settings.maxOpenPositions) {
      return { ok: false, message: "Max open positions reached." };
    }

    let amount = solAmount ?? this.state.settings.buySizeSol;
    if (amount <= 0) return { ok: false, message: "Buy size must be positive." };

    if (this.state.settings.mode === "live") {
      if (!this.state.settings.liveArmed) {
        return { ok: false, message: "Live mode not armed. Click Go Live first." };
      }
      amount = Math.min(amount, this.state.settings.maxLiveBuySol);
      const bal = (await fetchOnchainSolBalance()) ?? 0;
      this.state.balanceSol = bal;
      const spendable = bal - this.state.settings.reserveSol;
      if (amount > spendable) {
        return {
          ok: false,
          message: `Need ${amount.toFixed(3)} SOL + ${this.state.settings.reserveSol} reserve. Spendable ${Math.max(0, spendable).toFixed(4)} SOL.`,
        };
      }

      this.state.busy = true;
      this.emit();
      const result = await liveBuyExactSol(
        mint,
        amount,
        this.state.settings.slippagePct,
      );
      this.state.busy = false;
      if (!result.ok) {
        this.state.lastError = result.message;
        this.pushEvent("error", `Live buy failed: ${result.message}`);
        this.emit();
        return result;
      }

      const position: Position = {
        id: randomUUID(),
        mint: token.mint,
        name: token.name,
        symbol: token.symbol,
        entryPriceSol: result.priceSol || token.priceSol,
        amountTokens: result.tokenAmount,
        costSol: result.solAmount,
        openedAt: Date.now(),
        source,
        copyWallet,
        peakPnlPct: 0,
        txSignature: result.signature,
      };
      this.state.positions.unshift(position);
      const trade: Trade = {
        id: randomUUID(),
        mint: token.mint,
        name: token.name,
        symbol: token.symbol,
        side: "buy",
        solAmount: result.solAmount,
        tokenAmount: result.tokenAmount,
        priceSol: result.priceSol,
        at: Date.now(),
        source,
        note: `LIVE ${result.signature.slice(0, 8)}…`,
        txSignature: result.signature,
        explorerUrl: result.explorerUrl,
      };
      this.state.trades.unshift(trade);
      this.state.trades = this.state.trades.slice(0, MAX_TRADES);
      this.state.balanceSol = (await fetchOnchainSolBalance()) ?? this.state.balanceSol;
      this.state.lastError = null;
      const venueLabel =
        result.venue === "pumpswap" ? "PumpSwap DEX" : "bonding curve";
      if (result.venue === "pumpswap") {
        token.status = "migrated";
        token.bondingProgress = 100;
      }
      this.pushEvent(
        "buy",
        `LIVE bought ${token.symbol} on ${venueLabel} for ${result.solAmount.toFixed(3)} SOL · ${result.explorerUrl}`,
      );
      this.emit();
      return {
        ok: true,
        message: `Live bought ${token.symbol} on ${venueLabel}.`,
      };
    }

    // Paper path
    if (amount > this.state.balanceSol) {
      return { ok: false, message: "Insufficient paper balance." };
    }
    const tokenAmount =
      token.priceSol > 0 ? amount / token.priceSol : amount * 1e6;
    this.state.balanceSol -= amount;
    const position: Position = {
      id: randomUUID(),
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      entryPriceSol: token.priceSol || 1e-9,
      amountTokens: tokenAmount,
      costSol: amount,
      openedAt: Date.now(),
      source,
      copyWallet,
      peakPnlPct: 0,
    };
    this.state.positions.unshift(position);
    const trade: Trade = {
      id: randomUUID(),
      mint: token.mint,
      name: token.name,
      symbol: token.symbol,
      side: "buy",
      solAmount: amount,
      tokenAmount,
      priceSol: token.priceSol,
      at: Date.now(),
      source,
      note: copyWallet ? `mirrored ${short(copyWallet)}` : undefined,
    };
    this.state.trades.unshift(trade);
    this.state.trades = this.state.trades.slice(0, MAX_TRADES);
    this.pushEvent(
      "buy",
      `Bought ${token.symbol} for ${amount.toFixed(3)} SOL (${source})`,
    );
    this.emit();
    return { ok: true, message: `Bought ${token.symbol}.` };
  }

  private async sell(
    mint: string,
    reason: Trade["source"] = "manual",
  ): Promise<ActionResult> {
    if (this.state.busy) {
      return { ok: false, message: "Bot is busy with another trade." };
    }
    const idx = this.state.positions.findIndex((p) => p.mint === mint);
    if (idx < 0) return { ok: false, message: "No open position for that mint." };
    const pos = this.state.positions[idx];

    if (this.state.settings.mode === "live") {
      if (!this.state.settings.liveArmed) {
        return { ok: false, message: "Live mode not armed." };
      }
      this.state.busy = true;
      this.emit();
      const result = await liveSellAll(mint, this.state.settings.slippagePct);
      this.state.busy = false;
      if (!result.ok) {
        if (result.ghostPosition) {
          this.state.positions.splice(idx, 1);
          this.state.lastError = null;
          this.pushEvent(
            "info",
            `Cleared ghost position ${pos.symbol} (no tokens on-chain — buy likely slipped).`,
          );
          this.emit();
          return {
            ok: true,
            message: `Cleared ghost ${pos.symbol} position (wallet had 0 tokens).`,
          };
        }
        this.state.lastError = result.message;
        this.pushEvent("error", `Live sell failed: ${result.message}`);
        this.emit();
        return result;
      }
      const pnlSol = result.solAmount - pos.costSol;
      const pnlPct = pos.costSol > 0 ? (pnlSol / pos.costSol) * 100 : 0;
      this.state.realizedPnlSol += pnlSol;
      this.state.positions.splice(idx, 1);
      const trade: Trade = {
        id: randomUUID(),
        mint: pos.mint,
        name: pos.name,
        symbol: pos.symbol,
        side: "sell",
        solAmount: result.solAmount,
        tokenAmount: result.tokenAmount,
        priceSol: result.priceSol,
        pnlSol,
        pnlPct,
        at: Date.now(),
        source: reason,
        txSignature: result.signature,
        explorerUrl: result.explorerUrl,
        note: `LIVE ${result.venue ?? "bonding"} ${result.signature.slice(0, 8)}…`,
      };
      this.state.trades.unshift(trade);
      this.state.trades = this.state.trades.slice(0, MAX_TRADES);
      this.state.balanceSol =
        (await fetchOnchainSolBalance()) ?? this.state.balanceSol;
      this.state.lastError = null;
      const venueLabel =
        result.venue === "pumpswap" ? "PumpSwap DEX" : "bonding curve";
      // Keep scanner row status in sync with where it trades
      const scanned = this.state.tokens.find((t) => t.mint === mint);
      if (scanned && result.venue === "pumpswap") {
        scanned.status = "migrated";
        scanned.bondingProgress = 100;
      }
      this.pushEvent(
        "sell",
        `LIVE sold ${pos.symbol} on ${venueLabel} · ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% · ${result.explorerUrl}`,
      );
      this.emit();
      return {
        ok: true,
        message: `Live sold ${pos.symbol} on ${venueLabel} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%).`,
      };
    }

    const token = this.state.tokens.find((t) => t.mint === mint);
    const price = token?.priceSol ?? pos.entryPriceSol;
    const proceeds = pos.amountTokens * price;
    const pnlSol = proceeds - pos.costSol;
    const pnlPct = (pnlSol / pos.costSol) * 100;
    this.state.balanceSol += proceeds;
    this.state.realizedPnlSol += pnlSol;
    this.state.positions.splice(idx, 1);
    const trade: Trade = {
      id: randomUUID(),
      mint: pos.mint,
      name: pos.name,
      symbol: pos.symbol,
      side: "sell",
      solAmount: proceeds,
      tokenAmount: pos.amountTokens,
      priceSol: price,
      pnlSol,
      pnlPct,
      at: Date.now(),
      source: reason,
    };
    this.state.trades.unshift(trade);
    this.state.trades = this.state.trades.slice(0, MAX_TRADES);
    this.pushEvent(
      "sell",
      `Sold ${pos.symbol} · ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% (${reason})`,
    );
    this.emit();
    return {
      ok: true,
      message: `Sold ${pos.symbol} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%).`,
    };
  }

  private pushEvent(type: BotEvent["type"], message: string) {
    this.state.events.unshift({
      id: randomUUID(),
      at: Date.now(),
      type,
      message,
    });
    this.state.events = this.state.events.slice(0, MAX_EVENTS);
  }

  private emit() {
    const snap = this.getState();
    for (const listener of this.listeners) listener(snap);
  }
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const globalForBot = globalThis as unknown as { __trenchPilot?: BotEngine };

export function getBotEngine() {
  if (!globalForBot.__trenchPilot) {
    globalForBot.__trenchPilot = new BotEngine();
    const engine = globalForBot.__trenchPilot;
    void engine.dispatch({
      type: "add_copy_wallet",
      address: randomWallet(42),
      label: "FastHands",
    });
    void engine.dispatch({
      type: "add_copy_wallet",
      address: randomWallet(77),
      label: "CurveSniper",
    });
    engine.start();
  }
  return globalForBot.__trenchPilot;
}
