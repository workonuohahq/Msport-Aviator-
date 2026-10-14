const $ = (selector) => document.querySelector(selector);
const fmtPercent = (n) => n == null || !Number.isFinite(Number(n)) ? "—" : `${Number(n).toFixed(2)}%`;
const fmtTime = (value) => value ? new Date(value).toLocaleString() : "Never";

async function getJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${path} (${response.status})`);
  return response.json();
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function renderProbabilities(rows) {
  const chart = $("#probability-chart"), table = $("#probability-table");
  if (!rows || !rows.length) {
    chart.innerHTML = '<div class="chart-empty">Waiting for at least 30 verified historical rounds.</div>';
    table.innerHTML = "";
    return;
  }
  chart.innerHTML = rows.map(row => {
    const height = Math.max(2, Math.min(100, Number(row.percent) || 0));
    return `<div class="bar-group" title="${row.target}× observed: ${fmtPercent(row.percent)}"><div class="bar" style="height:${height}%"></div><div class="bar-label">${row.target}×</div></div>`;
  }).join("");
  table.innerHTML = rows.map(row => `
    <div class="prob-cell"><small>${row.target}× OBSERVED</small><b>${fmtPercent(row.percent)}</b><small>95% interval ${fmtPercent(row.interval95Percent?.low)}–${fmtPercent(row.interval95Percent?.high)}</small></div>
  `).join("");
}
function renderAlerts(data) {
  const alerts = data.alerts || [];
  $("#alert-count").textContent = String(alerts.length);
  $("#alert-list").innerHTML = alerts.length ? alerts.map(alert => `
    <div class="alert-item"><div class="alert-icon">!</div><div><b>${escapeHtml(alert.title || alert.type || "System alert")}</b><p>${escapeHtml(alert.message || "")}</p><time>${escapeHtml(fmtTime(alert.createdAt))}</time></div></div>`
  ).join("") : '<div class="chart-empty">No active alerts.</div>';
}
async function refreshDashboard() {
  $("#refresh").disabled = true;
  try {
    const [status, overview, probabilities, alerts] = await Promise.all([
      getJson("/api/status"), getJson("/api/overview"),
      getJson("/api/probabilities"), getJson("/api/alerts")
    ]);
    $("#round-count").textContent = String(overview.verifiedRounds ?? overview.roundsStored ?? 0);
    $("#round-note").textContent = (overview.verifiedRounds ?? 0) >= 1000 ? "Large historical sample" : "Sample still developing";
    $("#live-state").textContent = status.sourceConnected ? "Connected" : "Unverified";
    $("#model-state").textContent = probabilities.rows?.length ? "Historical rates" : "Insufficient data";
    $("#provider-state").textContent = status.sourceConnected ? "Connected" : "Not verified";
    $("#history-state").textContent = String(overview.verifiedRounds ?? 0) + " verified rounds";
    $("#last-round-state").textContent = fmtTime(status.lastRoundAt);
    $("#source-pill").innerHTML = "<i></i> " + (status.sourceConnected ? "SOURCE CONNECTED" : "SOURCE NOT VERIFIED");
    $("#notice-title").textContent = status.database === "connected" ? "Database connected; provider feed still unverified" : "Live feed pending verification";
    $("#notice-copy").textContent = "Historical frequencies describe only the stored sample. They are not forecasts of the next multiplier.";
    renderProbabilities(probabilities.rows);
    $("#probability-warning").textContent = probabilities.warning || "Observed rates are descriptive, not predictive guarantees.";
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