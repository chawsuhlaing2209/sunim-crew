# Security

## Reporting something

Open a private security advisory on the repository, or email the maintainer. Please do not open a public issue for a vulnerability.

Tell us what you found, how to reproduce it, and what it lets somebody do. You will get an answer.

## What this project promises

**No secret is ever stored here.** Every key comes from your environment. `.env`, `sunim.config.json` and anything shaped like a key are git ignored, and the repository is scanned before every push.

**A worker holds only what it needs.** The child process for a worker is built from an allowlist, starting from empty. Asking for a forbidden name throws at the call site rather than failing quietly:

- `AIRTABLE_TOKEN` and `AIRTABLE_BASE_ID`, because a worker that could write evidence could move a component without doing the work
- `NPM_TOKEN`, because publishing is irreversible and gated

**Verification and mutation are separate credentials.** The GitHub token is read only. It confirms a commit resolves. It cannot push, so it cannot be used to fake one. Pushes run on the machine's own git auth.

**Publishing is not automatable.** A component reaches production only after a named person approves it, and the approval is tied to the exact commit. Change the code and it lapses. With no approvers configured, nothing can ever ship.

**The status cannot be written.** It is an Airtable formula. The client refuses a write to it twice over: once because config names it as a formula field, and once because the base reports it as computed. The crew refuses to start against a base where that field is not a formula.

## What it does not promise

**A worker runs with your Anthropic key and can spend it.** Timeouts and per delegation budgets are there, but a worker doing the wrong thing expensively is possible.

**A worker can run shell commands in the design system repo.** The tools it may use are an allowlist, but that allowlist includes git and the repo's own scripts. Do not point this at a repo you would not let a colleague push to.

**Prompt content is not trusted input.** A design file, a test row or an Asana comment could carry text aimed at a worker. The briefs bound what each worker may do, and nothing a worker says is believed without a check, but do not treat a worker's context as safe.

## If a key leaks

Rotate it at the source, then rotate it here. The crew stores nothing, so there is nothing to purge on this side. Check `logs/` for anything a delegation printed, since that directory holds whatever a worker wrote to stdout.
