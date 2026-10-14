const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 10000);
const ROOT = path.join(__dirname, "public");
const DATA_MODE = process.env.DATA_SOURCE_MODE || "demo";

const thresholds = [1.2, 1.5, 2, 3, 5, 10];
const demoRoundMultipliers = [];
const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function theoreticalProbability(target, rtp = 0.97) {
  if (!Number.isFinite(target) || target < 1) return null;
  return Math.max(0, Math.min(1, rtp / target));
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "msport-aviator-engine", mode: DATA_MODE, timestamp: new Date().toISOString() });
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, {
      service: "MSport Aviator Statistical Engine",
      mode: DATA_MODE,
      sourceConnected: false,
      sourceStatus: "not_configured",
      predictionStatus: "baseline_only",
      accuracyClaim: null,
      lastRoundAt: null,
      notes: ["No authorised MSport/Scribe live feed has been verified or configured.", "No live rounds are being fabricated.", "Theoretical figures are illustrative and are not verified MSport odds."]
    });
  }
  if (req.method === "GET" && url.pathname === "/api/overview") {
    return json(res, 200, { roundsStored: 0, sourceConnected: false, model: "theoretical-baseline", lastUpdate: null, mode: DATA_MODE });
  }
  if (req.method === "GET" && url.pathname === "/api/rounds") {
    return json(res, 200, { data: [], count: 0, sourceConnected: false, message: "No verified round-history feed is connected." });
  }
  if (req.method === "GET" && url.pathname === "/api/probabilities") {
    const rtp = 0.97;
    const rows = thresholds.map(target => ({
      target,
      probability: theoreticalProbability(target, rtp),
      percent: Number((theoreticalProbability(target, rtp) * 100).toFixed(2)),
      basis: "illustrative_theoretical_baseline",
      sampleSize: 0
    }));
    return json(res, 200, {
      assumptions: { payoutFactor: rtp, verifiedForMsport: false },
      rows,
      warning: "Illustrative model only. Confirm the actual game rules and payout factor before relying on these values."
    });
  }
  if (req.method === "GET" && url.pathname === "/api/alerts") {
    return json(res, 200, {
      alerts: [{ type: "data_source", severity: "warning", title: "Live data not connected", message: "Verify the MSport game provider and obtain an authorised results feed before enabling live alerts.", createdAt: new Date().toISOString() }],
      count: 1
    });
  }
  if (req.method === "GET") return serveStatic(res, url.pathname);
  res.writeHead(405, { Allow: "GET" }); res.end("Method not allowed");
});

server.listen(PORT, "0.0.0.0", () => console.log(`Aviator engine listening on ${PORT}; mode=${DATA_MODE}`));