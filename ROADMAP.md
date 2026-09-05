# Roadmap

## Where it is

**v0.1 — read-only. Linux, macOS and Windows, verified in CI.** The full check catalogue from `DESIGN.md` is implemented and
runs green against a real 7-tree machine. A CLI (`doctor`, `import`) and an Electron viewer
over it.

## Next

**~~1. Linux support.~~ Done.** Chromium-family profile roots resolve per platform
(XDG/snap/flatpak on Linux, LOCALAPPDATA on Windows), binary lookup no longer assumes
`/usr/bin/which`, and CI runs the functional smoke test on ubuntu, macos and windows across
node 20 and 22.

**1. Packaging.** `npx credkit doctor` has to work without cloning. Publish to npm; ship the
GUI as a signed `.dmg`/AppImage separately, since most people will only ever want the CLI.

**2. Non-GitHub hosts.** Bitbucket and GitLab remotes are detected but their auth is not
understood — today they surface as a generic reachability failure. GitLab has an equivalent
of the SSO-authorization trap worth modelling.

**3. Provisioning (`credkit add`, `credkit apply`).** The feature people will ask for first
and the one most able to damage a working setup. Requirements before it ships: back up every
file it touches, be idempotent, print a diff and require confirmation, and never touch the
keychain without an explicit flag. Deliberately last.

**4. Shell integration.** An optional `cd` hook that warns when you enter a tree whose domain
is failing — the check you want *before* you commit, not after.

## Launch

Two things have to be true before promoting it, and neither is negotiable:

- **It works in under a minute for a stranger.** `npx credkit doctor` on a machine that has
  never seen it, no clone, no build.
- **It is honest about gaps.** The README already lists them. Keep that section; it is the
  difference between a tool people trust and one they bounce off when the first thing fails.

### The post

The hook is not the feature list. It is the story: *five GitHub accounts on one Mac, every
config file correct, and it was still wrong four different ways.* That is specific, it is
verifiable, and every developer with two accounts has felt the shape of it. Lead with the
failures — the SSO-authorized token whose matching key was not, the `gh auth login` that
overwrote a shared keychain entry and broke a different project, the repo-local `user.email`
that silently beat `includeIf` — then show the `doctor` output as the payoff.

Where to put it, in rough order of value for a developer tool:

| Venue | Why |
|---|---|
| **Show HN** | Highest-leverage single post. Tue–Thu, ~8–10am ET. Title states what it does, no adjectives. Be in the thread to answer for the first few hours — that participation matters more than the post. |
| **Your own domain** | The canonical copy. Owns the SEO and survives platform decay. |
| **r/git, r/programming, r/devops** | Read the rules; several ban self-promotion without participation history. |
| **X thread** | Good amplification, weak discovery on its own unless someone with reach picks it up. |
| **Lobsters, dev.to** | Small but high-signal audiences. |

**Medium is the weakest option** on that list for a developer tool — paywalled reads, little
organic dev traffic, and no code-oriented audience left. If you want a hosted blog, dev.to or
a static site on your own domain will both outperform it.

### Be ready for the obvious criticism

*"This is just `includeIf` plus a shell script."* The answer is the one the README already
makes: config correctness is not the problem being solved. Every failure listed happened
**with correct config**. Have that answer ready in one sentence, because it is the first
comment you will get and it decides how the thread goes.

### Realistically

Virality is an outcome, not a strategy. What is controllable: a tool that works immediately,
a post with a specific story rather than a feature list, posted where developers actually
look, on a day they are looking, with the author present in the comments. Do those four and
the post has a real chance. Skip any of them and it does not, regardless of how good the tool
is. Do not buy engagement, and do not blast every venue on the same day — pick one anchor
post and let the others follow it.
