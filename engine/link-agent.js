const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const ROOT = path.join(process.env.HOME || process.cwd(), ".nexus-engine");
const DEVICE_TOKEN_FILE = path.join(ROOT, "device.token");
const ENGINE_TOKEN_FILE = path.join(ROOT, "engine.token");
const LINK_URL = process.env.NEXUS_LINK_URL || "wss://nexus-link.mokccstudio.workers.dev/connect";
const DEVICE_ID = process.env.NEXUS_DEVICE_ID || "redmi-a5";
const ENGINE_URL = "http://127.0.0.1:8787";
const RECONNECT_MIN = 2000;
const RECONNECT_MAX = 30000;

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); }
  catch { return ""; }
}
const deviceToken = readSecret(DEVICE_TOKEN_FILE);
const engineToken = readSecret(ENGINE_TOKEN_FILE);
if (deviceToken.length < 32 || engineToken.length < 32) {
  console.error("[NEXUS LINK] Faltan tokens válidos en ~/.nexus-engine/");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{3,64}$/.test(DEVICE_ID)) {
  console.error("[NEXUS LINK] NEXUS_DEVICE_ID no es válido.");
  process.exit(1);
}

async function engineRequest(route, method = "GET") {
  const response = await fetch(ENGINE_URL + route, {
    method,
    headers: { Authorization: "Bearer " + engineToken },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "NEXUS ENGINE HTTP " + response.status);
  return data;
}

let socket;
let retry = RECONNECT_MIN;
let stopped = false;
let reconnectTimer;

function send(packet) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(packet));
  }
}

async function handlePacket(packet) {
  const requestId = typeof packet.requestId === "string" ? packet.requestId : undefined;
  try {
    if (packet.type === "hello") {
      send({ type: "hello", device: DEVICE_ID, agent: "NEXUS ENGINE LINK", version: "0.1.0" });
      return;
    }
    if (packet.type === "status.request") {
      const result = await engineRequest("/api/projects");
      send({ type: "status", requestId, device: DEVICE_ID, projects: result.projects || [], online: true, at: new Date().toISOString() });
      return;
    }
    const id = typeof packet.projectId === "string" ? packet.projectId : "";
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("projectId inválido.");
    if (packet.type === "project.start") {
      const result = await engineRequest("/api/projects/" + id + "/start", "POST");
      send({ type: "action.result", requestId, action: packet.type, ...result });
      return;
    }
    if (packet.type === "project.stop") {
      const result = await engineRequest("/api/projects/" + id + "/stop", "POST");
      send({ type: "action.result", requestId, action: packet.type, ...result });
      return;
    }
    if (packet.type === "project.restart") {
      await engineRequest("/api/projects/" + id + "/stop", "POST");
      const result = await engineRequest("/api/projects/" + id + "/start", "POST");
      send({ type: "action.result", requestId, action: packet.type, ...result });
      return;
    }
    if (packet.type === "logs.request") {
      const result = await engineRequest("/api/projects/" + id + "/logs");
      send({ type: "logs", requestId, projectId: id, logs: result.logs || "" });
    }
  } catch (error) {
    send({ type: "error", requestId, error: error.message || "Error interno del agente." });
  }
}

function connect() {
  if (stopped) return;
  const url = new URL(LINK_URL);
  url.searchParams.set("role", "device");
  url.searchParams.set("device", DEVICE_ID);
  console.log("[NEXUS LINK] Conectando a Cloudflare...");
  socket = new WebSocket(url.toString(), {
    headers: { Authorization: "Bearer " + deviceToken },
    handshakeTimeout: 15000,
    maxPayload: 65536,
  });

  socket.on("open", () => {
    retry = RECONNECT_MIN;
    console.log("[NEXUS LINK] Dispositivo conectado:", DEVICE_ID);
    send({ type: "hello", device: DEVICE_ID, agent: "NEXUS ENGINE LINK", version: "0.1.0" });
    socket.pingInterval = setInterval(() => send({ type: "ping", at: Date.now() }), 25000);
  });
  socket.on("message", data => {
    let packet;
    try { packet = JSON.parse(data.toString()); }
    catch { return; }
    handlePacket(packet);
  });
  socket.on("close", () => {
    if (socket.pingInterval) clearInterval(socket.pingInterval);
    console.log("[NEXUS LINK] Desconectado. Reintentando...");
    scheduleReconnect();
  });
  socket.on("error", error => {
    console.error("[NEXUS LINK]", error.message);
    try { socket.close(); } catch {}
  });
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, retry);
  retry = Math.min(retry * 2, RECONNECT_MAX);
}

process.on("SIGINT", () => { stopped = true; clearTimeout(reconnectTimer); if (socket) socket.close(); });
process.on("SIGTERM", () => { stopped = true; clearTimeout(reconnectTimer); if (socket) socket.close(); });

connect();
