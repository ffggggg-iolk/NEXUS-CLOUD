const COOKIE = "nexus_session";
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
async function sessionValid(request, env) {
  const secret = env.SESSION_SECRET || "";
  if (secret.length < 32) return false;
  const cookie = request.headers.get("Cookie") || "";
  const item = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE + "="));
  if (!item) return false;
  const parts = item.slice(COOKIE.length + 1).split(".");
  if (parts.length !== 2) return false;
  try {
    const payload = atob(parts[0].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - parts[0].length % 4) % 4));
    const data = JSON.parse(payload);
    if (!data.exp || data.exp < Date.now()) return false;
    const expected = await sign(parts[0], secret);
    const actual = fromB64url(parts[1]);
    return expected.length === actual.length && expected.every((v, i) => v === actual[i]);
  } catch { return false; }
}
function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
async function linkRequest(env, device, packet) {
  const origin = (env.NEXUS_LINK_URL || "https://nexus-link.mokccstudio.workers.dev").replace(/\/$/, "");
  const response = await fetch(origin + "/panel", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + (env.NEXUS_PANEL_TOKEN || ""),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ device, packet })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "NEXUS LINK HTTP " + response.status);
  return data;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  if (route === "login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const expected = env.ADMIN_PASSWORD || "";
    if (expected.length < 12 || typeof body.password !== "string" || body.password !== expected) {
      return json({ error: "Contraseña incorrecta o acceso no configurado." }, 401);
    }
    if ((env.SESSION_SECRET || "").length < 32) return json({ error: "Falta configurar SESSION_SECRET (mínimo 32 caracteres)." }, 503);
    const payload = b64url(encoder.encode(JSON.stringify({ exp: Date.now() + 8 * 60 * 60 * 1000 })));
    const signature = b64url(await sign(payload, env.SESSION_SECRET));
    return json({ ok: true }, 200, { "Set-Cookie": cookie(payload + "." + signature, 8 * 60 * 60) });
  }

  if (route === "logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }
  if (route === "me" && request.method === "GET") {
    return json({ authenticated: await sessionValid(request, env) });
  }
  if (!await sessionValid(request, env)) return json({ error: "Inicia sesión para continuar." }, 401);

  const device = env.NEXUS_DEVICE_ID || "redmi-a5";
  if (route === "health" && request.method === "GET") return json({ ok: true, service: "NEXUS CLOUD PAGES" });

  if (route === "device/status" && request.method === "GET") {
    try {
      const status = await linkRequest(env, device, { type: "status.request" });
      return json({ configured: true, connected: true, device, deviceOnline: true, lastSeen: status.at || new Date().toISOString(), projects: status.projects || [] });
    } catch (error) {
      return json({ configured: Boolean(env.NEXUS_PANEL_TOKEN), connected: false, device, deviceOnline: false, projects: [], error: error.message }, 503);
    }
  }
  if (route === "device/refresh" && request.method === "POST") {
    try {
      const result = await linkRequest(env, device, { type: "status.request" });
      return json({ ok: true, projects: result.projects || [] });
    } catch (error) { return json({ error: error.message }, 503); }
  }
  if (route === "overview" && request.method === "GET") {
    try {
      const result = await linkRequest(env, device, { type: "status.request" });
      const projects = result.projects || [];
      return json({ service: "NEXUS CLOUD", projects: projects.length, running: projects.filter(p => p.status === "running").length, worker: "online", device });
    } catch {
      return json({ service: "NEXUS CLOUD", projects: 0, running: 0, worker: "offline", device });
    }
  }
  if (route === "projects" && request.method === "GET") {
    try {
      const result = await linkRequest(env, device, { type: "status.request" });
      return json({ projects: result.projects || [] });
    } catch (error) { return json({ projects: [], error: error.message }, 503); }
  }
  if (route === "projects" && request.method === "POST") {
    return json({ error: "La subida de ZIP al dispositivo se habilitará en la siguiente actualización. Por ahora no se almacena el archivo." }, 501);
  }
  const actionMatch = route.match(/^device\/projects\/([a-f0-9-]{36})\/(start|stop|restart|logs)$/);
  if (actionMatch && request.method === "POST") {
    const [, projectId, action] = actionMatch;
    const types = { start: "project.start", stop: "project.stop", restart: "project.restart", logs: "logs.request" };
    try {
      const result = await linkRequest(env, device, { type: types[action], projectId });
      return json(result);
    } catch (error) { return json({ error: error.message }, 503); }
  }
  if (route.startsWith("projects/") && request.method === "DELETE") {
    return json({ error: "La eliminación remota todavía no está habilitada." }, 501);
  }
  return json({ error: "Not found" }, 404);
}
