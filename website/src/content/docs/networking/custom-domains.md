---
title: Custom domains
description: Serving apps under your own namespace such as myname.internal, and which domains to avoid.
---

<span class="ms">v1</span> The default base domain, `localhost`, needs no DNS at all. If you want your own namespace
instead, say `https://slides.myname.internal`, set a custom base domain:

```sh
hallway setup --domain myname.internal
```

With a custom base, the dashboard lives at the bare apex (`https://myname.internal`) and apps live underneath it
(`https://slides.myname.internal`).

## Choosing a domain

**Use a name under `.internal`.** ICANN reserved `.internal` for private use in 2024, so it will never be delegated
on the public internet, and Caddy issues local certificates for it automatically.

| Base domain | Verdict | Why |
| --- | --- | --- |
| `localhost` | ✅ The default | No DNS, automatic local certificates, reserved forever (RFC 6761). |
| `*.internal` | ✅ Recommended custom choice | Reserved by ICANN for private use; never delegated. |
| `*.test` | ✅ Fine | Reserved (RFC 6761). Caddy would try a public certificate for it, so Hallway forces the internal issuer. |
| `*.home.arpa` | ✅ Fine | Meant for home networks (RFC 8375). Long. |
| A made-up TLD, e.g. `name.surname` | ⚠️ Allowed, with a warning | Not reserved: someone could register that TLD later. |
| A subdomain of a domain you own | ✅ Possible, advanced | Public DNS can point at 127.0.0.1 and real certificates come via DNS-01, but needs a DNS API token and publishes every app name in Certificate Transparency logs. Not a v1 target. |
| `*.local` | ❌ Refused | Reserved for mDNS/Bonjour (RFC 6762). macOS intercepts `.local` lookups, and wildcards don't work. |
| `*.dev`, `*.app` and other real TLDs | ❌ Refused, or a loud warning | Real, delegated TLDs. `.dev` and `.app` are HSTS-preloaded; the old "`.dev` for local development" setups all broke when it was delegated. |

### About made-up TLDs

They work. Nothing stops you resolving names under an undelegated TLD on your own machine, and if that TLD is
delegated later, your setup keeps working: your machine's resolver file wins, and since fronted mode is always HTTPS
with a locally trusted CA, the `.dev`-style HSTS failure doesn't apply. You only lose the ability to reach the real
public names.

But ICANN's 2026 round of new top-level domains is under way, so `hallway doctor` checks your TLD against IANA's list
of delegated TLDs and warns if it has become real. Prefer `.internal`.

## What `hallway setup --domain` does

Unlike `*.localhost`, a custom domain needs something to answer DNS for it. Hallway uses
[dnsmasq](https://thekelleys.org.uk/dnsmasq/doc.html) and a macOS resolver file:

1. Installs dnsmasq (`brew install dnsmasq`) if it is missing, with your consent.
2. Writes a drop-in that answers **the apex and every subdomain** with your own machine, a wildcard, so adding an app
   never touches DNS again:

   ```text
   address=/myname.internal/127.0.0.1
   address=/myname.internal/::1
   listen-address=127.0.0.1
   bind-interfaces
   ```

   The last two lines matter: without them dnsmasq can become an open resolver on your network.
3. Starts dnsmasq as a LaunchDaemon (it binds port 53, so it runs as root).
4. Writes `/etc/resolver/myname.internal` containing `nameserver 127.0.0.1`. The file is named after the **full**
   base domain, never just the TLD, so only your own names are captured. It covers the apex as well as subdomains.
5. Sets `domain.base` in `config.yaml`.

Check it with `scutil --dns` (your domain should be listed as its own resolver) and
`dscacheutil -q host -a name slides.myname.internal`.

Why not `/etc/hosts`, as some tools do? It needs sudo for *every* new app and can't express wildcards. dnsmasq needs
sudo once.
