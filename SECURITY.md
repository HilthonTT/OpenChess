# Security Policy

## Supported versions

OpenChess is developed on `main`, and that is the only branch that receives
fixes. If you are running an older checkout, update before reporting.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/HilthonTT/OpenChess/security/advisories/new)
— that opens a draft advisory only the maintainers can see, and it keeps the
discussion, the fix and the eventual disclosure in one place.

Useful things to include:

- What an attacker can do, and what they need to already have to do it
- The steps to reproduce it, or a proof of concept
- The commit you tested against

You will get an acknowledgement as soon as the report is read. This is a hobby
project with a single maintainer, so please don't expect a same-day reply — but
a report will not be left unanswered.

## Scope

Things worth reporting:

- Anything that lets one account read or change another account's data —
  games, friends, chat, coins, titles, or ratings
- Authentication or token handling flaws: the OAuth flow, the token stored at
  `~/.openchess/auth.json`, or a route that accepts a token it should not
- Anything that lets a client award itself XP, coins, rating, or an achievement
- Escape sequences in user-controlled text (usernames, chat) that a terminal
  would act on rather than print
- SQL injection, SSRF, or remote code execution anywhere in the server

Things that are already known and are not vulnerabilities:

- **The auth token is stored in plaintext** at `~/.openchess/auth.json`, mode
  `0600`. This is what a CLI tool can do without asking for a keychain on three
  platforms. Windows ignores POSIX modes; there the file inherits the home
  directory's ACL.
- **Error responses include `detail` and `stack` outside production.** That is
  deliberate and local-only — `NODE_ENV=production` turns it off, and the
  README says so.
- Anything requiring an attacker to already have write access to the machine
  running the CLI.

## Handling secrets

The repository does not contain credentials. `.env` is gitignored and
`.env.example` holds only placeholders. If you believe a real key has been
committed, report it privately as above rather than opening an issue — a public
issue is a broadcast of exactly where to look.
