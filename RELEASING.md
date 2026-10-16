# Releasing Hallway

Hallway is published to npm as [`hallway`](https://www.npmjs.com/package/hallway). Every release comes from
GitHub Actions (`.github/workflows/release.yml`), with npm trusted publishing and a provenance attestation. Nobody
publishes from a laptop, and no npm token exists. This is the same pipeline as the author's sibling project
[Local Review](https://github.com/edspencer/local-review/blob/main/RELEASING.md).

> **Status: released.** 0.1.0, 0.2.0, 0.3.0 and 0.3.1 all went out through this pipeline on 2026-10-16. The
> hand-published placeholder `hallway@0.0.1` (see "How the package was bootstrapped") is still on npm and not yet
> deprecated, as is a `hallway@0.0.0-stage` published a minute before it.

## Maintainer settings

These need a person with admin access to the GitHub repo or a logged-in npm maintainer:

- **Done:** Settings → Actions → General → Workflow permissions allows GitHub Actions to **create and approve pull
  requests** (the Release workflow opens the "chore: version packages" PR with `GITHUB_TOKEN`).
- **Still to do (Ed):** deprecate the placeholders, which needs a logged-in maintainer:
  `npm deprecate hallway@0.0.1 "placeholder, use the latest version"` (and the same for `hallway@0.0.0-stage`).
- Optionally, a ruleset on `main` requiring the **CI passed** check (the one stable check name `ci.yml` reports).
  See "The version PR's CI" for what that means for the version PR.
- Private vulnerability reporting on (Settings → Code security), which [SECURITY.md](SECURITY.md) points to.

## How a release happens

1. **PRs carry changesets.** A PR with a user-facing change adds a `.changeset/*.md` file naming the bump (patch,
   minor or major) and a summary for users ([CONTRIBUTING.md](CONTRIBUTING.md#changesets)).
2. **The Release workflow keeps a version PR open.** On every push to `main` that leaves changesets pending, the
   `release` job runs `npm run changeset:version` and opens or updates a PR titled **"chore: version packages"**
   (branch `changeset-release/main`). That PR consumes the changesets into `CHANGELOG.md`, bumps `version` in
   `package.json` and refreshes `package-lock.json`. More changesets merged meanwhile get folded into the same PR.
3. **Merging the version PR releases.** That push leaves no changesets and a version with no `v<version>` tag, so
   the same workflow run goes on to:
   - `verify-ci`: wait for the CI run on the merge commit and require it to have passed (see below);
   - `publish-npm`: `npm publish` (`prepack` builds `dist/`), then check that the provenance attestation is visible
     on the registry;
   - `github-release`: create the tag `v<version>` at the merge commit, and a GitHub Release whose notes are that
     version's `CHANGELOG.md` section.

So you decide *when* to release by merging the version PR, and *what* the version is by the changesets. Nobody edits
`version` by hand. `workflow_dispatch` (Actions → Release → Run workflow) re-runs the pipeline for the current
`main`. The tag and the Release come after npm, so a `v<version>` tag always means that version is on npm.

When the docs site (`website/`) gains a "What's new" page, `changeset:version` is the place to hook a script that
gives its upcoming section the released version's heading, as Local Review does.

### The version PR's CI

The version PR is opened by `github-actions[bot]` with the workflow's `GITHUB_TOKEN`, and GitHub doesn't run CI
for it the usual way: workflow runs for a PR from that token aren't triggered (or are parked waiting for approval).
Two consequences:

- **A required check never reports on it.** If `main`'s ruleset requires `CI passed`, the version PR can't merge
  until CI runs. To get a real CI run, close the PR and reopen it (a person reopening it triggers CI), or merge with
  a ruleset bypass.
- **You can't ship unverified regardless.** CI on the push to `main` does run (a person merged it), and `verify-ci`
  blocks the publish unless that run concluded `success` on that exact commit. If it failed for a reason you judge
  unrelated (a flake), re-run CI until it's green, then re-run the Release workflow.

## npm auth: trusted publishing (set up, nothing to do)

The `publish-npm` job authenticates to npm with **OIDC trusted publishing**. There is no `NPM_TOKEN` secret, and
there must never be one: the package's npm settings require 2FA and disallow tokens, so a token couldn't publish
anyway.

What makes it work, all already in place:

- On npmjs.com, [`hallway` → Settings](https://www.npmjs.com/package/hallway/access) has a **trusted publisher**:
  GitHub Actions, repository `edspencer/hallway`, workflow `release.yml`, no environment, with **npm publish** ticked
  under its allowed actions. Renaming `release.yml`, or moving the publish to another workflow file, breaks
  publishing until this is updated.
- The job has `permissions: id-token: write`, and `actions/setup-node` with `registry-url:
  https://registry.npmjs.org` (without it npm never tries to authenticate).
- npm ≥ 11.5.1. Node 22 ships npm 10, so the job installs `npm@^11.5.1` before publishing.
- `publishConfig` in `package.json`: `access: public` and `provenance: true`. Trusted publishing would attest
  provenance on its own; asking explicitly makes a missing attestation an error. The job then checks that it landed
  (`npm view hallway@<version> dist.attestations.provenance`) and fails the run if it didn't.

### How the package was bootstrapped (one-time, done)

A trusted publisher can only be attached to a package that already exists, and the first publish of a new package
can't be done over OIDC ([npm/cli#8544](https://github.com/npm/cli/issues/8544)). So Ed published a placeholder
`hallway@0.0.1` by hand on 2026-10-16: a `package.json` with no code, no `bin` and no dependencies (MIT, repository
`edspencer/hallway`). Then he configured the trusted publisher and locked the package down to 2FA with no tokens.
0.0.1 is the only version that will ever have been published from a laptop, and it's permanently unattested. That's
why it holds no code.

The first release (0.1.0) moved `latest` off the placeholder. Deprecating 0.0.1 is still to do (above).

## When something goes wrong

The pipeline is built so that re-running it finishes a half-done release. npm will never accept the same version
twice (and unpublishing is only possible for 72 hours, and frees nothing: the version number stays burned).

- **The version PR has wrong notes or the wrong bump.** Fix the changesets on `main` (edit or delete the
  `.changeset/*.md` files in a normal PR). The Release workflow rewrites the version PR on the next push. Don't hand
  edit the version PR.
- **`verify-ci` failed.** Nothing was published. Fix `main`, or re-run CI and then re-run Release.
- **`publish-npm` failed before publishing** (auth, network, a build error in `prepack`). Nothing was published, and
  there's no tag. Fix the cause and re-run the workflow. An auth failure (`E404`/`ENEEDAUTH` on publish) almost
  always means the trusted publisher settings don't match the repo, the workflow file name or the job's `id-token`
  permission.
- **`E403 … OIDC permission denied for this action`** means npm accepted the OIDC token but the trusted publisher
  isn't allowed to do a direct publish: tick **npm publish** under its **Allowed actions** and re-run the failed jobs.
- Repositories created after 2026-07-15 get OIDC tokens with *immutable* subject claims. If a publish fails at the
  token exchange with `package not found` (E404), check [npm/cli#9969](https://github.com/npm/cli/issues/9969) first.
- **Published, but a later step failed** (the provenance check timed out, or the GitHub Release step failed). The
  version is on npm and there's no `v<version>` tag, so re-running the workflow detects the release again, *skips*
  the publish ("already on npm") and finishes the provenance check, the tag and the Release.
- **A bad version is out.** Don't try to replace it: fix forward with a new changeset (a patch) and release it.
  `npm deprecate hallway@<bad> "<why; use x.y.z>"` warns anyone who installs it.

**Never publish from a laptop to fix any of this.** A manual publish has no provenance, and the package disallows
token publishing anyway. Everything goes through the workflow.

## Dry runs, locally

```sh
npx changeset status --verbose   # what the next version would be, and which changesets make it
npm publish --dry-run            # builds (prepack) and lists exactly what would go into the tarball
npm run smoke:pack               # packs, installs and runs the package as a user would (CI runs this too)
```

`npm publish --dry-run` warns that you aren't logged in; that's expected and harmless. To see what the version PR
would change, run `npm run changeset:version` in a scratch clone, not a worktree (it rewrites `package.json`,
`CHANGELOG.md` and the lockfile, and deletes the changesets). Use npm 11 for it: npm 10 rewrites the lockfile
differently.
