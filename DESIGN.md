# credoctor — design

## The problem this exists for

Working for several organisations from one machine means every commit, push, API call and
browser login has to happen as the right identity. The usual advice — `includeIf` in
`~/.gitconfig` — solves *one fifth* of it, and there are already good tools
([gitch](https://github.com/orzazade/gitch), [bgit](https://github.com/byterings/bgit))
covering git identity plus SSH and signing keys.

That is not where this breaks in practice.

A day of setting up five separated trees on one Mac produced these failures. Every one of
them was **invisible at the config layer** — the files were correct and the system was
still wrong:

| What actually happened | Why config inspection missed it |
|---|---|
| SSH key registered on the right account, but the org enforces SAML SSO and the key was never **authorized** for it | `~/.ssh/config` and the key are perfect. Only a real `git ls-remote` reveals it. |
| `gh auth login` wrote an **unscoped `github.com` credential** to the macOS keychain, silently breaking a *different* tree's HTTPS remotes | Nothing in any config file changed. |
| A repo's **local** `user.email` overrode the tree's `includeIf` default, so commits went out under a stale identity | Both `~/.gitconfig` and the include file were right. |
| `gh`'s token store is keyed per host, not per `GH_CONFIG_DIR`, so separate stores could resolve to the same account | `hosts.yml` in each store named the correct, different user. |
| An OAuth **token** was SSO-authorized while the **SSH key** was not — they authorize separately | Two independent states, neither visible locally. |

The unit that matters is not "a git identity". It is a **credential domain**: everything
that must agree for one directory tree — git identity, SSH key, GPG signing key, `gh`
account, browser profile — plus the remote-side state (SSO authorization, org membership)
that no local file records.

**credoctor's thesis: verify reality, not configuration.** Reading config tells you what
should happen. Only a real call tells you what does.

## Shape

```
credoctor doctor          # read-only: prove every tree's domain is actually correct
credoctor import          # bootstrap credoctor.json from what is already on this machine
credoctor add <tree>      # (v2) provision a new tree across all subsystems in one transaction
credoctor apply           # (v2) make the machine match credoctor.json
```

v1 is `doctor` + `import` only. Provisioning writes to `~/.gitconfig`, `~/.ssh/config` and
the keychain; that blast radius is not worth taking until the checks are trustworthy.

### Config

`credoctor.json` (repo-local, or `~/.config/credoctor/config.json`) describes each tree:

```jsonc
{
  "trees": [
    {
      "name": "work",
      "path": "~/code/work",
      "git": { "name": "you-at-work", "email": "you@work.example" },
      "signingKey": "A1B2C3D4E5F60718",
      "sshAlias": "github-work",          // Host entry in ~/.ssh/config
      "sshAccount": "you-at-work",   // who GitHub should greet
      "ghConfigDir": "~/.config/gh",
      "ghAccount": "you-at-work",
      "browserProfile": "Profile 1",
      "orgs": ["workcorp"]             // must reach these
    }
  ]
}
```

`credoctor import` writes a first draft of this by reading the `includeIf` blocks already in
`~/.gitconfig`, the files they point at, `~/.ssh/config`, and `~/.config/gh*/hosts.yml`.
Nobody should have to hand-write it.

## Check catalogue

Each check names the real failure it exists to catch. `L` = local only (fast, offline),
`R` = makes a real network call.

| # | Check | Kind | Catches |
|---|---|---|---|
| 1 | Tree identity resolves to the configured name/email | L | A missing or mis-scoped `includeIf` |
| 2 | No repo in the tree has a **local** `user.email` differing from the tree default | L | The override that silently wins over `includeIf` |
| 3 | No identity is resolvable **outside** any configured tree (`user.useConfigOnly`) | L | Commits stamped `you@hostname` in a stray clone |
| 4 | Signing key's UID email matches the tree email, and `commit.gpgsign` is on | L | "Unverified" commits; a key reused across orgs |
| 5 | Signing key is not expired | L | Signatures that quietly stop verifying |
| 6 | Every repo's `origin` uses the tree's SSH alias (or an explicitly allowed form) | L | A remote falling back to the shared keychain credential |
| 7 | `ssh -T git@<alias>` is greeted as the expected account | R | Wrong key, unregistered key |
| 8 | `git ls-remote` succeeds on one repo per tree | R | **SSO-unauthorized key** — the failure config cannot show |
| 9 | `gh` in each store resolves to the expected account | R | Store/keyring mismatch |
| 10 | Each `gh` token reaches its own orgs **and is denied the others** | R | Token drift; over-broad access |
| 11 | No two trees share an SSH alias, `gh` store, or signing key | L | The coupling that makes one login break another tree |
| 12 | No unscoped `github.com` credential exists that two trees both depend on | L | The keychain entry one `gh auth login` overwrites |
| 13 | Browser profile directory exists and maps to the tree's account email | L | Links opening as the wrong identity |

Checks 8, 10 and 12 are the differentiated ones — they are the failures that cost real
time, and no existing tool tests them.

### Output contract

`doctor` prints one row per tree per check, exits `0` when clean and non-zero on any
failure, so it can run in a shell hook or CI. `--json` for machine consumption. A failure
prints the *remedy*, not just the fact: for an SSO-unauthorized key, the settings URL and
the exact button, because that is the step people miss.

## Non-goals

- Not a credential store. It never reads, prints or moves a secret. It asks subsystems
  whether they work.
- Not a git wrapper. No aliasing `git`; the system stays usable without credoctor installed.
- Not a Firefox/Safari reader. The browser check covers the Chromium family, which share
  one `Local State` format. Other engines need separate work and have not had it.

## Risks

- **Rate limits.** The `R` checks hit GitHub. Cache, and let `doctor --offline` run only
  the `L` set.
- **Destructive writes** in v2. Any mutation must back up first, be idempotent, and print a
  diff for confirmation. This is why v1 is read-only.
- **Shell-function interception.** A `gh` wrapper function can override an explicitly
  passed `GH_CONFIG_DIR`, so credoctor must invoke the real binary directly rather than
  through the user's shell. This one cost an afternoon and a wrong diagnosis; it is a
  correctness requirement, not a detail.
