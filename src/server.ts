import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { timingSafeEqual } from "node:crypto";

export const HERBIE_PORT = 47616;
const AUTH_TIMEOUT_MS = 5_000;
const PING_INTERVAL_MS = 20_000;
const MAX_MESSAGE_BYTES = 64 * 1024;

// Constant-time comparison, so response timing can't reveal how much of a token matched
function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type HerbieServer = {
  sendToExtension: (command: object) => number;
  close: () => Promise<void>;
};

export async function startServer(token: string): Promise<HerbieServer> {
  const extensions = new Set<WebSocket>();
  const server = Fastify({ logger: false });

  await server.register(websocket, {
    options: { maxPayload: MAX_MESSAGE_BYTES },
  });

  server.get("/extension", { websocket: true }, (socket, request) => {
    // Layer 2: only browser extensions, never websites
    const origin = request.headers.origin ?? "";
    if (!origin.startsWith("chrome-extension://")) {
      socket.close(1008, "Origin not allowed");
      return;
    }

    // Layer 3: the first message must be the pairing token, within 5 seconds
    let authenticated = false;
    const authTimer = setTimeout(
      () => socket.close(1008, "Auth timeout"),
      AUTH_TIMEOUT_MS,
    );

    socket.on("message", (raw) => {
      let message: { type?: unknown; token?: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(1003, "Invalid JSON");
        return;
      }

      if (!authenticated) {
        const valid =
          message.type === "hello" &&
          typeof message.token === "string" &&
          tokensMatch(message.token, token);

        if (!valid) {
          socket.close(1008, "Bad token");
          return;
        }

        authenticated = true;
        clearTimeout(authTimer);
        extensions.add(socket);
        socket.send(JSON.stringify({ type: "welcome" }));
        console.log("Browser extension connected");
        return;
      }

      // Later rounds: results reported back by the extension
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (extensions.delete(socket)) {
        console.log("Browser extension disconnected");
      }
    });
  });

  // Keeps Chrome's extension service worker awake while connected
  const pingTimer = setInterval(() => {
    for (const socket of extensions) {
      socket.send(JSON.stringify({ type: "ping" }));
    }
  }, PING_INTERVAL_MS);

  server.addHook("onClose", async () => {
    clearInterval(pingTimer);
  });

  // Layer 1: loopback only
  await server.listen({ host: "127.0.0.1", port: HERBIE_PORT });
  console.log(`Herbie server listening on 127.0.0.1:${HERBIE_PORT}`);

  return {
    // Sends a command to every connected extension; returns how many received it
    sendToExtension(command: object): number {
      const data = JSON.stringify(command);
      for (const socket of extensions) {
        socket.send(data);
      }
      return extensions.size;
    },
    close: () => server.close(),
  };
}
