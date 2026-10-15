"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  KeyRound,
  RefreshCw,
  Rocket,
  ShieldOff,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSol, shortAddress } from "@/lib/utils";

type WalletInfo = {
  configured: boolean;
  address: string | null;
  balanceSol: number | null;
  liveTradingReady: boolean;
};

type Props = {
  liveArmed?: boolean;
  mode?: "paper" | "live";
  onArmLive?: () => void;
  onDisarmLive?: () => void;
  pending?: boolean;
};

export function WalletVault({
  liveArmed = false,
  mode = "paper",
  onArmLive,
  onDisarmLive,
  pending,
}: Props) {
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const [exportedKey, setExportedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet", { cache: "no-store" });
      const data = (await res.json()) as WalletInfo;
      setInfo(data);
      setError(null);
    } catch {
      setError("Could not load wallet info");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  function goLive() {
    const ok = window.confirm(
      "Arm LIVE trading?\n\n• Uses real SOL from this vault\n• Max buy 0.03 SOL\n• Keeps 0.02 SOL reserve for fees\n• Auto-buy and copy-trade stay OFF until you enable them\n\nOnly continue if you deposited and saved the private key.",
    );
    if (ok) onArmLive?.();
  }

  async function withdraw(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setTxUrl(null);
    setError(null);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, amountSol: Number(amount) }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? "Withdraw failed");
      } else {
        setTxUrl(data.explorerUrl ?? null);
        setAmount("");
        await refresh();
      }
    } catch {
      setError("Withdraw request failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportKey() {
    const ok = window.confirm(
      "This reveals the private key for the bot wallet. Anyone with it can steal the SOL. Continue?",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/wallet/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "EXPORT" }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? "Export failed");
      } else {
        setExportedKey(data.secretKeyBase58);
      }
    } catch {
      setError("Export failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    if (!info?.address) return;
    await navigator.clipboard.writeText(info.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="rounded-xl border border-[var(--acid)]/35 bg-[var(--panel)]/90 p-4 shadow-[0_0_0_1px_rgba(200,255,0,0.06)] backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-[var(--acid)]" />
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Real SOL vault
          </h2>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mb-3 space-y-2 text-sm">
        <p className="text-[var(--muted)]">
          Deposit ~$45 SOL here, save the private key, then arm live. Buys hit
          real Pump.fun bonding curves from this wallet.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge
            className={
              liveArmed
                ? "border-[var(--acid)]/40 text-[var(--acid)]"
                : "border-amber-400/40 text-amber-300"
            }
          >
            {liveArmed ? "LIVE ARMED" : "paper / disarmed"}
          </Badge>
          <Badge>mode {mode}</Badge>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {!liveArmed ? (
            <Button
              size="sm"
              disabled={pending || !info?.configured}
              onClick={goLive}
            >
              <Rocket className="h-3.5 w-3.5" />
              Go Live (~$45)
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onDisarmLive?.()}
            >
              <ShieldOff className="h-3.5 w-3.5" />
              Disarm / paper
            </Button>
          )}
        </div>
      </div>

      {!info?.address ? (
        <p className="text-sm text-amber-200">
          No bot wallet configured. Run{" "}
          <code className="text-[var(--acid)]">npm run wallet:create</code>.
        </p>
      ) : (
        <>
          <div className="rounded-md border border-[var(--line)] bg-[var(--panel-deep)] p-3">
            <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Deposit here
            </div>
            <button
              type="button"
              onClick={() => void copyAddress()}
              className="mt-1 break-all text-left font-mono text-xs text-[var(--acid)] hover:underline"
            >
              {info.address}
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span>
                On-chain:{" "}
                <strong className="text-[var(--foam)]">
                  {info.balanceSol == null
                    ? "—"
                    : formatSol(info.balanceSol, 4)}
                </strong>
              </span>
              <span>{copied ? "Copied" : `tap to copy · ${shortAddress(info.address, 6)}`}</span>
            </div>
          </div>

          <form className="mt-4 space-y-2" onSubmit={withdraw}>
            <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Withdraw SOL
            </div>
            <Input
              placeholder="Your Phantom / personal wallet address"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.001"
                min="0.001"
                placeholder="Amount SOL"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              <Button type="submit" disabled={busy}>
                <ArrowUpRight className="h-3.5 w-3.5" />
                Send
              </Button>
            </div>
          </form>

          <div className="mt-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void exportKey()}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Reveal private key
            </Button>
          </div>

          {exportedKey ? (
            <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-400/10 p-3">
              <p className="text-xs text-amber-100">
                Save offline, then import into Phantom. Clear this after copying.
              </p>
              <code className="mt-2 block break-all font-mono text-[11px] text-[var(--foam)]">
                {exportedKey}
              </code>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => setExportedKey(null)}
              >
                Hide
              </Button>
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <p className="mt-3 text-xs text-red-300">{error}</p>
      ) : null}
      {txUrl ? (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block text-xs text-[var(--acid)] underline"
        >
          View withdraw on Solscan
        </a>
      ) : null}
    </section>
  );
}
