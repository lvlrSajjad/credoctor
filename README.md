# credoctor

[![ci](https://github.com/lvlrSajjad/credoctor/actions/workflows/ci.yml/badge.svg)](https://github.com/lvlrSajjad/credoctor/actions/workflows/ci.yml)

**Prove your git credentials are actually correct — don't just read the config files.**

If you work for more than one organisation from one machine, every commit, push, API call
and browser login has to happen as the right identity. `includeIf` in `~/.gitconfig` handles
part of that, and [gitch](https://github.com/orzazade/gitch) and
[bgit](https://github.com/byterings/bgit) handle more of it.

credoctor exists for the part none of them cover: **verifying that the whole thing works**.

## Why config inspection isn't enough

These all happened while setting up five separated trees on one Mac. Every file involved
was correct. The system was still wrong:

- An SSH key was registered on the right account, but the org enforces SAML SSO and the key
  was never **authorized** for it. `~/.ssh/config` looked perfect. Only a real fetch failed.
- `gh auth login` wrote an **unscoped `github.com` credential** into the keychain and
  silently broke a *different* tree's remotes. No config file changed.
- A repo's **local** `user.email` quietly overrode the tree's `includeIf`, so commits went
  out under a stale identity. Both files were right.
- A **token** was SSO-authorized while the **SSH key** wasn't. They authorize separately.

The unit that matters isn't "a git identity" — it's a **credential domain**: everything that
must agree for one directory tree (git identity, SSH key, GPG signing key, `gh` account,
browser profile) plus the remote-side state no local file records.

## Install

```sh
npx credoctor doctor
```

Nothing to clone. Requires Node 20+. Tested on Linux, macOS and Windows in CI.

## Use

```sh
npx credoctor import --write credoctor.json   # draft config from your existing includeIf blocks
npx credoctor doctor                        # check every tree
npx credoctor doctor --offline              # local checks only, no network
npx credoctor doctor --json                 # machine-readable
```

`import` reads the `includeIf` blocks already in your `~/.gitconfig` and infers each tree's
SSH alias and orgs from the remotes actually in use. You shouldn't have to hand-write a
config describing a machine you already set up.

`doctor` exits non-zero on any failure, so it fits in a shell hook or CI.

```
credoctor doctor — 7 tree(s), config ./credoctor.json

  client
    pass  identity             you-at-client <you@client.example>
    pass  no-local-override    no repo overrides the tree identity
    pass  signing-key-email    key 9F0E1D2C… is bound to you@client.example
    pass  remote-alias         6 repo(s) all use git@github-client
    pass  ssh-identity         greeted as you-at-client
    pass  remote-reachable     ~/code/client/platform reachable
    pass  gh-account           you-at-client (~/.config/gh-client)
    pass  gh-org-access        reaches 6 repo(s), e.g. clientco/platform
    pass  gh-org-isolation     denied all 10 repo(s) belonging to other trees
```

That last line is the point: it didn't read a config file, it asked GitHub with that
token whether it could reach another tree's repositories, and confirmed it couldn't.

## What it checks

Identity resolution · local overrides that beat `includeIf` · signing key bound to the
right email · key expiry · `commit.gpgsign` · remotes using the tree's SSH alias · SSH
greeting per alias · **real reachability (catches SSO-unauthorized keys)** · `gh` account
per store · **per-token repo access and cross-tree isolation** · credentials shared between
trees that should be independent.

Full catalogue, and the real-world failure each check exists to catch, in
[DESIGN.md](./DESIGN.md).

## Status

**v0.1, read-only.** `doctor` and `import` only. Provisioning (`credoctor add`, `credoctor
apply`) writes to `~/.gitconfig`, `~/.ssh/config` and the keychain — that blast radius isn't
worth taking until the checks have earned trust.

Known gaps: non-GitHub hosts (Bitbucket, GitLab) are detected but their auth isn't
understood, so they surface as a generic reachability failure. Browser checks cover the
Chromium family (Chrome, Chromium, Edge, Brave) — Firefox and Safari aren't read yet.

## Design notes

credoctor invokes binaries **directly, never through a shell**. A `gh()` wrapper function
that forces `GH_CONFIG_DIR` from `$PWD` will otherwise override the environment credoctor
sets, and every reading describes the shell's opinion instead of the store you asked about.
That mistake cost an afternoon and produced a confidently wrong diagnosis; it's encoded as
a correctness requirement in `src/sys.ts`.

`credoctor.json` is gitignored — it names your trees and accounts. It holds no secrets, and
credoctor never reads, prints or moves one. Every example in this repo is fictional for the
same reason: a config describing real trees correlates your employers with each other.

## License

MIT
