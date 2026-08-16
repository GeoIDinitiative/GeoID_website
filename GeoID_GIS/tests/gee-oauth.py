"""
Which redirect URIs and origins will this OAuth client actually accept?

Earth Engine sign-in failed for a whole session with "no registered origin /
401 invalid_client", and every round of guessing cost hours because the answer
lives in a console the code cannot see. This asks Google instead. It needs no
credentials and no sign-in: the authorisation endpoint validates the client and
the redirect BEFORE it authenticates anyone, so the error it returns is a
direct reading of what is registered.

How to read it:

  redirect_uri_mismatch   the client exists and does NOT accept that entry
  ACCEPTED                that entry is registered -- this is what success is
  invalid_client          the client id itself is wrong, deleted, or not a
                          Web application client

Measured 2026-08-16: ALL eleven candidates returned redirect_uri_mismatch,
including urn:ietf:wg:oauth:2.0:oob and ports this app has never used. A client
with any entry registered would accept its own, so that reading means the
client has an empty redirect list and an empty JavaScript-origins list.

Run it again after editing the console. The storagerelay line is the one the
browser token flow uses, so that is the line that must flip.
"""
import base64, urllib.parse, urllib.request, re, ssl
CID = "473900633008-n15n9va0orhq6v0f5g83bjbeq6r6jhh9.apps.googleusercontent.com"
SCOPE = "https://www.googleapis.com/auth/earthengine.readonly"

CANDIDATES = [
    ("code", "http://localhost:8100"),
    ("code", "http://localhost:8100/"),
    ("code", "http://localhost:8100/myGeoID/"),
    ("code", "http://localhost:8100/oauth2callback"),
    ("code", "http://localhost:8100/callback"),
    ("code", "http://localhost"),
    ("code", "http://127.0.0.1:8100"),
    ("code", "http://localhost:8080"),
    ("code", "http://localhost:3000"),
    ("code", "urn:ietf:wg:oauth:2.0:oob"),
    ("token", "storagerelay://http/localhost:8100?id=auth1"),
]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, newurl, headers, fp)

op = urllib.request.build_opener(NoRedirect)
ctx = ssl.create_default_context()

def probe(rtype, redirect):
    q = {"client_id": CID, "response_type": rtype, "scope": SCOPE,
         "redirect_uri": redirect, "access_type": "online"}
    if rtype == "code":
        q["code_challenge"] = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        q["code_challenge_method"] = "S256"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(q)
    try:
        r = op.open(url, timeout=20)
        return "200 (no redirect)"
    except urllib.error.HTTPError as e:
        loc = e.reason if isinstance(e.reason, str) else e.headers.get("Location", "")
        m = re.search(r"authError=([^&]+)", loc or "")
        if m:
            raw = urllib.parse.unquote(m.group(1))
            pad = raw + "=" * (-len(raw) % 4)
            blob = base64.urlsafe_b64decode(pad)
            err = re.sub(rb"[^\x20-\x7e]", b" ", blob[:40]).decode().strip()
            return "ERROR: " + err.split("  ")[0]
        if "ServiceLogin" in (loc or "") or "signin/v2" in (loc or "") or "accounts.google.com/v3/signin" in (loc or ""):
            return "*** ACCEPTED (asks for sign-in) ***"
        return f"{e.code} -> {(loc or '')[:90]}"
    except Exception as e:
        return f"fail: {e}"

for rtype, redirect in CANDIDATES:
    print(f"{rtype:6} {redirect:42} {probe(rtype, redirect)}")
