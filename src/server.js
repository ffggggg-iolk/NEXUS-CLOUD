const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const multer = require("multer");
const yauzl = require("yauzl");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { promisify } = require("util");
const nexusLink = require("./nexus-link");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const TEMP_DIR = path.join(DATA_DIR, "tmp");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

for (const dir of [DATA_DIR, TEMP_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });
if (ADMIN_PASSWORD.length < 12) {
  console.error("[NEXUS CLOUD] Set ADMIN_PASSWORD to a password with at least 12 characters.");
  process.exit(1);
}
if (SESSION_SECRET.length < 32) {
  console.error("[NEXUS CLOUD] Set SESSION_SECRET to a random value of at least 32 characters.");
  process.exit(1);
}

const db = new Database(path.join(DATA_DIR, "nexus.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL
  );
`);

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(session({
  name: "nexus.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const loginLimiter = require("express-rate-limit").rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera 15 minutos." }
});

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) return next();
  return res.status(401).json({ error: "Inicia sesión para continuar." });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validateZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(new Error("El archivo no es un ZIP válido."));
      let count = 0;
      let total = 0;
      zip.readEntry();
      zip.on("entry", entry => {
        count += 1;
        total += Number(entry.uncompressedSize || 0);
        const name = entry.fileName;
        const normalized = path.posix.normalize(name.replace(/\\/g, "/"));
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (
          count > 1000 ||
          total > 200 * 1024 * 1024 ||
          name.startsWith("/") ||
          /^[a-zA-Z]:/.test(name) ||
          normalized === ".." ||
          normalized.startsWith("../") ||
          name.includes("\\") ||
          mode === 0o120000 ||
          (entry.uncompressedSize > 1024 * 1024 && entry.compressedSize > 0 &&
            entry.uncompressedSize / entry.compressedSize > 100)
        ) {
          zip.close();
          return reject(new Error("El ZIP contiene rutas o tamaños no permitidos."));
        }
        zip.readEntry();
      });
      zip.on("end", () => resolve({ entries: count, uncompressedBytes: total }));
      zip.on("error", () => reject(new Error("No se pudo comprobar el ZIP.")));
    });
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "NEXUS CLOUD", status: "online", worker: "not_configured" });
});

app.post("/api/login", loginLimiter, (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== "string" || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Contraseña incorrecta." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "No se pudo iniciar sesión." });
    req.session.authenticated = true;
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: "No se pudo guardar la sesión." });
      res.json({ ok: true });
    });
  });
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("nexus.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => res.json({ authenticated: req.session?.authenticated === true }));

app.get("/api/overview", requireAuth, (_req, res) => {
  const projects = db.prepare("SELECT COUNT(*) AS count FROM projects").get().count;
  const link = nexusLink.status();
  res.json({
    service: "NEXUS CLOUD",
    projects,
    running: link.projects.filter(project => project.status === "running").length,
    worker: link.deviceOnline ? "online" : "offline",
    device: link.device,
    note: link.deviceOnline ? "Dispositivo conectado mediante NEXUS LINK." : "El dispositivo todavía no está disponible."
  });
});

app.get("/api/device/status", requireAuth, (_req, res) => {
  res.json(nexusLink.status());
});

app.post("/api/device/refresh", requireAuth, async (_req, res) => {
  try {
    const result = await nexusLink.request({ type: "status.request" });
    res.json({ ok: true, device: nexusLink.status(), projects: result.projects || [] });
  } catch (error) {
    res.status(503).json({ error: error.message, device: nexusLink.status() });
  }
});

app.post("/api/device/projects/:id/:action", requireAuth, async (req, res) => {
  const { id, action } = req.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ error: "ID de proyecto inválido." });
  const types = { start: "project.start", stop: "project.stop", restart: "project.restart", logs: "logs.request" };
  const type = types[action];
  if (!type) return res.status(404).json({ error: "Acción no permitida." });
  try {
    const result = await nexusLink.request({ type, projectId: id }, action === "logs" ? 15000 : 20000);
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.get("/api/projects", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT id, name, original_name, size, status, created_at FROM projects ORDER BY created_at DESC").all();
  res.json({ projects: rows });
});

app.post("/api/projects", requireAuth, upload.single("archive"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Selecciona un archivo ZIP." });
  const tempPath = req.file.path;
  try {
    if (path.extname(req.file.originalname).toLowerCase() !== ".zip") {
      throw new Error("Solo se permiten archivos .zip.");
    }
    await validateZip(tempPath);
    const id = crypto.randomUUID();
    const storedName = id + ".zip";
    const finalPath = path.join(UPLOAD_DIR, storedName);
    fs.renameSync(tempPath, finalPath);
    const requestedName = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 60) : "";
    const name = requestedName || path.basename(req.file.originalname, ".zip").slice(0, 60) || "Proyecto";
    db.prepare("INSERT INTO projects (id, name, original_name, stored_name, size, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, name, req.file.originalname.slice(0, 180), storedName, req.file.size, "queued", new Date().toISOString());
    res.status(201).json({ ok: true, project: { id, name, status: "queued" }, message: "ZIP guardado. El worker todavía no está conectado." });
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    res.status(400).json({ error: err.message || "No se pudo guardar el proyecto." });
  }
});

app.delete("/api/projects/:id", requireAuth, (req, res) => {
  const project = db.prepare("SELECT stored_name FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });
  const filePath = path.join(UPLOAD_DIR, path.basename(project.stored_name));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "El ZIP supera el límite de 50 MB." : "No se pudo recibir el archivo." });
  }
  console.error("[NEXUS CLOUD] Request error:", err.message);
  res.status(500).json({ error: "Error interno del servidor." });
});

app.use(express.static(path.join(ROOT, "public")));
app.get("*", (_req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("[NEXUS CLOUD] Panel escuchando en el puerto " + PORT);
  nexusLink.start();
});
process.on("SIGTERM", () => { nexusLink.stop(); server.close(); });
process.on("SIGINT", () => { nexusLink.stop(); server.close(); });
