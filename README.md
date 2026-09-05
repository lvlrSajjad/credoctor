# credkit

**Prove your git credentials are actually correct — don't just read the config files.**

If you work for more than one organisation from one machine, every commit, push, API call
and browser login has to happen as the right identity. `includeIf` in `~/.gitconfig` handles
part of that, and [gitch](https://github.com/orzazade/gitch) and
[bgit](https://github.com/byterings/bgit) handle more of it.

credkit exists for the part none of them cover: **verifying that the whole thing works**.

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
git clone https://github.com/lvlrSajjad/credkit && cd credkit
npm install && npm run build
```

Requires Node 20+. macOS first; Linux support is planned.

## Use

```sh
node dist/cli.js import --write credkit.json   # draft config from your existing includeIf blocks
node dist/cli.js doctor                        # check every tree
node dist/cli.js doctor --offline              # skip network checks
node dist/cli.js doctor --json                 # machine-readable
```

`import` reads the `includeIf` blocks already in your `~/.gitconfig` and infers each tree's
SSH alias and orgs from the remotes actually in use. You shouldn't have to hand-write a
config describing a machine you already set up.

`doctor` exits non-zero on any failure, so it fits in a shell hook or CI.

```
credkit doctor — 7 tree(s), config ./credkit.json

  RZT
    pass  identity             sasadi-reztechfund <sasadi@reztechfund.com>
    pass  no-local-override    no repo overrides the tree identity
    pass  signing-key-email    key F236DD79… is bound to sasadi@reztechfund.com
    pass  remote-alias         6 repo(s) all use git@github-rzt
    pass  ssh-identity         greeted as sasadi-reztechfund
    pass  remote-reachable     ~/Coding/RZT/yeschef-project reachable
    pass  gh-account           sasadi-reztechfund (~/.config/gh-rzt)
    pass  gh-org-access        reaches 6 repo(s), e.g. reztechfund/yeschef-project
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

**v0.1, read-only.** `doctor` and `import` only. Provisioning (`credkit add`, `credkit
apply`) writes to `~/.gitconfig`, `~/.ssh/config` and the keychain — that blast radius isn't
worth taking until the checks have earned trust.

Known gaps: browser-profile mapping isn't verified yet; non-GitHub hosts (Bitbucket,
GitLab) are detected but their auth isn't understood; Linux keyring support is missing.

## Design notes

credkit invokes binaries **directly, never through a shell**. A `gh()` wrapper function
that forces `GH_CONFIG_DIR` from `$PWD` will otherwise override the environment credkit
sets, and every reading describes the shell's opinion instead of the store you asked about.
That mistake cost an afternoon and produced a confidently wrong diagnosis; it's encoded as
a correctness requirement in `src/sys.ts`.

`credkit.json` is gitignored — it names your trees and accounts. It holds no secrets, and
credkit never reads, prints or moves one.

## License

MIT
