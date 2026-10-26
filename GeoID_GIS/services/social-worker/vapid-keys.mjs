// node vapid-keys.mjs -- make a VAPID key pair for push.js and set it on the Worker.
//
//   VAPID_PUBLIC_KEY   a plain var (it is public: browsers subscribe with it)
//   VAPID_PRIVATE_JWK  a SECRET: piped straight into `wrangler secret put`,
//                      never printed, never written to disk
//
// Run once. A new pair invalidates every existing browser subscription.
import { execFileSync } from "node:child_process";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = Buffer.from(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))).toString("base64url");
const jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
execFileSync("npx", ["wrangler", "secret", "put", "VAPID_PRIVATE_JWK"], { input: jwk, stdio: ["pipe", "inherit", "inherit"] });
console.log(`\nSecret set. Now add this to wrangler.toml [vars] and deploy:\n\nVAPID_PUBLIC_KEY = "${pub}"\n`);
