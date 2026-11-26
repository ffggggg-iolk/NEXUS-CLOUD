import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function tokenFromRequest(request) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  const protocols = request.headers.get("Sec-WebSocket-Protocol") || "";
  const match = protocols.split(",").map((v) => v.trim()).find((v) => v.startsWith("nexus-token."));
  return match ? match.slice("nexus-token.".length) : "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "NEXUS LINK", version: "0.2.0" });
    }

    if (url.pathname === "/panel" && request.method === "POST") {
      const supplied = tokenFromRequest(request);
      const expected = env.NEXUS_PANEL_TOKEN || "";
      if (!expected || !supplied || supplied.length !== expected.length) return json({ error: "Unauthorized" }, 401);
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
      if (diff !== 0) return json({ error: "Unauthorized" }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const device = body?.device;
      const packet = body?.packet;
      if (typeof device !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(device) || !packet || typeof packet.type !== "string") {
        return json({ error: "Invalid panel request" }, 400);
      }
      const stub = env.NEXUS_ROOMS.get(env.NEXUS_ROOMS.idFromName(device));
      return stub.fetch("https://nexus-room/panel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(packet)
      });
    }

    if (url.pathname !== "/connect" || request.method !== "GET") {
      return json({ error: "Not found" }, 404);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, 426);
    }

    const role = url.searchParams.get("role");
    const device = url.searchParams.get("device");
    if (!["device", "panel"].includes(role) || !device || !/^[a-zA-Z0-9_-]{3,64}$/.test(device)) {
      return json({ error: "Invalid connection parameters" }, 400);
    }

    const supplied = tokenFromRequest(request);
    const expected = role === "device" ? env.NEXUS_DEVICE_TOKEN : env.NEXUS_PANEL_TOKEN;
    if (!expected || !supplied || supplied.length !== expected.length) {
      return json({ error: "Unauthorized" }, 401);
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return json({ error: "Unauthorized" }, 401);

    const id = env.NEXUS_ROOMS.idFromName(device);
    const stub = env.NEXUS_ROOMS.get(id);
    return stub.fetch(request);
  },
};

export class NexusRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pending = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/panel" && request.method === "POST") {
      let packet;
      try { packet = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      const deviceSocket = this.ctx.getWebSockets().find(peer => (peer.deserializeAttachment() || {}).role === "device");
      if (!deviceSocket) return json({ error: "Device offline" }, 503);
      const requestId = crypto.randomUUID();
      packet.requestId = requestId;
      const result = new Promise(resolve => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          resolve(json({ error: "Device response timeout" }, 504));
        }, 12000);
        this.pending.set(requestId, { resolve, timer });
      });
      try { deviceSocket.send(JSON.stringify(packet)); }
      catch {
        const item = this.pending.get(requestId);
        if (item) { clearTimeout(item.timer); this.pending.delete(requestId); item.resolve(json({ error: "Device send failed" }, 503)); }
      }
      return result;
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const role = url.searchParams.get("role");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role, connectedAt: Date.now() });
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "nexus-link" },
    });
  }

  async webSocketMessage(sender, message) {
    if (typeof message !== "string" || message.length > 65536) {
      sender.close(1009, "Message too large or invalid");
      return;
    }
    let packet;
    try { packet = JSON.parse(message); } catch {
      sender.close(1003, "JSON messages only");
      return;
    }
    const allowed = new Set([
      "hello", "ping", "status.request", "status",
      "project.start", "project.stop", "project.restart",
      "logs.request", "logs",
    ]);
    if (!packet || typeof packet.type !== "string" || !allowed.has(packet.type)) {
      sender.send(JSON.stringify({ type: "error", error: "Unsupported message type" }));
      return;
    }
    const attachment = sender.deserializeAttachment() || {};
    if (attachment.role === "device" && packet.requestId && this.pending.has(packet.requestId) &&
        ["status", "action.result", "logs", "error"].includes(packet.type)) {
      const item = this.pending.get(packet.requestId);
      clearTimeout(item.timer);
      this.pending.delete(packet.requestId);
      item.resolve(json(packet, packet.type === "error" ? 400 : 200));
    }
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === sender) continue;
      const peerInfo = peer.deserializeAttachment() || {};
      if (peerInfo.role && peerInfo.role !== attachment.role) {
        try { peer.send(message); } catch {}
      }
    }
    if (packet.type === "ping") {
      sender.send(JSON.stringify({ type: "pong", at: Date.now() }));
    }
  }

  async webSocketClose(ws, code, reason) {
    if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) {
      ws.close(code, reason);
    } else {
      ws.close();
    }
  }
}
