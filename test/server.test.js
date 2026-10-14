const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const port = 12000 + (process.pid % 20000);
const base = "http://127.0.0.1:" + port;
let child;

before(async () => {
  const env = { ...process.env, PORT: String(port), DATA_SOURCE_MODE: "test" };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.INGESTION_API_KEY;
  child = spawn(process.execPath, ["server.js"], { env, stdio: "ignore" });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + "/health", { signal: AbortSignal.timeout(500) });
      if (r.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "server should start and expose health endpoint");
});

after(() => {
  if (child && !child.killed) child.kill("SIGTERM");
});

test("health is explicit that live provider is not connected", async () => {
  const r = await fetch(base + "/health");
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.database, "not_configured");
  assert.equal(body.liveProviderConnected, false);
});

test("round endpoint never invents results", async () => {
  const r = await fetch(base + "/api/rounds");
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.count, 0);
});

test("probability endpoint does not emit unsupported estimates", async () => {
  const r = await fetch(base + "/api/probabilities");
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(body.rows, []);
  assert.match(body.warning, /No verified historical data/);
});

test("ingestion fails closed without secrets", async () => {
  const r = await fetch(base + "/api/ingest/rounds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "test", source_verified: true, rounds: [{ round_id: "x", multiplier: 2 }] })
  });
  assert.equal(r.status, 503);
});

test("security headers are set", async () => {
  const r = await fetch(base + "/health");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.match(r.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
});

test("unsupported methods are rejected", async () => {
  const r = await fetch(base + "/health", { method: "POST" });
  assert.equal(r.status, 405);
});
