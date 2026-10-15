import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";

const root = process.cwd();
const envPath = path.join(root, ".env.local");
const backupPath = path.join(root, ".wallet-backup.json");

if (fs.existsSync(envPath) && fs.readFileSync(envPath, "utf8").includes("BOT_WALLET_SECRET_KEY=")) {
  console.error(".env.local already has BOT_WALLET_SECRET_KEY — refusing to overwrite.");
  console.error("Delete that line first if you really want a new wallet.");
  process.exit(1);
}

const kp = Keypair.generate();
const secret = bs58.encode(kp.secretKey);
const address = kp.publicKey.toBase58();

const block = `
# TrenchPilot bot wallet — NEVER commit this file
BOT_WALLET_SECRET_KEY=${secret}
BOT_WALLET_ADDRESS=${address}
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
`.trimStart();

if (fs.existsSync(envPath)) {
  fs.appendFileSync(envPath, `\n${block}`);
} else {
  fs.writeFileSync(envPath, block);
}

fs.writeFileSync(
  backupPath,
  JSON.stringify(
    {
      address,
      secretKeyBase58: secret,
      createdAt: new Date().toISOString(),
      note: "KEEP PRIVATE. Import into Phantom to control funds.",
    },
    null,
    2,
  ),
);

console.log("Created bot wallet");
console.log("Address:", address);
console.log("Wrote .env.local and .wallet-backup.json (gitignored)");
console.log("Save the private key somewhere safe BEFORE depositing SOL.");
