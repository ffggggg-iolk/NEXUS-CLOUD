const express = require("express");
const helmet = require("helmet");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "NEXUS CLOUD", status: "online" });
});

app.get("/api/overview", (_req, res) => {
  res.json({
    service: "NEXUS CLOUD",
    status: " 준비 ",
    projects: 0,
    running: 0,
    note: "Worker and persistent storage are not configured yet."
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[NEXUS CLOUD] Panel listening on port ${PORT}`);
});
