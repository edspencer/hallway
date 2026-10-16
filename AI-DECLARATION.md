---
version: "0.1.2"
level: copilot
processes:
  design: pair
  implementation: copilot
  testing: copilot
  documentation: copilot
  review: pair
  deployment: assist
---

This format is based on [AI-DECLARATION.md](https://ai-declaration.md/en/0.1.2).

## Notes

Hallway exists because coding agents make small web apps nearly free to build, and it is built the same way: by its
author, working with Claude Code agents.

- **Design is the author's.** What Hallway is for and the rules it keeps are decisions the author made and argued
  through with Claude: YAML on disk as the source of truth, loopback only, a daemon that never runs as root, MCP tools
  that describe rather than launch, "stopped on purpose" never shown as down. The design discussion is written down
  in full in `spec.md` and `docs/`, including the decisions log (`docs/09-decisions.md`) and what was rejected.
- **Implementation and tests are largely generated under review.** Agents write code and tests against that spec,
  and the author reviews the result. Commits an agent helped write carry a `Co-Authored-By: Claude` trailer.
- **Checked by running it.** CI runs the typecheck, the test suite, the build and a packed-install smoke test on
  Linux and macOS before anything merges, and each milestone's acceptance criteria are checked by running the
  software, not by reading the code.
- **Releases are automated, never from a laptop.** npm releases come from GitHub Actions with trusted publishing and
  provenance, after CI has passed on the exact commit ([RELEASING.md](RELEASING.md)).

### Why this file exists

Because "was this vibe-coded?" is a fair question to ask of a tool that sits on your machine watching your ports,
and the useful answer is a specific one. If you're sceptical of generated code, this tells you where to look: the
spec, the guarantees in [SECURITY.md](SECURITY.md), and the tests that hold them.
