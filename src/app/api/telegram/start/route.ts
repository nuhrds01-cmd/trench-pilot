import { connection } from "next/server";
import { NextResponse } from "next/server";
import { startTelegramBot, getTelegramStatus } from "@/lib/telegram/bot";

export async function POST() {
  await connection();
  const result = await startTelegramBot();
  return NextResponse.json({ ...result, ...getTelegramStatus() });
}

export async function GET() {
  await connection();
  return NextResponse.json(getTelegramStatus());
}
