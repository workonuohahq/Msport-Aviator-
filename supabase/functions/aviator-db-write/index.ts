import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!supabaseUrl || !serviceKey) return json(503, { error: "database_write_proxy_unavailable" });
  const supplied = req.headers.get("x-engine-write-key") ?? "";
  if (supplied.length < 64 || supplied.length > 256) return json(401, { error: "unauthorized" });
  const { data: secretRecord, error: secretError } = await supabase.from("integration_secrets").select("secret_sha256").eq("name", "vercel_write_proxy").maybeSingle();
  if (secretError || !secretRecord?.secret_sha256) return json(503, { error: "write_proxy_not_configured" });
  if (!constantTimeEqual(await sha256Hex(supplied), secretRecord.secret_sha256)) return json(401, { error: "unauthorized" });
  let input: any;
  try { input = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const table = input?.table;
  const method = input?.method;
  const query = input?.query && typeof input.query === "object" && !Array.isArray(input.query) ? input.query : {};
  const body = input?.body;
  const prefer = typeof input?.prefer === "string" ? input.prefer : "";
  const validPatchId = typeof query.id === "string" && query.id.startsWith("eq.") && /^\d+$/.test(query.id.slice(3));
  const allowed =
    (table === "ingestion_runs" && method === "POST" && Object.keys(query).length === 0 && body && !Array.isArray(body)) ||
    (table === "game_rounds" && method === "POST" && query.on_conflict === "provider,game_code,external_round_id" && Object.keys(query).length === 1 && Array.isArray(body) && body.length >= 1 && body.length <= 500) ||
    (table === "ingestion_runs" && method === "PATCH" && Object.keys(query).length === 1 && validPatchId && body && !Array.isArray(body));
  if (!allowed) return json(400, { error: "operation_not_allowed" });
  const base = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl;
  const url = new URL(base + "/rest/v1/" + table);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  try {
    const response = await fetch(url, {
      method,
      headers: { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch {
    return json(502, { error: "database_write_failed" });
  }
});