# TrenchPilot

Pump.fun-style trading cockpit with a live web UI, launch scanner + scoring, copy-trade watchlist, and optional Telegram control.

Runs in **paper mode** by default so you can exercise the full loop without mainnet keys.

Defaults are tuned for a **~$45 starter bankroll** (~0.43 SOL sim at ~$105/SOL): 0.03 SOL buys, max 2 open positions, min score 78, tighter TP/SL, and capped copy size (0.04 SOL).

## Real SOL vault (deposit / withdraw)

Paper trading does **not** spend deposited SOL. The vault is a dedicated custody wallet so you can park funds and pull them back out.

```bash
npm run wallet:create   # writes gitignored .env.local + .wallet-backup.json
npm run dev
```

1. Open the dashboard → **Real SOL vault**
2. **Save the private key** (Reveal private key) before depositing
3. Send ~$45 SOL to the deposit address
4. Click **Go Live (~$45)** — arms on-chain buys (max 0.03 SOL, 0.02 SOL fee reserve). Auto-buy/copy stay off.
5. Buy from the live DexScreener pump feed (or wait for refreshes), sell from Open positions
6. Cash out: vault **Withdraw**, or import the key into Phantom

Telegram: `/live` arms, `/live off` disarms.

## Features

- **Launch scanner** — simulated new-token feed scored on momentum, socials, holder quality, sniper/dev risk, and bonding-curve stage
- **Auto-buy** — optionally enter top launches above your min score (pickier by default on the small-account profile)
- **Copy trade** — mirror buys/sells from selected wallets (simulated lead wallets in paper mode), size-capped for small stacks
- **Risk exits** — take-profit, stop-loss, trailing stop
- **Telegram control** — `/scan`, `/buy`, `/sell`, `/copyadd`, `/auto`, `/pause`, and more when `TELEGRAM_BOT_TOKEN` is set

## Run locally

```bash
npm install
cp .env.example .env.local   # optional Telegram token
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

## Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Put it in `.env.local` as `TELEGRAM_BOT_TOKEN=...`.
3. Restart `npm run dev`, then message the bot with `/start`.

## Live trading note

Live Pump.fun execution is intentionally gated. Paper mode proves the product surface (UI + Telegram + scanner + copy-trade). Wiring real RPC, a hot wallet, and Pump.fun program instructions is a separate step — keep funds in a dedicated wallet if you extend it.

## Stack

Next.js (App Router), TypeScript, Tailwind, Grammy (Telegram), in-process bot engine with SSE updates.
