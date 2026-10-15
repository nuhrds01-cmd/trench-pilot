"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  Copy,
  Pause,
  Play,
  Radar,
  Send,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WalletVault } from "@/components/dashboard/wallet-vault";
import { useBotState } from "@/hooks/use-bot-state";
import {
  cn,
  formatPct,
  formatSol,
  formatUsd,
  shortAddress,
} from "@/lib/utils";

export function TrenchDashboard() {
  const { state, error, pending, dispatch } = useBotState();
  const [walletInput, setWalletInput] = useState("");
  const [walletLabel, setWalletLabel] = useState("");
  const [onchainBalance, setOnchainBalance] = useState<number | null>(null);

  const live = Boolean(state?.settings.liveArmed && state.settings.mode === "live");

  useEffect(() => {
    if (!live) {
      setOnchainBalance(null);
      return;
    }

    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/wallet", { cache: "no-store" });
        const data = (await res.json()) as { balanceSol: number | null };
        if (!cancelled && data.balanceSol != null) {
          setOnchainBalance(data.balanceSol);
        }
        // Keep engine balance aligned with the vault (fire-and-forget)
        await fetch("/api/bot/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "sync_balance" }),
        });
      } catch {
        // keep last known
      }
    }

    void pull();
    const id = setInterval(() => void pull(), 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live]);

  const displayBalance = live
    ? (onchainBalance ?? state?.balanceSol ?? 0)
    : (state?.balanceSol ?? 0);

  const unrealized = useMemo(() => {
    if (!state) return 0;
    return state.positions.reduce((acc, p) => {
      const t = state.tokens.find((x) => x.mint === p.mint);
      if (!t) return acc;
      return acc + (p.amountTokens * t.priceSol - p.costSol);
    }, 0);
  }, [state]);

  const ranked = useMemo(() => {
    if (!state) return [];
    return [...state.tokens].sort((a, b) => b.score - a.score);
  }, [state]);

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--void)] text-[var(--foam)]">
        <div className="animate-pulse font-mono text-sm tracking-wide text-[var(--acid)]">
          Booting scanner…
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--void)] text-[var(--foam)]">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full bg-[var(--acid)]/10 blur-3xl animate-drift" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl animate-drift-slow" />

      <header className="relative border-b border-[var(--line)]/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="font-display text-4xl font-bold tracking-tight text-[var(--acid)] sm:text-5xl">
              TrenchPilot
            </p>
            <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
              ~$45 live test profile. Deposit SOL in the vault, arm live, then
              buy from the scanner (auto-buy stays off until you enable it).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={cn(
                state.running
                  ? "border-[var(--acid)]/40 text-[var(--acid)]"
                  : "border-amber-400/40 text-amber-300",
              )}
            >
              {state.running ? "engine live" : "paused"}
            </Badge>
            <Badge
              className={
                state.settings.liveArmed
                  ? "border-[var(--acid)]/50 text-[var(--acid)]"
                  : undefined
              }
            >
              {state.settings.liveArmed ? "LIVE" : "paper"}
            </Badge>
            {state.busy ? <Badge className="text-amber-300">busy</Badge> : null}
            <Badge
              className={
                state.telegramConnected
                  ? "border-sky-400/40 text-sky-300"
                  : undefined
              }
            >
              tg {state.telegramConnected ? "on" : "off"}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                dispatch({ type: state.running ? "stop" : "start" })
              }
            >
              {state.running ? (
                <>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> Resume
                </>
              )}
            </Button>
            {state.settings.liveArmed ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || state.busy}
                onClick={() => dispatch({ type: "clear_ghosts" })}
              >
                Clear ghosts
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="relative mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
        {error ? (
          <div className="lg:col-span-2 rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <section className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat
              label={live ? "Vault balance" : "Balance"}
              value={formatSol(displayBalance, live ? 4 : 3)}
              hint={live ? "on-chain SOL" : "paper wallet"}
            />
            <Stat
              label="Realized"
              value={formatSol(state.realizedPnlSol)}
              hint="closed trades"
              tone={state.realizedPnlSol >= 0 ? "up" : "down"}
            />
            <Stat
              label="Unrealized"
              value={formatSol(unrealized)}
              hint="open bags"
              tone={unrealized >= 0 ? "up" : "down"}
            />
            <Stat
              label="Open"
              value={`${state.positions.length}/${state.settings.maxOpenPositions}`}
              hint="position slots"
            />
          </div>

          <Panel
            title="Launch scanner"
            icon={<Radar className="h-4 w-4 text-[var(--acid)]" />}
            action={
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                Auto-buy
                <Switch
                  checked={state.settings.autoScanBuy}
                  onCheckedChange={(checked) =>
                    dispatch({
                      type: "update_settings",
                      patch: { autoScanBuy: checked },
                    })
                  }
                />
              </label>
            }
          >
            <div className="mb-3 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
              <span>
                Min score{" "}
                <strong className="text-[var(--foam)]">
                  {state.settings.minScoreToBuy}
                </strong>
              </span>
              <span>
                Buy size{" "}
                <strong className="text-[var(--foam)]">
                  {formatSol(state.settings.buySizeSol)}
                </strong>
              </span>
              <span className="font-mono">
                last scan{" "}
                {state.lastScanAt
                  ? new Date(state.lastScanAt).toLocaleTimeString()
                  : "—"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="font-mono text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="py-2 pr-2">Token</th>
                    <th className="py-2 pr-2">Score</th>
                    <th className="py-2 pr-2">MC</th>
                    <th className="py-2 pr-2">Curve</th>
                    <th className="py-2 pr-2">1m</th>
                    <th className="py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-[var(--muted)]">
                        Waiting for fresh launches…
                      </td>
                    </tr>
                  ) : (
                    ranked.slice(0, 14).map((t) => {
                      const held = state.positions.some((p) => p.mint === t.mint);
                      const liveBlocked =
                        state.settings.liveArmed && t.solQuoted === false;
                      return (
                        <tr
                          key={t.id}
                          className="border-b border-[var(--line)]/60 hover:bg-white/[0.02]"
                        >
                          <td className="py-2.5 pr-2">
                            <div className="font-medium">{t.symbol}</div>
                            <div className="font-mono text-[11px] text-[var(--muted)]">
                              {shortAddress(t.mint, 3)} · {t.name}
                              {liveBlocked ? " · not SOL pair" : ""}
                            </div>
                          </td>
                          <td className="py-2.5 pr-2">
                            <ScorePill score={t.score} />
                          </td>
                          <td className="py-2.5 pr-2 font-mono text-xs">
                            {formatUsd(t.marketCapUsd)}
                          </td>
                          <td className="py-2.5 pr-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--panel-deep)]">
                              <div
                                className="h-full bg-[var(--acid)] transition-all duration-500"
                                style={{ width: `${t.bondingProgress}%` }}
                              />
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                              {t.bondingProgress.toFixed(0)}%
                            </div>
                          </td>
                          <td
                            className={cn(
                              "py-2.5 pr-2 font-mono text-xs",
                              t.change1mPct >= 0
                                ? "text-emerald-300"
                                : "text-red-300",
                            )}
                          >
                            {formatPct(t.change1mPct)}
                          </td>
                          <td className="py-2.5">
                            <Button
                              size="sm"
                              disabled={held || pending || liveBlocked || state.busy}
                              onClick={() =>
                                dispatch({
                                  type: "buy",
                                  mint: t.mint,
                                  source: "manual",
                                })
                              }
                            >
                              {held ? "Held" : liveBlocked ? "N/A" : "Buy"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Open positions"
            icon={<Wallet className="h-4 w-4 text-[var(--acid)]" />}
          >
            {state.positions.length === 0 ? (
              <Empty>No bags yet. Auto-buy or tap Buy on a high-score launch.</Empty>
            ) : (
              <div className="space-y-2">
                {state.positions.map((p) => {
                  const t = state.tokens.find((x) => x.mint === p.mint);
                  const pnlPct = t
                    ? ((t.priceSol - p.entryPriceSol) / p.entryPriceSol) * 100
                    : 0;
                  return (
                    <div
                      key={p.id}
                      className="flex flex-col gap-2 rounded-md border border-[var(--line)] bg-[var(--panel-deep)]/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.symbol}</span>
                          <Badge>{p.source}</Badge>
                          <Badge>
                            {state.tokens.find((t) => t.mint === p.mint)
                              ?.status === "migrated"
                              ? "PumpSwap"
                              : "bonding"}
                          </Badge>
                        </div>
                        <div className="mt-1 font-mono text-xs text-[var(--muted)]">
                          {formatSol(p.costSol)} in · peak {formatPct(p.peakPnlPct)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "font-mono text-sm",
                            pnlPct >= 0 ? "text-emerald-300" : "text-red-300",
                          )}
                        >
                          {formatPct(pnlPct)}
                        </span>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={pending}
                          onClick={() =>
                            dispatch({ type: "sell", mint: p.mint })
                          }
                        >
                          Sell
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </section>

        <aside className="space-y-6">
          <WalletVault
            liveArmed={state.settings.liveArmed}
            mode={state.settings.mode}
            pending={pending || state.busy}
            onArmLive={() => dispatch({ type: "arm_live" })}
            onDisarmLive={() => dispatch({ type: "disarm_live" })}
          />

          <Panel
            title="Copy trade"
            icon={<Copy className="h-4 w-4 text-[var(--acid)]" />}
            action={
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                Enabled
                <Switch
                  checked={state.settings.copyTradeEnabled}
                  onCheckedChange={(checked) =>
                    dispatch({
                      type: "update_settings",
                      patch: { copyTradeEnabled: checked },
                    })
                  }
                />
              </label>
            }
          >
            <form
              className="mb-4 grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!walletInput.trim()) return;
                dispatch({
                  type: "add_copy_wallet",
                  address: walletInput.trim(),
                  label: walletLabel.trim() || undefined,
                });
                setWalletInput("");
                setWalletLabel("");
              }}
            >
              <Input
                placeholder="Wallet address to mirror"
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  placeholder="Label (optional)"
                  value={walletLabel}
                  onChange={(e) => setWalletLabel(e.target.value)}
                />
                <Button type="submit" disabled={pending}>
                  Add
                </Button>
              </div>
            </form>
            <div className="space-y-2">
              {state.copyWallets.map((w) => (
                <div
                  key={w.address}
                  className="rounded-md border border-[var(--line)] bg-[var(--panel-deep)]/70 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{w.label}</div>
                      <div className="font-mono text-[11px] text-[var(--muted)]">
                        {shortAddress(w.address, 6)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={w.enabled}
                        onCheckedChange={(checked) =>
                          dispatch({
                            type: "toggle_copy_wallet",
                            address: w.address,
                            enabled: checked,
                          })
                        }
                      />
                      <button
                        type="button"
                        className="text-[var(--muted)] hover:text-red-300"
                        onClick={() =>
                          dispatch({
                            type: "remove_copy_wallet",
                            address: w.address,
                          })
                        }
                        aria-label="Remove wallet"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-3 font-mono text-[11px] text-[var(--muted)]">
                    <span>buys {w.mirroredBuys}</span>
                    <span>sells {w.mirroredSells}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Strategy"
            icon={<Sparkles className="h-4 w-4 text-[var(--acid)]" />}
          >
            <div className="space-y-3 text-sm">
              <SettingRow label="Buy size (SOL)">
                <Input
                  type="number"
                  step="0.05"
                  min="0.01"
                  className="h-8 w-24"
                  defaultValue={state.settings.buySizeSol}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v <= 0) return;
                    dispatch({
                      type: "update_settings",
                      patch: { buySizeSol: v },
                    });
                  }}
                />
              </SettingRow>
              <SettingRow label="Min score to buy">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  className="h-8 w-24"
                  defaultValue={state.settings.minScoreToBuy}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    dispatch({
                      type: "update_settings",
                      patch: { minScoreToBuy: v },
                    });
                  }}
                />
              </SettingRow>
              <SettingRow label="Take profit %">
                <Input
                  type="number"
                  className="h-8 w-24"
                  defaultValue={state.settings.takeProfitPct}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    dispatch({
                      type: "update_settings",
                      patch: { takeProfitPct: v },
                    });
                  }}
                />
              </SettingRow>
              <SettingRow label="Stop loss %">
                <Input
                  type="number"
                  className="h-8 w-24"
                  defaultValue={state.settings.stopLossPct}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    dispatch({
                      type: "update_settings",
                      patch: { stopLossPct: v },
                    });
                  }}
                />
              </SettingRow>
              <SettingRow label="Copy max SOL">
                <Input
                  type="number"
                  step="0.05"
                  className="h-8 w-24"
                  defaultValue={state.settings.copyMaxSol}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v <= 0) return;
                    dispatch({
                      type: "update_settings",
                      patch: { copyMaxSol: v },
                    });
                  }}
                />
              </SettingRow>
              <SettingRow label="Mirror sells">
                <Switch
                  checked={state.settings.mirrorSells}
                  onCheckedChange={(checked) =>
                    dispatch({
                      type: "update_settings",
                      patch: { mirrorSells: checked },
                    })
                  }
                />
              </SettingRow>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => dispatch({ type: "reset_paper" })}
              >
                Reset paper account
              </Button>
            </div>
          </Panel>

          <Panel
            title="Telegram"
            icon={<Send className="h-4 w-4 text-[var(--acid)]" />}
          >
            <p className="text-sm text-[var(--muted)]">
              Set <code className="text-[var(--acid)]">TELEGRAM_BOT_TOKEN</code>{" "}
              in <code className="text-[var(--acid)]">.env.local</code>, restart
              the app, then message your bot with{" "}
              <code className="text-[var(--foam)]">/start</code>.
            </p>
            <ul className="mt-3 space-y-1 font-mono text-xs text-[var(--muted)]">
              <li>/scan · /buy · /sell · /positions</li>
              <li>/copyadd · /copyrm · /auto on|off</li>
              <li>/pause · /resume · /status</li>
            </ul>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <Bot className="h-4 w-4 text-[var(--acid)]" />
              {state.telegramConfigured || state.telegramConnected
                ? "Token detected / bot connected"
                : "No token configured — UI control still works"}
            </div>
          </Panel>

          <Panel
            title="Live tape"
            icon={<Activity className="h-4 w-4 text-[var(--acid)]" />}
          >
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {state.events.map((e) => (
                <div
                  key={e.id}
                  className="border-l-2 border-[var(--acid)]/40 pl-3 text-xs"
                >
                  <div className="font-mono text-[10px] uppercase text-[var(--muted)]">
                    {e.type} · {new Date(e.at).toLocaleTimeString()}
                  </div>
                  <div className="text-[var(--foam)]/90">{e.message}</div>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </main>
    </div>
  );
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)]/80 p-4 shadow-[0_0_0_1px_rgba(200,255,0,0.03)] backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)]/80 p-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-display text-xl font-semibold",
          tone === "up" && "text-emerald-300",
          tone === "down" && "text-red-300",
        )}
      >
        {value}
      </div>
      <div className="text-[11px] text-[var(--muted)]">{hint}</div>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 75
      ? "bg-[var(--acid)] text-[var(--ink)]"
      : score >= 60
        ? "bg-amber-300/90 text-[var(--ink)]"
        : "bg-[var(--panel-deep)] text-[var(--muted)] border border-[var(--line)]";
  return (
    <span
      className={cn(
        "inline-flex min-w-10 justify-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold",
        tone,
      )}
    >
      {score.toFixed(0)}
    </span>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--muted)]">{label}</span>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--line)] px-3 py-8 text-center text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}
