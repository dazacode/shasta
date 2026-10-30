# Kuhi on the VPS (the anime resolver behind Shasta Watch)

`docs/streaming-sources.md` explains why we self-host this: the public consumet and anify instances proved
unreliable, and Kuhi races ten native providers and returns HLS + subtitles (its own `/proxy_m3u8` +
`/proxy_segment` are the referer-injection trick we copy). It is Python, so it is a **separate service**, not part
of the bun backend.

It runs on the private `shasta` docker network only (no published port, no Caddy, no TLS): the backend is its sole
caller, at `http://kuhi:8090`.

## One-time setup (on the VPS)

```sh
# 1. Build and tag the image from the pinned Dockerfile (bump KUHI_REF on purpose).
docker build -t kuhi:current scripts/vps/kuhi/

# 2. Install and start the unit.
sudo cp scripts/vps/kuhi.service /etc/systemd/system/kuhi.service
sudo systemctl daemon-reload
sudo systemctl enable --now kuhi
systemctl status kuhi --no-pager

# 3. Point the backend at it and restart Shasta (the container joins the `shasta` network, so the name resolves).
sudo sh -c 'grep -q ^KUHI_URL= /etc/shasta/shasta.env || echo KUHI_URL=http://kuhi:8090 >> /etc/shasta/shasta.env'
sudo systemctl restart shasta

# 4. Check from the backend container.
sudo docker exec shasta sh -c 'wget -qO- http://kuhi:8090/anime/providers/status >/dev/null && echo kuhi-ok'
curl -s https://<host>/api/watch/check   # { enabled, tmdb, kuhi: true }
```

## Version bumps

`git clone --depth 1 --branch <ref>` in the Dockerfile is deliberately pinned. To update: change `KUHI_REF`,
`docker build -t kuhi:current scripts/vps/kuhi/`, `sudo systemctl restart kuhi`. Kuhi churns, so re-run
`bun run media:probe` and check a real episode after any bump.

## Notes

- Kuhi needs outbound network (its providers are on the open web). A school filter never sees them: the browser
  only ever talks to Shasta, and Shasta talks to Kuhi, and Kuhi talks to the CDN.
- If Kuhi is down or unset, Watch degrades to the `vidsrc.net` anime embed (`sources.ts`); nothing breaks.
- The image carries the whole repo + pip deps; ~250 MB. It holds no state (in-memory caches only).
