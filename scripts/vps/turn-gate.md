# TURN gate on the VPS — install, check, roll back

Status: **installed on the VPS and live** (2026-11-02). Why it exists and what was measured: docs/cloud-games.md, "The
picture on networks that only allow 443". Steps 1-3 are done (caddy-l4, `turn-gate.service`, `CLOUD_TURN_RELAYS`), the
Pages build and all 208 packages carry the new player, and the leftover `coturn-poc` container + its ufw rules are
removed. The ONLY thing still open is step 0: the public `turn.edushasta.lol` DNS record, so Caddy can issue the
certificate (until then the 443 relay is configured but handshakes fail with "no certificate available"). Then do the
Chromebook check below.

```
browser ──TLS 443 (SNI turn.edushasta.lol)──▶ Caddy (caddy-l4 listener wrapper, terminates TLS, PROXY v2)
        ──plain TCP 127.0.0.1:3479──▶ turn-gate (STUN check, caps) ──TCP──▶ 123.108.72.31:8632 (provider's TURN)
                                                                      └─ UDP inside their network ─▶ gaming PC
```

No new public port, no ufw change: 443/tcp is already open for Caddy. Everything that is not SNI
`turn.edushasta.lol` falls through to Caddy's HTTP servers exactly as today.

## 0. Prerequisites

- **STILL TO DO.** DNS: `turn.edushasta.lol` A `176.100.37.63`, **DNS only** (grey cloud; Cloudflare's proxy cannot
  carry TURN). Zone `edushasta.lol` (3cfafa9feb5cbdf6b3c81d2784e69ce9). AAAA optional (Caddy listens on v6 too).
  The wrangler OAuth token only holds `zone:read`, so this one record is a hand edit in the dashboard (a token with
  DNS edit can do it via the API). Caddy starts retrying automatically once the name resolves (HTTP-01 on :80).
- The image must contain `server/turn-gate.ts` (Dockerfile line added): ship it with a normal `bun run release:vps`
  (note: `scripts/release-vps.ts` had to add `server/turn-gate.ts` to its rsync list, else the Docker `COPY` fails).

## 1. Caddy with the layer-4 plugin (same version, 2.11.7) — DONE (binary v2.11.7+l4 installed, held, config live; rollback copy at `/usr/bin/caddy.stock` + `/etc/caddy/Caddyfile.pre-turn`)

```sh
sudo cp -a /usr/bin/caddy /usr/bin/caddy.stock            # rollback copy
curl -fsSL -o /tmp/caddy-l4 "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/mholt/caddy-l4"
chmod +x /tmp/caddy-l4 && /tmp/caddy-l4 version && /tmp/caddy-l4 list-modules | grep -c layer4
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-turn
# write the new Caddyfile (below) to /tmp/Caddyfile.turn, then validate WITHOUT touching the running server:
/tmp/caddy-l4 validate --config /tmp/Caddyfile.turn --adapter caddyfile
sudo install -m 755 /tmp/caddy-l4 /usr/bin/caddy
sudo apt-mark hold caddy   # an apt upgrade would put back a stock binary that cannot read the layer4 config
sudo install -m 644 /tmp/Caddyfile.turn /etc/caddy/Caddyfile
sudo systemctl restart caddy   # a binary swap needs a restart, not a reload (~1 s gap on Store content + stats)
```

Caddyfile changes: the final form is kept in `scripts/vps/Caddyfile`. The essential parts are the `layer4` route (with
the ALPN the layer4 TLS handler) and the two TURN names. **The `connection_policy { alpn ... }` is not optional**: a
TURN-over-TLS client (Chrome) speaks ALPN `stun.turn` (RFC 7443); without it here the layer4 `tls` handler inherits
the HTTP servers' ALPN (`h1 h2`) and rejects Chrome with `no_application_protocol`, so no relay candidate is ever
gathered (this was the actual "443 does not work in Chrome" bug).

