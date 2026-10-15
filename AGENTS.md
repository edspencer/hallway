# Instructions for agents working in this repository

## Where things stand

This repository currently contains **only a specification**. Nobody who took part in the design discussion will be
available to answer questions, so the spec is deliberately exhaustive: it records decisions, their rationale, the
alternatives that were rejected, verified facts, and open questions.

Before writing any code, read, in order:

1. `spec.md` — the hub: summary, document map, key decisions, glossary, milestones.
2. `docs/01-background.md` … `docs/11-research-notes.md`, in numeric order.

## Working rules

- **The spec is authoritative** until code exists. If you disagree with a decision, record the disagreement and your
  alternative in `docs/09-decisions.md` and raise it with the author rather than silently diverging.
- **Record new decisions** in `docs/09-decisions.md` (next number, with rationale and rejected alternatives).
- **Resolve open questions explicitly**: when you settle something in `docs/10-open-questions.md`, move the outcome
  into the decisions log or the relevant doc.
- **Verify before you rely.** Items marked unverified (Safari `*.localhost`, Caddy `--resume`/trust details, HMR
  through the proxy, hook formats, `node:sqlite` on Node 22) must be checked by experiment, and the result written to
  `docs/11-research-notes.md` with the date.
- **Build in milestone order** (`docs/08-roadmap.md`). v0 must be useful on its own with no sudo and no DNS. Check each
  milestone's acceptance criteria by running the software, not by reading the code.
- **Visual design is core scope**, not polish (`docs/05-ui.md`). Iterate on the dashboard with real screenshots.
- **Never require root in the daemon.** Privileged steps belong only in `sj setup` / `sj teardown`, printed before
  they run.
- **Keep it generic.** Examples, defaults and docs must not assume any particular employer, machine, username or
  network. Use `example.com`, `myname.internal`, `~/Code/my-app` and similar placeholders.
- Follow the conventions of the author's sibling project Local Review (https://github.com/edspencer/local-review):
  stack, data-home layout, SSE pattern, security middleware, agent guide, release process. `docs/11-research-notes.md`
  summarises the relevant internals.
