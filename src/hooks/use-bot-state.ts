"use client";

import { useEffect, useState, useTransition } from "react";
import type { BotAction, BotState } from "@/lib/bot/types";

export type ClientBotState = BotState & {
  telegramConfigured?: boolean;
};

export function useBotState() {
  const [state, setState] = useState<ClientBotState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let closed = false;
    let source: EventSource | null = null;

    async function bootstrap() {
      try {
        const res = await fetch("/api/bot/state", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load bot state");
        const data = (await res.json()) as ClientBotState;
        if (!closed) {
          setState(data);
          setError(null);
        }
      } catch (e) {
        if (!closed) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      }
    }

    void bootstrap();
    source = new EventSource("/api/bot/stream");
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as BotState;
        setState((prev) => ({
          ...data,
          telegramConfigured: prev?.telegramConfigured,
        }));
        setError(null);
      } catch {
        // ignore malformed frames
      }
    };
    source.onerror = () => {
      // EventSource reconnects automatically; keep last good state
    };

    return () => {
      closed = true;
      source?.close();
    };
  }, []);

  function dispatch(action: BotAction) {
    startTransition(async () => {
      const res = await fetch("/api/bot/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = await res.json();
      if (data.state) {
        setState((prev) => ({
          ...data.state,
          telegramConfigured: prev?.telegramConfigured,
        }));
      }
      if (!data.ok) setError(data.message ?? "Action failed");
    });
  }

  return { state, error, pending, dispatch, setState };
}
