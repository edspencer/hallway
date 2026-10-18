---
title: Custom domains
description: Serving apps under your own namespace such as myname.internal, and which domains to avoid.
---

<span class="ms ms--shipped">v1</span> The default base domain, `localhost`, needs no DNS at all. If you want your own
namespace instead, say `https://slides.myname.internal`, set a custom base domain:

```sh
hallway setup --domain myname.internal --print   # see the plan first
hallway setup --domain myname.internal
```

With a custom base, the dashboard lives at the bare apex (`https://myname.internal`) and apps live underneath it
(`https://slides.myname.internal`). Everything in [fronted mode](/networking/fronted-mode/) applies; a custom domain
only adds a way to resolve the names.

A custom domain needs the **System-wide certificate** tier (`--trust system`): pointing the system resolver at it takes an
administrator, and plain HTTP on a name other than `localhost` isn't a secure context. `--domain` implies
`--trust system`, and `--domain` with `--trust user` or `--trust none` is refused. Moving a custom-domain setup to
another tier goes back to `*.localhost` and removes the domain's resolver entry and dnsmasq.

## Choosing a domain

**Use a name under `.internal`.** ICANN reserved `.internal` for private use in 2024, so it will never be delegated
on the public internet. The domain needs at least two labels (`myname.internal`, not `internal`).

| Base domain | Verdict | Why |
| --- | --- | --- |
| `localhost` | ✅ The default | No DNS, reserved forever (RFC 6761). |
| `*.internal` | ✅ Recommended custom choice | Reserved by ICANN for private use; never delegated. |
| `*.test` | ✅ Fine | Reserved (RFC 6761). |
| `*.home.arpa` | ✅ Fine | Meant for home networks (RFC 8375). Long. |
| A made-up TLD, e.g. `name.surname` | ⚠️ Allowed, with a warning | Not reserved: someone could register that TLD later. |
| A name under another real TLD, e.g. `dev.example.com` | ⚠️ Allowed, with a warning | Fine if it's a domain you own; otherwise you'd be shadowing someone else's names on this machine. Certificates still come from Hallway's local CA, never a public one. |
| `*.local` | ❌ Refused | Reserved for mDNS/Bonjour (RFC 6762). macOS sends `.local` lookups to mDNS, and wildcards don't work. |
| `*.dev`, `*.app` and the other TLDs on browsers' HSTS preload list | ❌ Refused | Real, delegated TLDs on which browsers force HTTPS; the old "`.dev` for local development" setups all broke when it was delegated. |
| `*.example`, `*.invalid` | ❌ Refused | Reserved for documentation and for names that must never resolve. |

Every name gets its certificate from Hallway's local certificate authority, so `.test` and made-up TLDs never go to
a public certificate authority.

### About made-up TLDs

They work. Nothing stops you resolving names under an undelegated TLD on your own machine, and if that TLD is
delegated later, your setup keeps working: your machine's resolver configuration wins, and since fronted mode is
always HTTPS with a locally trusted CA (custom domains are System-wide certificate only), the `.dev`-style HSTS failure doesn't
apply. You only lose the ability to
reach the real public names.

But ICANN's 2026 round of new top-level domains is under way, so `hallway setup` and `hallway doctor` check your TLD
against IANA's list of delegated TLDs (cached for a week in the data home) and warn if it has become real. Prefer
`.internal`.

## What `hallway setup --domain` does

Unlike `*.localhost`, a custom domain needs something to answer DNS for it. Hallway runs its **own**
[dnsmasq](https://thekelleys.org.uk/dnsmasq/doc.html), as you, and points your system resolver at it for that one
domain:

1. **dnsmasq**, if it is missing: on macOS, setup installs it with Homebrew (`brew install dnsmasq`, as you, no
   sudo). On Linux, install it yourself (on Debian and Ubuntu the `dnsmasq-base` package, which starts no system
   service), then run setup again.
2. **Its configuration**, `~/.hallway/generated/dnsmasq.conf`, answers **the apex and every name under it** with your
   own machine, a wildcard, so adding an app never touches DNS again, and answers nothing else:

   ```text
   port=4253
   listen-address=127.0.0.1
   bind-interfaces
   no-resolv
   no-hosts
   address=/myname.internal/127.0.0.1
   address=/myname.internal/::1
   ```

   `listen-address` and `bind-interfaces` keep it on loopback, so it can't become an open resolver on your network.
3. **It runs as a user-level job**, `hallway.dnsmasq` (a LaunchAgent on macOS, a systemd user unit on Linux), on
   `127.0.0.1:4253` (`domain.dnsPort` in `config.yaml`). It never needs root, because it doesn't use port 53.
4. **The resolver entry**, the one privileged step a custom domain adds, printed and run through `sudo`:
   - macOS: `/etc/resolver/myname.internal`, containing `nameserver 127.0.0.1` and `port 4253`. The file is named
     after the **full** base domain, never just the TLD, so only your own names are captured. It covers the apex as
     well as subdomains.
   - Linux: a `systemd-resolved` drop-in, `/etc/systemd/resolved.conf.d/hallway.conf`, routing `~myname.internal` to
     `127.0.0.1:4253`. Other resolvers aren't supported by setup.
5. **Sets `domain.base`** (and `mode: fronted`) in `config.yaml`.

`hallway doctor` then checks dnsmasq is running and bound to loopback only, the resolver entry is in place, and both
the apex and a name under it resolve to your machine. By hand: `scutil --dns` and
`dscacheutil -q host -a name slides.myname.internal` on macOS, `resolvectl query slides.myname.internal` on Linux.

`hallway teardown` removes the resolver entry and the dnsmasq job.

Why not `/etc/hosts`, as some tools do? It needs sudo for *every* new app and can't express wildcards. A resolver
entry needs sudo once.

:::note[Checked on CI, not yet on a desktop Mac]
The macOS resolver file with a `port` line has worked on CI's macOS runners, end to end. Homebrew's dnsmasq notes
say a resolver override on a port other than 53 doesn't work on current macOS, so it is worth re-checking on a
desktop Mac, where mDNSResponder may behave differently.
:::
