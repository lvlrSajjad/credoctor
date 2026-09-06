# Releasing

Releases publish from CI via npm **trusted publishing** (OIDC). There is no npm token in
this repository, nothing to rotate, and no 2FA prompt to answer — npm verifies the workflow's
identity cryptographically instead. Every published version carries a provenance attestation
linking it to the commit and workflow that built it, which matters more than usual for a tool
that asks people to trust it with credential checks.

## One-time setup on npmjs.com

**Do this before the first release from CI, not after.** Trusted publishing has two halves: the
workflow in this repo, and a publisher record on npmjs.com. The repo half is committed here and
looks complete on its own, so a missing publisher record looks like nothing at all — until a
release dies at the last step. v0.1.1 was lost exactly that way: the package was created by hand
at 12:41, the tag was pushed at 12:47, and nothing happened in between.

An ordering constraint makes this easy to get wrong. **A publisher can only be added to a package
that already exists**, and npm will not stage a brand-new package either. So the first version of
a new package is published by hand, and every version after it goes through CI. That first
hand-published version carries no provenance; it is the one-off cost of starting a package, and
the reason 0.1.0 cannot be traced to a commit.

Signed in as the package owner. Every write here prompts for 2FA, so it cannot be scripted:

**Packages → credoctor → Settings → Trusted Publisher → GitHub Actions**

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Label | `github-actions-release` *(optional, cosmetic)* |
| Organization or user | `lvlrSajjad` |
| Repository | `credoctor` |
| Workflow filename | `publish.yml` |
| Environment name | *(leave empty)* |
| Allowed actions | ☑ Allow `npm publish` |

**`Organization or user` is the GitHub owner, not your npm username.** Those differ here — GitHub
is `lvlrSajjad`, npm is `lvlrsajjad` — and the field lives on npmjs.com asking for a name, which
invites the wrong one. The workflow field wants the filename only: `publish.yml`, not a path.

**`Allow npm publish` must be ticked** for `.github/workflows/publish.yml` as written. Leave it
unticked and the publisher is created, matches every field, and still refuses the release, because
an unticked box permits only `npm stage publish`.

**Half of it cannot be edited.** npm's docs claim a connection cannot be changed at all, but the
Edit form is more generous than that: publisher, organization, repository and workflow filename
are greyed out and fixed for the life of the connection, while **Label, Environment name and
Allowed actions stay editable**. So get the middle four right first time — a typo there means
deleting the connection and starting over — but `Allow npm publish` can be flipped later without
recreating anything.

Once it exists, the `NPM_TOKEN`-style secrets some guides tell you to add are unnecessary.
Don't add one; a stored token is the thing this setup exists to avoid.

### Staged publishing, deliberately not used yet

npm marks `Allow npm publish` "not recommended" and prefers staged publishing: CI runs
`npm stage publish` to upload a candidate, then a human runs `npm stage approve <stage-id>`,
which prompts for 2FA whether it is done from the CLI or the website. That is a stronger posture
than this repo currently has — today anything that can push a `v*` tag can ship a release with no
human in the loop.

It was considered for 0.1.1 and deferred for one reason: npm documents neither whether a staged
tarball keeps its provenance attestation through approval, nor how long a candidate survives
before expiring. Provenance is the whole reason this package releases from CI, so an unanswered
question about it does not belong on a release's critical path. Revisit on a version where a
surprise costs nothing: stage it, confirm the attestation survives approval, then untick
`Allow npm publish` via **Edit → Save changes**, which needs no recreation.

## Cutting a release

```sh
npm version patch     # or minor / major — writes package.json and creates the tag
git push --follow-tags
```

That is the whole flow. The tag push triggers `.github/workflows/publish.yml`, which
typechecks, builds, runs the smoke test, verifies the tag matches `package.json`, and
publishes.

## Requirements the workflow encodes

- **npm ≥ 11.5.1 and Node ≥ 22.14.0.** Trusted publishing does not exist below these.
  `setup-node` installs an older npm alongside Node 22, so the workflow upgrades npm
  explicitly — removing that step will break publishing in a confusing way.
- **`permissions: id-token: write`.** Without it the runner cannot mint the OIDC token and
  npm falls back to looking for a token that isn't there.
- **No `NODE_AUTH_TOKEN`.** Its absence is the point.

## If a publish fails

- **`ENEEDAUTH` / 404 on the package** — npm has no credentials and found no usable trusted
  publisher. Three different faults produce this one message, so check in this order: that a
  publisher record exists on npmjs.com **at all** — nothing in this repo creates it, and its
  absence is what killed the first v0.1.1 attempt; that `Allow npm publish` is ticked on it; then
  field-by-field case. Because the message cannot tell them apart, the publish step retries at
  `--loglevel verbose` on failure. Read that output instead of guessing — it carries the
  registry's actual response.
- **`EOTP`** — npm did not see the OIDC token and fell back to interactive auth. Check that
  `id-token: write` is present and that npm was upgraded before the publish step.
- **Tag mismatch error** — you tagged a version that disagrees with `package.json`. Use
  `npm version` rather than tagging by hand; it keeps them in step.

## Publishing by hand

Still possible and occasionally useful, but it needs 2FA:

```sh
npm publish --otp=<code-from-your-authenticator>
```

Prefer the tag flow. A hand publish produces no provenance and is not reproducible from a
tag, so the artifact people install cannot be traced back to a commit.
