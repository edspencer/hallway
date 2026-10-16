---
title: Localhost security
description: How the daemon defends against other web pages, DNS rebinding and cross-site requests.
---

Hallway is local-only: the daemon listens on `127.0.0.1` and nothing is exposed to your network. But "only on
localhost" isn't the same as "only reachable by you". Any web page you visit can try to talk to a local server, either
through **DNS rebinding** (a hostile domain that resolves to 127.0.0.1) or by sending a cross-site "simple" request.
Since the daemon can edit your config, start and stop services and (in v2) speak MCP, it defends against both, the same way Local Review does.

## The rules

- **Loopback only.** The daemon binds `127.0.0.1`, never `0.0.0.0`.
- **Host allowlist.** Every request's `Host` header must be `localhost`, `127.0.0.1` or `[::1]` (any port), or the
  configured dashboard hostname in fronted mode. Anything else gets `403 forbidden host`. This is what defeats DNS
  rebinding.
- **Writes must be JSON.** Every write must be `Content-Type: application/json`, which forces the browser to send a
  CORS preflight, and **no CORS headers are ever sent**, so the preflight always fails. A `DELETE` has no body, so it is
  exempt from the content-type rule but not from the next one.
- **Origin check.** If a write carries an `Origin` header, it must be one of the allowed hosts.
- **The MCP endpoint follows the same rules**, as MCP's own guidance for HTTP servers asks.

There is no login. Anything that runs as you can already edit the data home directly, so a password on the API would
add friction without adding protection.

## Why this forces Host rewriting

Many local apps, Local Review included, defend themselves the same way, and would answer `403 forbidden host` to a
request arriving as `review.localhost`. That is why Hallway's proxy rewrites `Host` to the upstream address by default
in fronted mode. See [Host-header rewriting](/networking/fronted-mode/#host-header-rewriting).

## And the rest of the machine

- Managed services are started with `HOST=127.0.0.1`, so they stay off the network.
- The dashboard flags apps listening on all interfaces as **exposed**, and `hallway doctor` lists them.
- The dnsmasq configuration for custom domains binds to loopback only, so it can't become an open resolver.
- Screenshots (an opt-in v2 feature) never leave your machine.

Found a problem? See the repository's security policy on [GitHub](https://github.com/edspencer/hallway).
