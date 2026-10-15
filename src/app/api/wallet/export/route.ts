import { connection } from "next/server";
import { NextResponse } from "next/server";
import { exportSecretKey } from "@/lib/wallet/bot-wallet";

export async function POST(req: Request) {
  await connection();
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== "EXPORT") {
    return NextResponse.json(
      {
        ok: false,
        message: 'Send JSON { "confirm": "EXPORT" } to reveal the private key.',
      },
      { status: 400 },
    );
  }
  return NextResponse.json(exportSecretKey());
}
