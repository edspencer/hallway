---
title: Health states
description: The five states an app can be in, how probes decide, and why "stopped on purpose" is never red.
---

Every app has one current state <span class="ms ms--v0">v0</span>. In the dashboard each state is shown with a
colour, a shape **and** a word, never colour alone, and in the [hallway imagery](/why-the-name/#the-hallway) as a
door.

| State | Meaning | Door | Tone |
| --- | --- | --- | --- |
| <span class="state state--healthy">● healthy</span> | Responding as expected | Ajar, a sliver of warm light showing | Calm, positive |
| <span class="state state--unhealthy">▲ unhealthy</span> | Listening but failing: HTTP 5xx, the health path not answering as expected, or a timeout | Light flickering behind it | Warning |
| <span class="state state--down">■ down</span> | Should be running, and is not listening | Dark, boarded up | **Alarm: the only red state** |
| <span class="state state--stopped">○ stopped</span> | Not listening, and that is fine | Closed | Neutral, quiet |
| <span class="state state--unknown">◌ unknown</span> | Not probed yet | In shadow | Neutral |

A [managed service](/concepts/services/) that has just been started shows a short-lived
<span class="state state--starting">◐ starting</span> for a grace period (30 seconds by default) before "not
listening" counts as down.

## Stopped on purpose is not down

The key rule. A slide deck you are not using today must not glow red. Only apps you said should be running can be
`down`; everything else that isn't listening is calmly `stopped`. What you expect of an app is its `expected` field:

| `expected` | When it isn't listening |
| --- | --- |
| `running` | It should always be up: **down** |
| `adhoc` | Up sometimes: **stopped** |
| `stopped` | Intentionally off: **stopped** |

A managed service you stopped yourself is `stopped` too. Uptime percentages **exclude stopped time**: being off on
purpose is not downtime.

## How a probe decides

Every 60 seconds (every 15 while a dashboard is open, so the page feels live), with a little jitter and a limit on how
many run at once, each declared and discovered app is probed:

1. **TCP connect** to its host and port, with a one-second timeout. No answer means *not listening*: `down`,
   `stopped` or `starting`, per the tables above.
2. If the app has a `health.path`, Hallway sends `GET <path>`. The expected status (by default any 2xx) means
   `healthy`; anything else means `unhealthy`.
3. Otherwise it sends `GET /`. Anything below 500 is `healthy`. **Redirects, 401 and 403 count as healthy**: an app
   behind a login page is up. A 5xx, or no response within five seconds, is `unhealthy`.

Probes don't follow redirects, use `GET` rather than `HEAD` (some dev servers mishandle `HEAD`), measure latency to
the response headers, send `User-Agent: hallway/<version>`, and send the upstream's own `Host` so apps that check it
answer normally.

**Flap damping:** an app needs two failed probes in a row to leave `healthy`, and one success to come back.

## Uptime history

Each probe is recorded: the state, the HTTP status and the latency.

- <span class="ms ms--v0">v0</span> The last **24 hours** at full resolution, drawn on every card as 48 bars of 30
  minutes each.
- <span class="ms ms--v0">v0</span> **7-day and 90-day** history from hourly rollups (with p50/p95 latency and a latency chart), in the app's
  detail drawer. The 90-day view reads only the rollups, so it stays quick: a few milliseconds per app with 30 apps
  and 90 days of history.

Periods when Hallway itself was not running are drawn as **no data**, an empty outline, never as down.

## Your tab shows trouble

<span class="ms ms--v0">v0</span> The dashboard's tab title counts problems, so a pinned tab works as a passive
monitor without any notification system:

```text
Hallway                         everything fine
(1 down) Hallway
(2 down · 1 unhealthy) Hallway
```

The tab's favicon gets a small status mark too. Only `down` and `unhealthy` count; `stopped` never does. Both update
live, so a background tab changes the moment an app falls over.
