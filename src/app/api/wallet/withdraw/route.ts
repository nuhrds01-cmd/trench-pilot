import { connection } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withdrawSol } from "@/lib/wallet/bot-wallet";

const schema = z.object({
  to: z.string().min(32),
  amountSol: z.number().positive().max(100),
});

export async function POST(req: Request) {
  await connection();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Need a valid destination address and amountSol." },
      { status: 400 },
    );
  }

  try {
    const result = await withdrawSol(parsed.data.to, parsed.data.amountSol);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        message: e instanceof Error ? e.message : "Withdraw failed",
      },
      { status: 500 },
    );
  }
}
