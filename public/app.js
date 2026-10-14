const $ = (selector) => document.querySelector(selector);
const fmtPercent = (n) => `${Number(n).toFixed(2)}%`;

async function getJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${path}`);
  return response.json();
}

function renderProbabilities(rows) {
  const chart = $("#probability-chart");
  const table = $("#probability-table");
  if (!rows || !rows.length) {
    chart.innerHTML = '<div class="chart-empty">No probability estimates available.</div>';
    table.innerHTML = "";
    return;
  }
  chart.innerHTML = rows.map(row => {
    const height = Math.max(4, Math.min(100, row.percent));
    return `<div class="bar-group" title="${row.target}× target: ${fmtPercent(row.percent)}"><div class="bar" style="height:${height}%"></div><div class="bar-label">${row.target}×</div></div>`;
  }).join("");
  table.innerHTML = rows.map(row =>
    `<div class="prob-cell"><small>${row.target}× TARGET</small><b>${fmtPercent(row.percent)}</b></div>`
  ).join("");
}

function renderAlerts(data) {
  const alerts = data.alerts || [];
  $("#alert-count").textContent = String(alerts.length);
  $("#alert-list").innerHTML = alerts.length ? alerts.map(alert => `
    <div class="alert-item">
      <div class="alert-icon">!</div>
      <div><b>${escapeHtml(alert.title || alert.type || "System alert")}</b>
      <p>${escapeHtml(alert.message || "")}</p>
      <time>${new Date(alert.createdAt || Date.now()).toLocaleString()}</time></div>
    </div>`).join("") : '<div class="chart-empty">No active alerts.</div>';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

async function refreshDashboard() {
  $("#refresh").disabled = true;
  try {
    const [status, overview, probabilities, alerts] = await Promise.all([
      getJson("/api/status"), getJson("/api/overview"),
      getJson("/api/probabilities"), getJson("/api/alerts")
    ]);
    $("#round-count").textContent = String(overview.roundsStored ?? 0);
    $("#provider-state").textContent = status.sourceConnected ? "Connected" : "Unverified";
    renderProbabilities(probabilities.rows);
    renderAlerts(alerts);
    $("#updated").textContent = "Updated " + new Date().toLocaleTimeString();
  } catch (error) {
    $("#updated").textContent = "API unavailable";
    $("#alert-list").innerHTML = '<div class="chart-empty">Could not load system status. Retry in a moment.</div>';
  } finally {
    $("#refresh").disabled = false;
  }
}

$("#refresh").addEventListener("click", refreshDashboard);
refreshDashboard();
setInterval(refreshDashboard, 60000);