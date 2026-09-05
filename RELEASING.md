# Releasing

Releases publish from CI via npm **trusted publishing** (OIDC). There is no npm token in
this repository, nothing to rotate, and no 2FA prompt to answer — npm verifies the workflow's
identity cryptographically instead. Every published version carries a provenance attestation
linking it to the commit and workflow that built it, which matters more than usual for a tool
that asks people to trust it with credential checks.

## One-time setup on npmjs.com

Do this once, signed in as the package owner:

**Packages → credoctor → Settings → Trusted publishing → Add publisher**

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `lvlrSajjad` |
| Repository | `credoctor` |
| Workflow filename | `publish.yml` |
| Environment | *(leave empty)* |

**Every field is case-sensitive and must match exactly.** `lvlrsajjad` will not work if the
account is `lvlrSajjad`, and the workflow field wants the filename only — `publish.yml`, not
a path.

Once that exists, the `NPM_TOKEN`-style secrets some guides tell you to add are unnecessary.
Don't add one; a stored token is the thing this setup exists to avoid.

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

- **`ENEEDAUTH` / 404 on the package** — the trusted publisher config on npmjs.com doesn't
  match. Check case and the workflow filename first; that is nearly always the cause.
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