```caddyfile
{
	on_demand_tls {
		ask http://127.0.0.1:8081/__tls-ask
	}
	servers {
		protocols h1 h2
		listener_wrappers {
			layer4 {
				# turn.edushasta.lol = the real name (DNS still to add); turn.176-100-37-63.sslip.io = a fallback that
				# resolves via sslip.io so the relay works before that record exists
				@turn tls sni turn.edushasta.lol turn.176-100-37-63.sslip.io
				route @turn {
					tls {
						connection_policy {
							alpn stun.turn stun.nat-discovery
						}
					}
					proxy {
						proxy_protocol v2
						upstream 127.0.0.1:3479
					}
				}
			}
			tls
		}
	}
}

# only so Caddy obtains and renews a certificate for each name (HTTP-01 on :80); TLS on :443 never reaches HTTP
turn.edushasta.lol {
	respond 404
}

turn.176-100-37-63.sslip.io {
	respond 404
}
```

Caddyfile gotcha found on the VPS: a one-line site/block (`foo { respond 404 }`) is **not** parsed — write it
multi-line.

Validated and live: `caddy validate` passes, every normal HTTPS site on the same port still answers, `:80` still
answers, and a raw TLS+STUN probe with ALPN `stun.turn` reaches the provider through Caddy → gate, and real headless
Chrome streamed a game over it (relay/tls connected in 2.4 s, ~2 Mbit/s).

## 2. The gate — DONE (unit enabled + active; verified forwarding to the provider's TURN with a raw PROXY-v2 + STUN probe)

```sh
sudo install -m 644 turn-gate.service /etc/systemd/system/turn-gate.service
sudo systemctl daemon-reload && sudo systemctl enable --now turn-gate
curl -s 127.0.0.1:9479            # {"active":0,"accepted":0,"rejected":{},...}
journalctl -u turn-gate -n 20     # one JSON line per closed connection: reason, seconds, bytes (no addresses)
```

## 3. Tell the player about it — DONE (`CLOUD_TURN_RELAYS` in `/etc/shasta/shasta.env`; `GET https://edushasta.lol/cloud/relay` returns it; Pages worker + all 208 packages re-imported)

Add to `/etc/shasta/shasta.env`, then restart the backend (`shasta-ctl` or `systemctl restart shasta`):

```
CLOUD_TURN_RELAYS=turns:turn.edushasta.lol:443?transport=tcp => 123.108.72.31:8632
```

`GET https://edushasta.lol/cloud/relay` then returns it (the Pages worker forwards `/cloud/relay` to the backend).
The 208 cloud packages bake the player: `bun run import:opium-cloud` so they carry the new one.

## Check

- `https://edushasta.lol/opium-cloud.html?ice=tls` + a game: only the 443 relay is offered. Details must say
  `media path up via relay/tls (443 relay)`. This is the Chromebook test: if `?ice=tls` works there and the normal
  page did not, 443 fixed it.
- Normal page on a normal network: Details shows `relay/udp (upstream TURN)` as selected (our relay unused).
- `curl -s 127.0.0.1:9479` while playing: `active` > 0 only for sessions on the 443 path.

## Roll back (any step, in reverse)

```sh
# 3: remove CLOUD_TURN_RELAYS from /etc/shasta/shasta.env, restart shasta -> players stop offering the relay
sudo systemctl disable --now turn-gate && sudo rm /etc/systemd/system/turn-gate.service   # 2
sudo install -m 644 /etc/caddy/Caddyfile.pre-turn /etc/caddy/Caddyfile                   # 1
sudo install -m 755 /usr/bin/caddy.stock /usr/bin/caddy && sudo apt-mark unhold caddy
sudo systemctl restart caddy
```

Removing the gate alone is safe: the player simply gets a 701 from the 443 relay and keeps the provider's servers.

## Limits and what they cost

Settings (env in turn-gate.service): 60 connections total, 20 per network (a whole school shares one address),
30 min per connection (the provider caps a session at ~19 min), 60 s idle, 60 Mbit/s ceiling per connection,
first STUN message within 10 s. Each player on the 443 path costs the stream twice on the VPS port (in from the
provider, out to the player). Measured gate overhead: 20 × 15 Mbit/s (290 Mbit/s) at ~31 % of one core and ~200 MB
RAM on an M-series Mac, including the fake upstream and without TLS (AES-NI makes TLS cheap at this rate).
