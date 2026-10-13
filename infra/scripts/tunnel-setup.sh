#!/usr/bin/env bash
# Make the home-server deployment public through a Cloudflare Tunnel, end to end (docs/infra.md §14).
# Run from your laptop. Creates (or reuses) a remotely managed tunnel named $TUNNEL_NAME, points it at
# the api container, replaces the hostname's DNS record with a proxied CNAME to the tunnel, and, when
# DOCKCAST_HOMESERVER is set, writes COMPOSE_PROFILES/CLOUDFLARE_TUNNEL_TOKEN into the server's
# infra/.env over ssh and redeploys. Re-running is safe at every step.
#
#   CLOUDFLARE_API_TOKEN=<token> DOCKCAST_HOMESERVER=user@host infra/scripts/tunnel-setup.sh dockcast.example.com
#
# The API token (dash.cloudflare.com/profile/api-tokens -> Create Custom Token) needs:
#   Account | Cloudflare Tunnel | Edit      Zone | Zone | Read      Zone | DNS | Edit   (zone: the domain's)
# It is only used by this script; the tunnel's own run token is what lands in .env.
#
# Optional: TUNNEL_NAME (default dockcast), ORIGIN (default http://api:3000, the compose service name),
# DOCKCAST_HOMESERVER_DIR (default C:\dockcast), CF_ACCOUNT_ID (skips the zone->account lookup).
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
[ -n "$DOMAIN" ] || { echo "usage: CLOUDFLARE_API_TOKEN=... $0 <hostname>" >&2; exit 2; }
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (see the header of this script for its permissions)}"
TUNNEL_NAME="${TUNNEL_NAME:-dockcast}"
ORIGIN="${ORIGIN:-http://api:3000}"

TUNNEL_TOKEN=$(python3 - "$DOMAIN" "$TUNNEL_NAME" "$ORIGIN" <<'PY'
import json, os, sys, urllib.error, urllib.parse, urllib.request

API = os.environ.get("CF_API_BASE", "https://api.cloudflare.com/client/v4")
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
domain, name, origin = sys.argv[1:4]

def cf(method, path, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            r = json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            r = json.load(e)
        except Exception:
            sys.exit(f"Cloudflare API {method} {path}: HTTP {e.code}")
    if not r.get("success"):
        sys.exit(f"Cloudflare API {method} {path}: {r.get('errors')}")
    return r["result"]

def say(msg):
    print("[tunnel-setup] " + msg, file=sys.stderr)

# 1. Zone: the longest suffix of the hostname that is a zone on this account.
labels = domain.split(".")
zone = None
for i in range(len(labels) - 1):
    found = cf("GET", "/zones?" + urllib.parse.urlencode({"name": ".".join(labels[i:])}))
    if found:
        zone = found[0]
        break
if zone is None:
    sys.exit(f"no Cloudflare zone found for {domain}; the token needs Zone:Read on it")
zone_id = zone["id"]
account_id = os.environ.get("CF_ACCOUNT_ID") or zone["account"]["id"]
say(f"zone {zone['name']} ({zone_id}), account {account_id}")

# 2. Tunnel: reuse by name, else create. Remotely managed (config_src=cloudflare).
q = urllib.parse.urlencode({"name": name, "is_deleted": "false"})
existing = cf("GET", f"/accounts/{account_id}/cfd_tunnel?{q}")
if existing:
    tunnel_id = existing[0]["id"]
    token = cf("GET", f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token")
    say(f"reusing tunnel '{name}' ({tunnel_id})")
else:
    created = cf("POST", f"/accounts/{account_id}/cfd_tunnel", {"name": name, "config_src": "cloudflare"})
    tunnel_id, token = created["id"], created["token"]
    say(f"created tunnel '{name}' ({tunnel_id})")

# 3. Ingress: hostname -> origin, everything else 404.
cf("PUT", f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations",
   {"config": {"ingress": [{"hostname": domain, "service": origin}, {"service": "http_status:404"}]}})
say(f"ingress {domain} -> {origin}")

# 4. DNS: a proxied CNAME to the tunnel replaces whatever record the hostname has now.
target = f"{tunnel_id}.cfargotunnel.com"
records = cf("GET", f"/zones/{zone_id}/dns_records?" + urllib.parse.urlencode({"name": domain}))
already = [r for r in records if r["type"] == "CNAME" and r["content"] == target and r.get("proxied")]
for r in records:
    if r in already:
        continue
    cf("DELETE", f"/zones/{zone_id}/dns_records/{r['id']}")
    say(f"removed {r['type']} {domain} -> {r['content']}")
if already:
    say("DNS already points at the tunnel")
else:
    cf("POST", f"/zones/{zone_id}/dns_records",
       {"type": "CNAME", "name": domain, "content": target, "proxied": True, "ttl": 1})
    say(f"created proxied CNAME {domain} -> {target}")

print(token)
PY
)

echo
echo "Tunnel is configured. The host needs these two lines in infra/.env:"
echo "  COMPOSE_PROFILES=tunnel"
echo "  CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN:0:12}…"

if [ -z "${DOCKCAST_HOMESERVER:-}" ]; then
  echo
  echo "Set DOCKCAST_HOMESERVER=user@host to have them written and the stack redeployed automatically,"
  echo "or add them by hand and run: docker compose -p dockcast -f infra/docker-compose.yml up -d"
  echo
  echo "CLOUDFLARE_TUNNEL_TOKEN=$TUNNEL_TOKEN"
  exit 0
fi

RDIR="${DOCKCAST_HOMESERVER_DIR:-C:\\dockcast}"
echo
echo "Writing them to $DOCKCAST_HOMESERVER:$RDIR\\infra\\.env"
# PowerShell over ssh (the server's shell is PowerShell). Lines are rewritten LF-only so the token
# never picks up a trailing CR. Every PowerShell `$` below is escaped for bash; only $RDIR and
# $TUNNEL_TOKEN are expanded here.
ssh "$DOCKCAST_HOMESERVER" 'powershell -NoProfile -NonInteractive -Command -' <<PS
\$f = '$RDIR\\infra\\.env'
\$lines = @(Get-Content \$f | Where-Object { \$_ -notmatch '^(COMPOSE_PROFILES|CLOUDFLARE_TUNNEL_TOKEN)=' })
\$lines += 'COMPOSE_PROFILES=tunnel'
\$lines += 'CLOUDFLARE_TUNNEL_TOKEN=$TUNNEL_TOKEN'
[IO.File]::WriteAllText(\$f, ((\$lines -join [char]10) + [char]10))
Write-Output ("updated " + \$f + " (" + \$lines.Count + " lines)")
PS

echo
echo "Redeploying (archives HEAD, builds on the server, starts the stack with the tunnel profile)"
"$(dirname "${BASH_SOURCE[0]}")/deploy-homeserver.sh" "$DOCKCAST_HOMESERVER" "$RDIR"

echo
echo "Done. From a network that is not on the tailnet:  curl -s https://$DOMAIN/api/v1/health"
echo "DNS now resolves to Cloudflare, and IP changes at home need nothing: cloudflared reconnects on its own."
