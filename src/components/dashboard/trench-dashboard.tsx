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
        await fetch("/api/bot/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "sync_balance" }),
        });
      } catch {
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
      PLACEHOLDER_PARTIAL_RESTORE
    </div>
  );
}
