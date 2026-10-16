// The port scanner (docs/04-apps-health-services.md, "Observed listeners"; D11, D18): lists listening sockets through
// the platform (lsof on macOS, ss or /proc on Linux: server/platform/), filters out noise, sniffs HTTP, identifies
// each listener by its working directory, package and git branch, and records observations in state/observed.json.
// Not implemented yet: v0 (docs/08-roadmap.md).
export {};
