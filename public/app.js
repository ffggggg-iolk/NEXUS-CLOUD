const $ = selector => document.querySelector(selector);
const loginScreen = $("#login-screen");
const dashboard = $("#dashboard");

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Ha ocurrido un error.");
  return data;
}

function showDashboard() {
  loginScreen.hidden = true;
  dashboard.hidden = false;
  refresh();
}

async function checkSession() {
  try {
    const data = await api("/api/me");
    if (data.authenticated) showDashboard();
    else loginScreen.hidden = false;
  } catch { loginScreen.hidden = false; }
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("#login-error").textContent = "Comprobando acceso…";
  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("#password").value })
    });
    $("#password").value = "";
    $("#login-error").textContent = "";
    showDashboard();
  } catch (error) { $("#login-error").textContent = error.message; }
});

$("#logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  dashboard.hidden = true;
  loginScreen.hidden = false;
});

async function projectAction(projectId, action) {
  try {
    const result = await api("/api/device/projects/" + encodeURIComponent(projectId) + "/" + action, { method: "POST" });
    if (action === "logs") {
      const logs = typeof result.logs === "string" ? result.logs : JSON.stringify(result, null, 2);
      alert(logs || "Todavía no hay registros.");
    }
    await refresh();
  } catch (error) { alert(error.message); }
}

async function refresh() {
  try {
    const [overview, projects] = await Promise.all([api("/api/overview"), api("/api/projects")]);
    $("#projects-count").textContent = overview.projects;
    $("#running-count").textContent = overview.running;
    $("#status").textContent = overview.worker === "online" ? "Conectado" : "Desconectado";
    $("#status").classList.toggle("online", overview.worker === "online");
    const list = $("#project-list");
    list.replaceChildren();
    if (!projects.projects.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = "<div class='empty-icon'>⌘</div><h3>Aún no hay proyectos</h3><p>Tu dispositivo está conectado, pero todavía no hay bots instalados en NEXUS ENGINE.</p>";
      list.append(empty);
      return;
    }
    for (const project of projects.projects) {
      const card = document.createElement("article");
      card.className = "project-card";
      const info = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = project.name || project.id;
      const detail = document.createElement("p");
      detail.textContent = "ID: " + project.id;
      const status = document.createElement("span");
      status.className = "tag";
      status.textContent = project.status === "running" ? "EN EJECUCIÓN" : "DETENIDO";
      info.append(title, detail, status);
      const actions = document.createElement("div");
      actions.className = "project-actions";
      for (const [action, label] of [["start","Iniciar"],["stop","Detener"],["restart","Reiniciar"],["logs","Registros"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => projectAction(project.id, action));
        actions.append(button);
      }
      card.append(info, actions);
      list.append(card);
    }
  } catch (error) {
    $("#status").textContent = "Error";
    $("#status").classList.remove("online");
  }
}

checkSession();
