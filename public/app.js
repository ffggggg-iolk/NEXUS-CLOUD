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
  } catch {
    loginScreen.hidden = false;
  }
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
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#logout").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  dashboard.hidden = true;
  loginScreen.hidden = false;
});

$("#upload-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#upload-message");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  message.textContent = "Subiendo y verificando ZIP…";
  try {
    const form = new FormData(event.currentTarget);
    const result = await api("/api/projects", { method: "POST", body: form });
    message.textContent = result.message;
    event.currentTarget.reset();
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function refresh() {
  try {
    const [overview, projects] = await Promise.all([api("/api/overview"), api("/api/projects")]);
    $("#projects-count").textContent = overview.projects;
    $("#running-count").textContent = overview.running;
    $("#status").textContent = "Online";
    const list = $("#project-list");
    list.replaceChildren();
    if (!projects.projects.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = "<div class='empty-icon'>⌘</div><h3>Aún no hay proyectos</h3><p>Sube un ZIP para guardarlo en tu espacio privado.</p>";
      list.append(empty);
      return;
    }
    for (const project of projects.projects) {
      const card = document.createElement("article");
      card.className = "project-card";
      const info = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = project.name;
      const detail = document.createElement("p");
      detail.textContent = project.original_name + " · " + (project.size / 1024 / 1024).toFixed(2) + " MB";
      const status = document.createElement("span");
      status.className = "tag";
      status.textContent = "GUARDADO · WORKER PENDIENTE";
      info.append(title, detail, status);
      const remove = document.createElement("button");
      remove.className = "danger-button";
      remove.textContent = "Eliminar";
      remove.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este proyecto y su archivo ZIP?")) return;
        try { await api("/api/projects/" + encodeURIComponent(project.id), { method: "DELETE" }); await refresh(); }
        catch (error) { alert(error.message); }
      });
      card.append(info, remove);
      list.append(card);
    }
  } catch (error) {
    $("#status").textContent = "Error";
  }
}

checkSession();
