import { connection } from "next/server";
import { getBotEngine } from "@/lib/bot/engine";
import { getTelegramStatus } from "@/lib/telegram/bot";

export async function GET() {
  await connection();
  const engine = getBotEngine();
  engine.start();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      unsubscribe = engine.subscribe((state) => {
        const telegram = getTelegramStatus();
        send({
          ...state,
          telegramConnected: telegram.running || state.telegramConnected,
          telegramConfigured: telegram.configured,
        });
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
