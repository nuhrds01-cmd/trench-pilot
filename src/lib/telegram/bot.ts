import { Bot, InlineKeyboard } from "grammy";
import { getBotEngine } from "@/lib/bot/engine";
import { formatPct, formatSol, shortAddress } from "@/lib/utils";

let botInstance: Bot | null = null;
let started = false;

export function getTelegramStatus() {
  return {
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    running: started,
  };
}

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const engine = getBotEngine();

  if (!token) {
    engine.setTelegramConnected(false);
    return { ok: false, message: "TELEGRAM_BOT_TOKEN not set." };
  }

  if (started && botInstance) {
    engine.setTelegramConnected(true);
    return { ok: true, message: "Telegram bot already running." };
  }

  const bot = new Bot(token);
  botInstance = bot;

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "TrenchPilot online.",
        "",
        "Commands:",
        "/status — balance, positions, engine",
        "/scan — top scored launches",
        "/buy <mint|symbol> — paper buy",
        "/sell <mint|symbol> — paper sell",
        "/positions — open bags",
        "/copy — list wallets",
        "/copyadd <address> [label]",
        "/copyrm <address>",
        "/auto on|off — scanner auto-buy",
        "/pause /resume — engine loop",
      ].join("\n"),
      { reply_markup: controlKeyboard() },
    );
  });

  bot.command("status", async (ctx) => {
    const s = engine.getState();
    const unrealized = s.positions.reduce((acc, p) => {
      const t = s.tokens.find((x) => x.mint === p.mint);
      if (!t) return acc;
      return acc + (p.amountTokens * t.priceSol - p.costSol);
    }, 0);
    await ctx.reply(
      [
        `Mode: ${s.settings.mode}`,
        `Engine: ${s.running ? "running" : "paused"}`,
        `Balance: ${formatSol(s.balanceSol)}`,
        `Realized: ${formatSol(s.realizedPnlSol)}`,
        `Unrealized: ${formatSol(unrealized)}`,
        `Positions: ${s.positions.length}/${s.settings.maxOpenPositions}`,
        `Auto-buy: ${s.settings.autoScanBuy ? "on" : "off"}`,
        `Copy-trade: ${s.settings.copyTradeEnabled ? "on" : "off"}`,
        `Min score: ${s.settings.minScoreToBuy}`,
      ].join("\n"),
    );
  });

  bot.command("scan", async (ctx) => {
    const s = engine.getState();
    const top = [...s.tokens].sort((a, b) => b.score - a.score).slice(0, 8);
    if (!top.length) {
      await ctx.reply("Scanner is warming up — no launches yet.");
      return;
    }
    const lines = top.map(
      (t, i) =>
        `${i + 1}. ${t.symbol} · score ${t.score.toFixed(0)} · MC $${Math.round(t.marketCapUsd).toLocaleString()} · ${t.bondingProgress.toFixed(0)}% curve`,
    );
    await ctx.reply(["Top launches:", ...lines].join("\n"));
  });

  bot.command("positions", async (ctx) => {
    const s = engine.getState();
    if (!s.positions.length) {
      await ctx.reply("No open positions.");
      return;
    }
    const lines = s.positions.map((p) => {
      const t = s.tokens.find((x) => x.mint === p.mint);
      const pnl = t
        ? ((t.priceSol - p.entryPriceSol) / p.entryPriceSol) * 100
        : 0;
      return `${p.symbol} · ${formatSol(p.costSol)} · ${formatPct(pnl)} · ${p.source}`;
    });
    await ctx.reply(lines.join("\n"));
  });

  bot.command("buy", async (ctx) => {
    const arg = ctx.match?.toString().trim();
    if (!arg) {
      await ctx.reply("Usage: /buy <mint|symbol>");
      return;
    }
    const mint = resolveMint(arg);
    if (!mint) {
      await ctx.reply("Token not found. Try /scan.");
      return;
    }
    const result = await engine.dispatch({
      type: "buy",
      mint,
      source: "manual",
    });
    await ctx.reply(result.message);
  });

  bot.command("sell", async (ctx) => {
    const arg = ctx.match?.toString().trim();
    if (!arg) {
      await ctx.reply("Usage: /sell <mint|symbol>");
      return;
    }
    const mint = resolveMint(arg);
    if (!mint) {
      await ctx.reply("Token/position not found.");
      return;
    }
    const result = await engine.dispatch({ type: "sell", mint });
    await ctx.reply(result.message);
  });

  bot.command("copy", async (ctx) => {
    const s = engine.getState();
    if (!s.copyWallets.length) {
      await ctx.reply("No copy wallets. Add with /copyadd <address> [label]");
      return;
    }
    const lines = s.copyWallets.map(
      (w) =>
        `${w.enabled ? "●" : "○"} ${w.label} · ${shortAddress(w.address)} · buys ${w.mirroredBuys}`,
    );
    await ctx.reply(lines.join("\n"));
  });

  bot.command("copyadd", async (ctx) => {
    const text = ctx.match?.toString().trim() ?? "";
    const [address, ...labelParts] = text.split(/\s+/);
    if (!address) {
      await ctx.reply("Usage: /copyadd <address> [label]");
      return;
    }
    const result = await engine.dispatch({
      type: "add_copy_wallet",
      address,
      label: labelParts.join(" ") || undefined,
    });
    await ctx.reply(result.message);
  });

  bot.command("copyrm", async (ctx) => {
    const address = ctx.match?.toString().trim();
    if (!address) {
      await ctx.reply("Usage: /copyrm <address>");
      return;
    }
    const result = await engine.dispatch({
      type: "remove_copy_wallet",
      address,
    });
    await ctx.reply(result.message);
  });

  bot.command("auto", async (ctx) => {
    const arg = (ctx.match?.toString().trim() || "").toLowerCase();
    if (arg !== "on" && arg !== "off") {
      await ctx.reply("Usage: /auto on|off");
      return;
    }
    await engine.dispatch({
      type: "update_settings",
      patch: { autoScanBuy: arg === "on" },
    });
    await ctx.reply(`Scanner auto-buy ${arg}.`);
  });

  bot.command("pause", async (ctx) => {
    const result = await engine.dispatch({ type: "stop" });
    await ctx.reply(result.message);
  });

  bot.command("resume", async (ctx) => {
    const result = await engine.dispatch({ type: "start" });
    await ctx.reply(result.message);
  });

  bot.command("live", async (ctx) => {
    const arg = (ctx.match?.toString().trim() || "").toLowerCase();
    if (arg === "off") {
      const result = await engine.dispatch({ type: "disarm_live" });
      await ctx.reply(result.message);
      return;
    }
    const result = await engine.dispatch({ type: "arm_live" });
    await ctx.reply(result.message);
  });

  bot.callbackQuery("tg:scan", async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = engine.getState();
    const top = [...s.tokens].sort((a, b) => b.score - a.score).slice(0, 5);
    await ctx.reply(
      top.length
        ? top.map((t) => `${t.symbol} ${t.score.toFixed(0)}`).join(" · ")
        : "No launches yet.",
    );
  });

  bot.callbackQuery("tg:status", async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = engine.getState();
    await ctx.reply(
      `${s.running ? "Running" : "Paused"} · ${formatSol(s.balanceSol)} · ${s.positions.length} pos`,
    );
  });

  bot.catch((err) => {
    console.error("Telegram bot error", err);
  });

  // Non-blocking long polling for local/dev
  void bot.start({
    onStart: () => {
      started = true;
      engine.setTelegramConnected(true);
      console.log("Telegram bot polling started");
    },
  });

  return { ok: true, message: "Telegram bot starting." };
}

function controlKeyboard() {
  return new InlineKeyboard()
    .text("Status", "tg:status")
    .text("Scan", "tg:scan");
}

function resolveMint(query: string) {
  const s = getBotEngine().getState();
  const q = query.toLowerCase();
  const byMint = s.tokens.find((t) => t.mint === query);
  if (byMint) return byMint.mint;
  const bySymbol = s.tokens.find((t) => t.symbol.toLowerCase() === q);
  if (bySymbol) return bySymbol.mint;
  const pos = s.positions.find(
    (p) => p.mint === query || p.symbol.toLowerCase() === q,
  );
  return pos?.mint;
}
