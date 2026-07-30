// Supabase Edge Function: delete the calling user's own account.
//
// Deploy with:
//   supabase functions deploy delete-account
//
// (Note: NO --no-verify-jwt here. Unlike the Stripe webhook, this endpoint is
// called by the browser with a signed-in session, and every request must carry
// a valid user JWT.)
//
// Secrets — the same ones the Stripe webhook already uses, so if that function
// is deployed there is nothing new to set:
//   supabase secrets set SUPABASE_URL=https://<your-project>.supabase.co
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
//
// Why a function at all: deleting an auth user requires the admin API, which
// requires the service-role key. That key must never reach the browser, so the
// deletion has to happen server-side.
//
// Security model: the user id is taken from the verified JWT, never from the
// request body. A caller can therefore only ever delete themselves — there is
// no parameter to point this at somebody else's account.
//
// The memberships row is removed by the `on delete cascade` on
// memberships.user_id (see schema.sql), so deleting the auth user is enough.
// Any Stripe subscription is NOT cancelled here — see the note below.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Browsers preflight this call, so CORS has to be answered explicitly.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing Authorization header" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // Resolve the caller from their JWT. This is the only source of the user id.
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json({ error: "Invalid or expired session" }, 401);
  }
  const userId = userData.user.id;

  // Delete the membership row explicitly as well as relying on the cascade, so
  // the outcome is the same even if the FK is ever changed.
  const { error: memErr } = await admin.from("memberships").delete().eq("user_id", userId);
  if (memErr) console.warn("membership row delete failed (continuing):", memErr.message);

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error("deleteUser failed:", delErr.message);
    return json({ error: "Could not delete account" }, 500);
  }

  console.log("deleted account", userId);
  return json({ ok: true });
});
