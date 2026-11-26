const WebSocket = require("ws");
const crypto = require("crypto");

const LINK_URL = process.env.NEXUS_LINK_URL || "wss://nexus-link.mokccstudio.workers.dev/connect";
const DEVICE_ID = process.env.NEXUS_DEVICE_ID || "redmi-a5";
const PANEL_TOKEN = process.env.NEXUS_PANEL_TOKEN || "";
const RETRY_MS = 5000;

class NexusLinkClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.deviceOnline = false;
    this.lastSeen = null;
    this.projects = [];
    this.pending = new Map();
    this.retryTimer = null;
    this.stopped = false;
    this.lastError = PANEL_TOKEN ? null : "Falta configurar NEXUS_PANEL_TOKEN.";
  }

  start() {
    if (!PANEL_TOKEN) {
      console.warn("[NEXUS CLOUD] NEXUS LINK desactivado: falta NEXUS_PANEL_TOKEN.");
      return;
    }
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    const url = new URL(LINK_URL);
    url.searchParams.set("role", "panel");
    url.searchParams.set("device", DEVICE_ID);
    const ws = new WebSocket(url.toString(), "nexus-link", {
      headers: { Authorization: "Bearer " + PANEL_TOKEN },
      handshakeTimeout: 15000,
      maxPayload: 65536
    });
    this.socket = ws;
    ws.on("open", () => {
      this.connected = true;
      this.lastError = null;
      console.log("[NEXUS CLOUD] Conectado a NEXUS LINK.");
      this.send({ type: "hello", role: "panel", client: "NEXUS CLOUD" });
      this.send({ type: "status.request", requestId: crypto.randomUUID() });
    });
    ws.on("message", raw => this.onMessage(raw));
    ws.on("error", error => {
      this.lastError = error.message || "Error de conexión.";
      console.error("[NEXUS CLOUD] LINK:", this.lastError);
    });
    ws.on("close", () => {
      this.connected = false;
      this.deviceOnline = false;
      for (const [id, item] of this.pending) {
        clearTimeout(item.timer);
        item.reject(new Error("Conexión con NEXUS LINK interrumpida."));
        this.pending.delete(id);
      }
      if (!this.stopped) this.retryTimer = setTimeout(() => this.connect(), RETRY_MS);
    });
  }

  send(packet) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("NEXUS CLOUD no está conectado a NEXUS LINK.");
    }
    this.socket.send(JSON.stringify(packet));
  }

  onMessage(raw) {
    let packet;
    try { packet = JSON.parse(raw.toString()); } catch { return; }
    if (packet.type === "hello") {
      this.deviceOnline = true;
      this.lastSeen = new Date().toISOString();
      return;
    }
    if (packet.type === "status") {
      this.deviceOnline = true;
      this.lastSeen = new Date().toISOString();
      this.projects = Array.isArray(packet.projects) ? packet.projects : [];
    }
    if (packet.type === "pong") {
      this.deviceOnline = true;
      this.lastSeen = new Date().toISOString();
    }
    if (packet.requestId && this.pending.has(packet.requestId)) {
      const item = this.pending.get(packet.requestId);
      this.pending.delete(packet.requestId);
      clearTimeout(item.timer);
      if (packet.type === "error") item.reject(new Error(packet.error || "Error del dispositivo."));
      else item.resolve(packet);
    }
  }

  status() {
    return {
      configured: Boolean(PANEL_TOKEN),
      connected: this.connected,
      device: DEVICE_ID,
      deviceOnline: this.deviceOnline,
      lastSeen: this.lastSeen,
      projects: this.projects,
      error: this.lastError
    };
  }

  request(packet, timeoutMs = 12000) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("El dispositivo no respondió a tiempo."));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.send({ ...packet, requestId }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    if (this.socket) this.socket.close();
  }
}

module.exports = new NexusLinkClient();
