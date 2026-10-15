import { connection } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getBotEngine } from "@/lib/bot/engine";
import type { BotAction } from "@/lib/bot/types";

const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("stop") }),
  z.object({
    type: z.literal("buy"),
    mint: z.string().min(8),
    solAmount: z.number().positive().optional(),
    source: z.enum(["scanner", "copy", "manual"]).optional(),
  }),
  z.object({
    type: z.literal("sell"),
    mint: z.string().min(8),
    reason: z.enum(["scanner", "copy", "manual", "tp", "sl"]).optional(),
  }),
  z.object({
    type: z.literal("update_settings"),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("add_copy_wallet"),
    address: z.string().min(32),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("remove_copy_wallet"),
    address: z.string().min(32),
  }),
  z.object({
    type: z.literal("toggle_copy_wallet"),
    address: z.string().min(32),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal("reset_paper") }),
  z.object({ type: z.literal("arm_live") }),
  z.object({ type: z.literal("disarm_live") }),
  z.object({ type: z.literal("sync_balance") }),
  z.object({ type: z.literal("clear_ghosts") }),
]);

export async function POST(req: Request) {
  await connection();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Invalid action payload." },
      { status: 400 },
    );
  }

  const engine = getBotEngine();
  const result = await engine.dispatch(parsed.data as BotAction);
  const state = engine.getState();
  return NextResponse.json({ ...result, state });
}
