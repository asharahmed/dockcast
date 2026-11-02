# Caddy + Cloudflare DNS plugin (docs/infra.md §13): certificates come from
# ACME DNS-01 (global `acme_dns` in the Caddyfile), so a host that nothing
# external can reach — e.g. the Tailscale-only proving deployment — still gets
# real Let's Encrypt certs. Deployments without CLOUDFLARE_API_TOKEN and with
# an http-only SITE_ADDRESS never trigger issuance and behave as before.
FROM caddy:2.9-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2.9-alpine
# The upstream image lags Alpine security fixes (2026-11-01: libssl3/libcrypto3 with
# CVE-2025-15467, fixed in 3.3.6-r0). Take them at build time.
RUN apk upgrade --no-cache
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
