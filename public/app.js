const AUTH_URL = "https://accounts.birdmug.com";
const APP_POLL_MS = 60000;
const STATUS_POLL_MS = 30000;
const BUGS_POLL_MS = 300000;

let appTimer = null;
let statusTimer = null;
let bugsTimer = null;

const els = {
  body: document.body,
  adminTabBtn: document.getElementById("admin-tab-btn"),
  adminAccessGate: document.getElementById("admin-access-gate"),
  adminTelemetry: document.getElementById("admin-telemetry"),
  adminGateBack: document.getElementById("admin-gate-back"),
  gateLoginForm: document.getElementById("gate-login-form"),
  gateLoginUser: document.getElementById("gate-login-user"),
  gateLoginPass: document.getElementById("gate-login-pass"),
  gateLoginError: document.getElementById("gate-login-error"),
  requestAccessForm: document.getElementById("request-access-form"),
  requestAccessStatus: document.getElementById("request-access-status"),
  signinBtn: document.getElementById("signin-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  navUserWrap: document.getElementById("nav-user-wrap"),
  navUser: document.getElementById("nav-user"),
  sessionUsername: document.getElementById("session-username"),
  heroAdminBtn: document.getElementById("hero-admin-btn"),
  tabApps: document.getElementById("tab-apps"),
  tabAdmin: document.getElementById("tab-admin"),
  errorBanner: document.getElementById("error-banner"),
  heroInlineStatus: document.getElementById("hero-inline-status"),
  heroSignalGrid: document.getElementById("hero-signal-grid"),
  appCards: document.getElementById("app-cards"),
  infraCards: document.getElementById("infra-cards"),
  stats: document.getElementById("stats"),
  containerPanel: document.getElementById("container-panel"),
  bugsPanel: document.getElementById("bugs-panel"),
};

document.querySelectorAll(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});

els.signinBtn.addEventListener("click", showLogin);
els.logoutBtn.addEventListener("click", () => doLogout());
els.heroAdminBtn.addEventListener("click", () => switchTab("admin"));
els.adminGateBack.addEventListener("click", () => switchTab("apps"));
els.gateLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void doLogin();
});
els.requestAccessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void doRequestAccess();
});

function getToken() {
  const token = localStorage.getItem("bm_token");
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem("bm_token");
      localStorage.removeItem("bm_username");
      return null;
    }
  } catch {
    return null;
  }
  return token;
}

function getUsername() {
  return localStorage.getItem("bm_username") || "";
}

function updateAuthUI() {
  const token = getToken();
  const username = getUsername();
  const isAuthed = Boolean(token);

  els.signinBtn.hidden = isAuthed;
  els.logoutBtn.hidden = !isAuthed;
  els.navUserWrap.hidden = !isAuthed;
  els.navUser.textContent = username;
  els.sessionUsername.textContent = isAuthed ? username : "Not signed in";
  els.adminTabBtn.hidden = !isAuthed;
  els.heroAdminBtn.hidden = !isAuthed;
  syncAdminAccessState();
}

function showLogin() {
  // Temporarily show admin tab for the login gate
  els.adminTabBtn.hidden = false;
  switchTab("admin");
  els.gateLoginError.textContent = "";
  els.requestAccessStatus.textContent = "";
  window.setTimeout(() => els.gateLoginUser.focus(), 20);
}

