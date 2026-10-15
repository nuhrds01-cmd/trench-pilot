export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getBotEngine } = await import("@/lib/bot/engine");
  getBotEngine().start();

  const { startTelegramBot } = await import("@/lib/telegram/bot");
  await startTelegramBot();
}
