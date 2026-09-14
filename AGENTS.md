# AGENTS.md

Notes for agents and developers working on the LCW Admin console.

**`README.md` is the authority on what this console is** — what an admin can
see and do, the three states it deliberately refuses to report wrongly, how
sign-in works, and why resetting a controlling DID is a handover rather than a
password change. Read it first. This file covers only how to get a working
environment and what to run in it.

## What you need running

Three processes. The console talks to exactly one thing — the admin API, via
`VITE_ADMIN_API_BASE_URL`, the only environment variable it reads — and that API
talks to DynamoDB only:

| Process | Port | From |
| --- | --- | --- |
| DynamoDB Local | 8000 | `lcw-front-end/scripts/local-stack/up.sh`, or the one-liner in `lcw-admin-backend/AGENTS.md` |
| the admin API | 3002 | `lcw-admin-backend` |
| the admin console (this one) | 5174 | `npm run dev -- --port 5174` |

You do **not** need the wallet running — not MinIO, not `was-server-aws`, not
`lcw-back-end`, and not the wallet's own front end. Bring up
`lcw-admin-backend` first, following its `AGENTS.md`, which includes registering
yourself as an admin with `scripts/add-admin.mjs`. Without that there is no
admin to sign in as, and the console is unusable.

## Bring it up

```bash
npm ci
cp .env.example .env
npm run dev -- --port 5174
```

Port `5174` rather than `5173` so this and the wallet's own front end can run
side by side. `.env` is gitignored; `.env.example` already carries the only
value it needs:

```
VITE_ADMIN_API_BASE_URL=http://localhost:3002
```

That must match the `ExpectedHost` the admin API was started with, letter case
aside, or every request fails host pinning.

Sign in with the email and passphrase you passed to `add-admin.mjs`. A wallet
passphrase will not work: admins live in their own table, and no wallet account
can be escalated into one.

## Tests

```bash
npm run test:e2e
```

Playwright, against the local stack, so all three processes above must be up.
The suite signs in, searches, resets a DID and deletes an account, checking each
time that the table actually changed and that the action was recorded. It
creates a throwaway account of its own and removes it afterwards, so it never
touches the wallet's seeded demo account.

Two things the suite works around, both documented in `README.md` and both worth
knowing before you debug a failure:

- **A refused request can be unreadable.** `sam local` returns an authorizer
  denial without CORS headers, so the browser never lets the page see the 403 —
  it surfaces as a network error. Locally, "not an admin" and "API unreachable"
  are genuinely indistinguishable from inside the browser, which is why the
  sign-in error says both.
- **The activity log is append-only**, so a throwaway account's history
  accumulates across runs. Assertions name what the current run did rather than
  matching the log in general.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run lint` (oxlint) and
`npm run build` (`tsc -b && vite build`) on every pull request, whatever its
base branch.

It does **not** run `npm run test:e2e`: Playwright needs all three processes
above, and the API needs either AWS credentials or the local DynamoDB
substitute. So **CI here gates typechecking and linting only** — a green check
means the console compiles, not that it works. The e2e suite is the thing that
actually exercises behaviour, and it currently runs locally only. Wiring it into
CI is worthwhile and is its own piece of work.

`npm run lint` currently passes with three `react(set-state-in-effect)`
warnings in `AuditPage.tsx` and `AccountPage.tsx`. oxlint exits 0 on warnings,
so they do not fail the build; they are worth clearing rather than leaving to
accumulate.