async function doLogin() {
  const user = els.gateLoginUser.value.trim();
  const pass = els.gateLoginPass.value;

  els.gateLoginError.textContent = "";
  if (!user || !pass) {
    els.gateLoginError.textContent = "Enter username and password.";
    return;
  }

  try {
    const response = await fetch(`${AUTH_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
    });
    const data = await response.json();

    if (!response.ok) {
      els.gateLoginError.textContent = data.error || "Login failed.";
      return;
    }

    localStorage.setItem("bm_token", data.token);
    localStorage.setItem("bm_username", data.username);
    updateAuthUI();
    switchTab("admin");
    void loadStatus();
    void loadBugs();
  } catch {
    els.gateLoginError.textContent = "Cannot reach login server.";
  }
}

async function doRequestAccess() {
  const name = document.getElementById("request-name").value.trim();
  const contact = document.getElementById("request-contact").value.trim();
  const reason = document.getElementById("request-reason").value.trim();
  const statusEl = els.requestAccessStatus;

  statusEl.textContent = "";
  if (!name || !contact) {
    statusEl.textContent = "Name and contact are required.";
    return;
  }

  try {
    const response = await fetch("/api/request-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contact, reason }),
    });
    const data = await response.json();
    if (!response.ok) {
      statusEl.textContent = data.error || "Request failed.";
      return;
    }
    statusEl.style.color = "var(--green)";
    statusEl.textContent = "Request sent. You will be contacted when approved.";
    els.requestAccessForm.reset();
  } catch {
    statusEl.textContent = "Cannot reach server.";
  }
}

function doLogout() {
  localStorage.removeItem("bm_token");
  localStorage.removeItem("bm_username");
  clearTimeout(appTimer);
  clearTimeout(statusTimer);
  clearTimeout(bugsTimer);
  appTimer = null;
  statusTimer = null;
  bugsTimer = null;
  updateAuthUI();
  switchTab("apps");
  resetAdminPanels();
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  const adminActive = tab === "admin";
  els.body.dataset.activeTab = tab;
  els.tabApps.hidden = adminActive;
  els.tabAdmin.hidden = !adminActive;

  if (adminActive && getToken()) {
    if (!statusTimer) pollStatus();
    if (!bugsTimer) pollBugs();
  } else {
    clearTimeout(statusTimer);
    clearTimeout(bugsTimer);
    statusTimer = null;
    bugsTimer = null;
    syncAdminAccessState();
  }
}

function syncAdminAccessState() {
  const isAuthed = Boolean(getToken());
  els.adminAccessGate.hidden = isAuthed;
  els.adminTelemetry.hidden = !isAuthed;
}

async function pollApps() {
  await loadApps();
  appTimer = setTimeout(pollApps, APP_POLL_MS);
}

async function pollStatus() {
  await loadStatus();
  if (getToken()) statusTimer = setTimeout(pollStatus, STATUS_POLL_MS);
}

async function pollBugs() {
  await loadBugs();
  if (getToken()) bugsTimer = setTimeout(pollBugs, BUGS_POLL_MS);
}

async function loadApps() {
  try {
    const response = await fetch("/api/apps");
    const data = await response.json();
    const apps = (data.apps || []).filter((app) => app.category === "app");
    const infra = (data.apps || []).filter((app) => app.category !== "app");
    const totalOnline = data.apps ? data.apps.filter((app) => app.up).length : 0;
    const totalServices = data.apps ? data.apps.length : 0;

    if (data.error) {
      showError(data.error);
    } else {
      hideError();
    }

    els.appCards.innerHTML = renderServiceCards(apps, "Products");
    els.infraCards.innerHTML = renderServiceCards(infra, "Infrastructure");
    renderHeroSignals(apps, infra, totalOnline, totalServices);
  } catch (error) {
    showError(`Error: ${error.message}`);
    els.heroInlineStatus.textContent = "Registry unavailable";
    els.heroInlineStatus.className = "hero-inline-status down";
    els.appCards.innerHTML = renderEmptyState("Unable to load public services.");
    els.infraCards.innerHTML = renderEmptyState("Unable to load infrastructure services.");
  }
}

function renderHeroSignals(apps, infra, totalOnline, totalServices) {
  const appOnline = apps.filter((app) => app.up).length;
  const infraOnline = infra.filter((app) => app.up).length;
  const heroClass = totalOnline === totalServices ? "ok" : totalOnline > 0 ? "warn" : "down";

  els.heroInlineStatus.className = `hero-inline-status ${heroClass}`;
  els.heroInlineStatus.textContent = `${totalOnline}/${totalServices} services online`;

  els.heroSignalGrid.innerHTML = [
    renderSignalCard("Registry", String(totalServices), "Tracked services"),
    renderSignalCard("Products", `${appOnline}/${apps.length}`, "Live public applications"),
    renderSignalCard("Infrastructure", `${infraOnline}/${infra.length}`, "Ops services online"),
    renderSignalCard("Access", getToken() ? "Operator" : "Public", getToken() ? "Runtime telemetry unlocked" : "Auth required for admin"),
  ].join("");
}

function renderSignalCard(label, value, detail) {
  return `
    <article class="signal-card">
      <span class="signal-label">${esc(label)}</span>
      <strong class="signal-value">${esc(value)}</strong>
      <span class="signal-detail">${esc(detail)}</span>
    </article>
  `;
}

function renderServiceCards(apps, groupLabel) {
  if (!apps.length) {
    return renderEmptyState(`No ${groupLabel.toLowerCase()} found.`);
  }

  return apps.map((app) => {
    const hasUrl = Boolean(app.url);
    const url = hasUrl ? safeUrl(app.url) : "";
    const host = hasUrl ? getHostname(app.url) : "Internal service";
    const statusClass = app.up ? "ok" : "down";
    const statusText = app.up ? "Online" : "Degraded";

    return `
      <article class="service-card">
        <div class="service-card-head">
          <div>
            <span class="service-kicker">${esc(app.category === "app" ? "Product" : "Infrastructure")}</span>
            <h3 class="service-title">${esc(app.name)}</h3>
          </div>
          <span class="service-state ${statusClass}">${statusText}</span>
        </div>
        <p class="service-description">${esc(app.description)}</p>
        <div class="service-meta-line">
          <span class="service-domain">${esc(host)}</span>
          <span class="service-category-pill">${esc(groupLabel)}</span>
        </div>
        <div class="service-card-footer">
          <div class="service-links">
            ${hasUrl ? `<a class="btn btn-secondary service-link link-arrow" href="${url}" target="_blank" rel="noopener">Open service</a>` : ""}
            ${app.itch ? `<a class="btn btn-ghost service-link link-arrow" href="${safeUrl(app.itch)}" target="_blank" rel="noopener">itch.io</a>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status", {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    });

    if (response.status === 401) {
      doLogout();
      return;
    }

    const data = await response.json();
    if (!data.ok) {
      els.stats.innerHTML = renderPanelError(data.error || "Cannot load dashboard.");
      resetContainerPanel(data.error || "Cannot load container map.");
      return;
    }

    renderStats(data);
    renderProjects(data.projects || []);
  } catch (error) {
    els.stats.innerHTML = renderPanelError(`Dashboard error: ${error.message}`);
    resetContainerPanel("Cannot reach runtime status.");
  }
}

function renderStats(data) {
  const loadClass = data.load < 1.5 ? "ok" : data.load < 3 ? "warn" : "down";

  const cards = [
    renderMetricCard("Uptime", data.uptime, "Host availability"),
    renderMetricCard("Load (1m)", data.load ?? "-", "Current system pressure", loadClass),
    renderMetricCard("Memory", data.mem.used, `${data.mem.available} free / ${data.mem.total} total`),
    renderMetricCard("Disk", data.disk.pct, `${data.disk.used} used / ${data.disk.size} total`),
    renderTempCard(data.temp),
  ];

  els.stats.innerHTML = cards.join("");
}

function renderTempCard(temp) {
  if (!temp || !Number.isFinite(temp.cpu_c)) {
    return renderMetricCard("CPU Temp", "-", "Sensor unavailable");
  }
  const crit = temp.crit_c || 100;
  // Warn >= 75% of crit; danger >= 90% of crit. On a 100°C crit, that's 75°C / 90°C.
  const ratio = temp.cpu_c / crit;
  const cls = ratio >= 0.9 ? "down" : ratio >= 0.75 ? "warn" : "ok";
  return renderMetricCard(
    "CPU Temp",
    `${temp.cpu_c}°C`,
    `Critical at ${crit}°C`,
    cls
  );
}

function renderMetricCard(label, value, detail, stateClass = "") {
  const valueClass = stateClass ? `metric-value ${stateClass}` : "metric-value";
  return `
    <article class="metric-card">
      <span class="metric-label">${esc(label)}</span>
      <strong class="${valueClass}">${esc(String(value))}</strong>
      <span class="metric-subtext">${esc(detail)}</span>
    </article>
  `;
}

function renderProjects(projects) {
  const body = !projects.length
    ? renderEmptyState("No project groups available.")
    : projects.map((project) => {
      const statuses = project.containers || [];
      const upCount = statuses.filter((container) => container.up).length;
      const unknownCount = statuses.filter((container) => container.status === null).length;
      const statusClass = unknownCount === statuses.length
        ? "warn"
        : upCount === statuses.length
          ? "ok"
          : upCount > 0
            ? "warn"
            : "down";
      const statusLabel = unknownCount === statuses.length
        ? "Unknown"
        : `${upCount}/${statuses.length} up`;

      return `
        <article class="project-card">
          <div class="project-topline">
            <div>
              <div class="project-name">${esc(project.name)}</div>
              <div class="project-meta">${esc(project.url || "No public URL")}</div>
            </div>
            <span class="project-status-pill ${statusClass}">${esc(statusLabel)}</span>
          </div>
          <div class="container-list">
            ${statuses.map((container) => renderContainerRow(container)).join("")}
          </div>
        </article>
      `;
    }).join("");

  els.containerPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="section-tag">Runtime</p>
        <h3>Containers</h3>
      </div>
    </div>
    <div class="panel-body">${body}</div>
  `;
}

function renderContainerRow(container) {
  const chipClass = container.status === null
    ? "unknown"
    : container.up
      ? "ok"
      : "down";
  const short = shortStatus(container.status);
  return `
    <div class="container-row">
      <div>
        <span class="container-name">${esc(container.name)}</span>
        <div class="container-meta">${esc(short)}</div>
      </div>
      <span class="container-status-chip ${chipClass}">${esc(short)}</span>
    </div>
  `;
}

async function loadBugs() {
  try {
    const response = await fetch("/api/bugs", {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    });

    if (response.status === 401) {
      doLogout();
      return;
    }

    const data = await response.json();
    const reports = data.reports || [];

    if (!reports.length) {
      resetBugPanel(data.error || "No bugs reported.");
      return;
    }

    els.bugsPanel.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-tag">Incident Flow</p>
          <h3>Recent Bugs</h3>
        </div>
      </div>
      <div class="panel-body">
        ${reports.map((report) => renderBug(report)).join("")}
      </div>
    `;
  } catch {
    resetBugPanel("Cannot load bugs.");
  }
}

function renderBug(report) {
  const issueUrl = safeUrl(report.github_url || `https://bugs.birdmug.com/reports/${report.id}`);
  const issueStatusClass = report.status === "open" ? "open" : "closed";
  return `
    <article class="bug-item">
      <a class="bug-link link-arrow" href="${issueUrl}" target="_blank" rel="noopener">${esc(report.title)}</a>
      <div class="bug-meta">
        <span class="issue-app-pill">${esc(report.app)}</span>
        <span class="issue-status ${issueStatusClass}">${esc(report.status)}</span>
        <span class="issue-link-note">${esc(timeAgo(report.created_at))}</span>
      </div>
    </article>
  `;
}

function showError(message) {
  els.errorBanner.hidden = false;
  els.errorBanner.textContent = message;
}

function hideError() {
  els.errorBanner.hidden = true;
  els.errorBanner.textContent = "";
}

function renderEmptyState(message) {
  return `<div class="empty-state">${esc(message)}</div>`;
}

function renderPanelError(message) {
  return `<article class="metric-card"><span class="metric-label">Status</span><strong class="metric-value down">Unavailable</strong><span class="metric-subtext">${esc(message)}</span></article>`;
}

function resetAdminPanels() {
  els.stats.innerHTML = `
    <article class="metric-card skeleton-card tall"></article>
    <article class="metric-card skeleton-card tall"></article>
    <article class="metric-card skeleton-card tall"></article>
    <article class="metric-card skeleton-card tall"></article>
    <article class="metric-card skeleton-card tall"></article>
  `;
  resetContainerPanel("Sign in to view container telemetry.");
  resetBugPanel("Sign in to view recent bug reports.");
}

function resetContainerPanel(message) {
  els.containerPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="section-tag">Runtime</p>
        <h3>Containers</h3>
      </div>
    </div>
    <div class="panel-body">${renderEmptyState(message)}</div>
  `;
}

function resetBugPanel(message) {
  els.bugsPanel.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="section-tag">Incident Flow</p>
        <h3>Recent Bugs</h3>
      </div>
    </div>
    <div class="panel-body">${renderEmptyState(message)}</div>
  `;
}

function shortStatus(status) {
  if (!status) {
    return "not running";
  }
  const match = status.match(/Up (.+?)( \(|$)/);
  return match ? `Up ${match[1]}` : status;
}

function timeAgo(dateStr) {
  if (!dateStr) {
    return "Unknown time";
  }
  const date = new Date(dateStr.endsWith("Z") ? dateStr : `${dateStr}Z`);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);

  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function safeUrl(url) {
  try {
    return new URL(url).toString();
  } catch {
    return "#";
  }
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

updateAuthUI();
resetAdminPanels();
pollApps();
