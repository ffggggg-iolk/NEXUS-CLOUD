const express = require("express");
const multer = require("multer");
const yauzl = require("yauzl");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = Number(process.env.ENGINE_PORT || 8787);
const HOST = process.env.ENGINE_HOST || "127.0.0.1";
const ROOT = path.resolve(process.env.NEXUS_ENGINE_HOME || path.join(process.env.HOME || process.cwd(), ".nexus-engine"));
const PROJECTS = path.join(ROOT, "projects");
const LOGS = path.join(ROOT, "logs");
const TOKEN_FILE = path.join(ROOT, "engine.token");
for (const dir of [ROOT, PROJECTS, LOGS]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

let token = process.env.NEXUS_ENGINE_TOKEN;
if (!token && fs.existsSync(TOKEN_FILE)) token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
if (!token) {
  token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600, flag: "wx" });
}
if (token.length < 32) throw new Error("NEXUS_ENGINE_TOKEN debe tener al menos 32 caracteres.");

const jobs = new Map();
const upload = multer({ dest: path.join(ROOT, "tmp"), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
fs.mkdirSync(path.join(ROOT, "tmp"), { recursive: true, mode: 0o700 });
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!crypto.timingSafeEqual(Buffer.from(supplied.padEnd(token.length, "\0").slice(0, token.length)), Buffer.from(token)) || supplied.length !== token.length) {
    return res.status(401).json({ error: "Token inválido." });
  }
  next();
});
app.get("/api/health", (_req, res) => res.json({ ok: true, engine: "NEXUS ENGINE", version: "0.1.0" }));

function safeId(value) { return /^[a-f0-9-]{36}$/.test(value); }
function readProjects() {
  return fs.readdirSync(PROJECTS, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => {
    const id = x.name;
    const file = path.join(PROJECTS, id, "package.json");
    let name = id;
    try { name = JSON.parse(fs.readFileSync(file, "utf8")).name || id; } catch {}
    const job = jobs.get(id);
    return { id, name, status: job && job.child.exitCode === null ? "running" : "stopped", pid: job?.child.pid || null };
  });
}
function extractZip(zipPath, dest) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(new Error("ZIP inválido."));
      let count = 0, total = 0;
      const fail = message => { try { zip.close(); } catch {} reject(new Error(message)); };
      zip.readEntry();
      zip.on("entry", entry => {
        count++; total += Number(entry.uncompressedSize || 0);
        const normalized = path.posix.normalize(entry.fileName.replace(/\\/g, "/"));
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (count > 1000 || total > 200 * 1024 * 1024 || normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) || mode === 0o120000) return fail("ZIP con rutas, enlaces o tamaños no permitidos.");
        if (entry.fileName.endsWith("/")) {
          fs.mkdirSync(path.join(dest, normalized), { recursive: true, mode: 0o700 });
          zip.readEntry(); return;
        }
        const target = path.resolve(dest, normalized);
        if (!target.startsWith(dest + path.sep)) return fail("Ruta ZIP no válida.");
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return fail("No se pudo leer el ZIP.");
          const output = fs.createWriteStream(target, { mode: 0o600, flags: "wx" });
          stream.pipe(output);
          output.on("error", () => fail("No se pudo extraer el ZIP."));
          output.on("finish", () => zip.readEntry());
        });
      });
      zip.on("end", resolve);
      zip.on("error", () => fail("Error leyendo ZIP."));
    });
  });
}
app.get("/api/projects", (_req, res) => res.json({ projects: readProjects() }));
app.post("/api/projects", upload.single("archive"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Adjunta un ZIP." });
  const id = crypto.randomUUID(), dest = path.join(PROJECTS, id);
  try {
    if (path.extname(req.file.originalname).toLowerCase() !== ".zip") throw new Error("Solo se permiten ZIP.");
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    await extractZip(req.file.path, dest);
    const pkg = path.join(dest, "package.json");
    if (!fs.existsSync(pkg)) throw new Error("El ZIP debe contener package.json en la raíz.");
    const parsed = JSON.parse(fs.readFileSync(pkg, "utf8"));
    if (!parsed.scripts || typeof parsed.scripts.start !== "string") throw new Error("El proyecto necesita un script start en package.json.");
    res.status(201).json({ ok: true, project: { id, name: parsed.name || req.file.originalname } });
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    res.status(400).json({ error: e.message || "No se pudo instalar el proyecto." });
  } finally { fs.rmSync(req.file.path, { force: true }); }
});
app.post("/api/projects/:id/start", (req, res) => {
  const id = req.params.id;
  if (!safeId(id) || !fs.existsSync(path.join(PROJECTS, id, "package.json"))) return res.status(404).json({ error: "Proyecto no encontrado." });
  const existing = jobs.get(id);
  if (existing && existing.child.exitCode === null) return res.json({ ok: true, status: "running", pid: existing.child.pid });
  const cwd = path.join(PROJECTS, id);
  const logPath = path.join(LOGS, id + ".log");
  const log = fs.createWriteStream(logPath, { flags: "a", mode: 0o600 });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["start"], { cwd, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  child.stdout.pipe(log); child.stderr.pipe(log);
  jobs.set(id, { child, log, startedAt: new Date().toISOString() });
  child.on("close", () => { log.end(); });
  res.json({ ok: true, status: "starting", pid: child.pid });
});
app.post("/api/projects/:id/stop", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.child.exitCode !== null) return res.json({ ok: true, status: "stopped" });
  job.child.kill("SIGTERM");
  res.json({ ok: true, status: "stopping" });
});
app.get("/api/projects/:id/logs", (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "ID inválido." });
  const file = path.join(LOGS, req.params.id + ".log");
  if (!fs.existsSync(file)) return res.json({ logs: "" });
  const content = fs.readFileSync(file, "utf8");
  res.json({ logs: content.slice(-20000) });
});
app.delete("/api/projects/:id", (req, res) => {
  const id = req.params.id;
  if (!safeId(id)) return res.status(400).json({ error: "ID inválido." });
  const job = jobs.get(id);
  if (job && job.child.exitCode === null) return res.status(409).json({ error: "Detén el bot antes de eliminarlo." });
  fs.rmSync(path.join(PROJECTS, id), { recursive: true, force: true });
  fs.rmSync(path.join(LOGS, id + ".log"), { force: true });
  jobs.delete(id);
  res.json({ ok: true });
});
app.listen(PORT, HOST, () => console.log("[NEXUS ENGINE] API local en http://" + HOST + ":" + PORT));
