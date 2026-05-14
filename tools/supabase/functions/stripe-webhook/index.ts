// Supabase Edge Function: Stripe webhook → memberships table.
//
// Deploy with:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Configure secrets:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase secrets set SUPABASE_URL=https://<your-project>.supabase.co
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
//
// Then in the Stripe Dashboard → Developers → Webhooks → add endpoint:
//   https://<your-project>.supabase.co/functions/v1/stripe-webhook
// Events to subscribe to:
//   - checkout.session.completed
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.paid
//   - invoice.payment_failed
//
// The webhook resolves the user via two paths (in order):
//   1. The Stripe Customer's email matches an auth.users.email.
//   2. The Checkout Session's `client_reference_id` is the user id (set this
//      by appending ?client_reference_id=<user_id> to the Payment Link URL
//      when launching checkout — see scripts/membership.js).

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY       = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET   = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

async function findUserId(opts: { email?: string | null; client_reference_id?: string | null }): Promise<string | null> {
  if (opts.client_reference_id) return opts.client_reference_id;
  if (!opts.email) return null;
  // Look up the auth user by email. Using the admin API requires the service role.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) { console.error("listUsers failed:", error.message); return null; }
  const match = data.users.find((u) => (u.email || "").toLowerCase() === opts.email!.toLowerCase());
  return match?.id ?? null;
}

async function upsertMembership(args: {
  user_id: string;
  email: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  status: string;
  current_period_end: number | null;     // unix seconds
  cancel_at_period_end: boolean;
}) {
  const period_end_iso = args.current_period_end
    ? new Date(args.current_period_end * 1000).toISOString()
    : null;
  const active = ACTIVE_STATUSES.has(args.status);
  const { error } = await supabase.from("memberships").upsert({
    user_id: args.user_id,
    email: args.email,
    stripe_customer_id: args.customer_id,
    stripe_subscription_id: args.subscription_id,
    status: args.status,
    active,
    current_period_end: period_end_iso,
    cancel_at_period_end: args.cancel_at_period_end,
  });
  if (error) console.error("upsert membership failed:", error.message);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // For subscriptions, the line items aren't on the session — we need
        // to retrieve the subscription separately.
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        const email = session.customer_email || session.customer_details?.email || null;
        const userId = await findUserId({ email, client_reference_id: session.client_reference_id });
        if (!userId) { console.warn("No user matched for session", session.id); break; }
        if (!subId)  { console.warn("Session has no subscription:", session.id); break; }
        const sub = await stripe.subscriptions.retrieve(subId);
        await upsertMembership({
          user_id: userId,
          email,
          customer_id: customerId,
          subscription_id: sub.id,
          status: sub.status,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const email = customer.email;
        const userId = await findUserId({ email });
        if (!userId) { console.warn("No user matched for subscription", sub.id, "email:", email); break; }
        await upsertMembership({
          user_id: userId,
          email,
          customer_id: customerId,
          subscription_id: sub.id,
          status: sub.status,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
        });
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const email = customer.email;
        const userId = await findUserId({ email });
        if (!userId) break;
        await upsertMembership({
          user_id: userId,
          email,
          customer_id: customerId,
          subscription_id: sub.id,
          status: sub.status,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
        });
        break;
      }

      default:
        // Ignore events we don't care about.
        break;
    }
  } catch (err) {
    console.error("Webhook handler failure for", event.type, err);
    return new Response("Webhook handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
