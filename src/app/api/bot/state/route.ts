import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getBotEngine } from "@/lib/bot/engine";
import { getTelegramStatus } from "@/lib/telegram/bot";

export async function GET() {
  await connection();
  const engine = getBotEngine();
  engine.start();
  const state = engine.getState();
  const telegram = getTelegramStatus();
  return NextResponse.json({
    ...state,
    telegramConnected: telegram.running || state.telegramConnected,
    telegramConfigured: telegram.configured,
  });
}
