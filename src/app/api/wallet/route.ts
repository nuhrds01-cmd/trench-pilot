import { connection } from "next/server";
import { NextResponse } from "next/server";
import { getWalletInfo } from "@/lib/wallet/bot-wallet";

export async function GET() {
  await connection();
  const info = await getWalletInfo();
  return NextResponse.json(info);
}
