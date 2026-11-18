# LCW Admin

A small console for administering **Learner Credential Wallet accounts**:
viewing them, filtering and searching them, exporting them as a CSV, and
deleting them. React + Vite, talking to
[lcw-admin-back-end](https://github.com/digitalcredentials/lcw-admin-back-end).

This is not part of the wallet. It is a separate application, with separate
sign-in, that reaches the wallet only through the accounts table. The wallet
itself is [lcw-front-end][fe], [lcw-back-end][be] and [was-server-aws][was].

[fe]: https://github.com/digitalcredentials/lcw-front-end
[be]: https://github.com/digitalcredentials/lcw-back-end
[was]: https://github.com/digitalcredentials/was-server-aws

## What an admin can see and do

An account, as this console shows it, is an email, the `did:webvh` the
account registered, when it registered, and the tester's answer to "Contact me
with news and updates" with when they gave it. Credentials are not here. They
live, encrypted, in the account's storage Space, which this console and the
API behind it have no access to whatsoever.

| | |
| --- | --- |
| **Accounts** | Every account in one table: filter by column, search all columns, export the rows shown as a CSV |
| **Account** | One account, its contact choice, what admins have done to it, and deleting it |
| **Delete** | Remove the account row, keeping a copy that can restore it |
| **Activity** | Everything every admin has done, newest first, paged |

There is no way to create a wallet account here. Registration stays
user-initiated, through the wallet's own email confirmation flow.

## The accounts table

The Accounts page loads every account, a page of 200 at a time until the API
has no more, and then filters, searches and exports in the browser, so all of
it is instant and exact for the hundreds or thousands of accounts a sandbox
holds.

- **Filter by column.** Under each heading: Contact is a choice (Agreed, Not
  agreed); the others match whatever is typed, anywhere in the value and in any
  case. Dates are ISO days (`2026-11-18`), so typing `2026-11` keeps a month.
- **Search** matches the same way across every column at once.
- **Export CSV** saves exactly the rows on screen - the filters and the search
  applied - with the columns `email`, `did`, `registered`, `contact` and
  `contact_last_changed`. A cell that a spreadsheet would run as a formula
  (one starting `=`, `+`, `-` or `@`, which an email address may) is written
  with a leading apostrophe.

So the list of testers who agreed to be contacted is Contact set to Agreed,
then Export CSV. An account registered before the question was asked reads as
Not agreed.

## What the console will not claim

Three states are easy to report wrongly, and each would mislead an admin about
something irreversible:

- **An unreachable API is not a deleted account, and neither is an unknown
  address.** The API answers 404 for any email it holds no row for, so the
  deletion banner follows the log instead: it appears only when the history
  contains the removed row that would restore the account. An address that was
  never registered says exactly that, and a request that failed says the account
  may well still exist.
- **A recorded action that did not apply is not a completed one.** The API
  appends a correction (`account.delete.aborted`) rather than editing the log,
  and it renders as "recorded but not applied". Any action this console does
  not recognise shows its raw name rather than being labelled as something it
  might not be.
- **A request that could not be read back is not a request that did nothing**,
  and a request that was never sent is not either. Where the browser cannot see
  the response (see below), a failed delete says exactly that and asks the admin
  to reload before retrying; a failure that never reached the network says
  plainly that nothing was changed. And once a deletion has been confirmed,
  nothing afterwards can report it as uncertain - if the removed row cannot be
  downloaded it is put on screen instead, rather than lost.

## Signing in

Admin accounts are separate from wallet accounts - a wallet passphrase does not
work here, and no wallet account can be turned into an admin. Admins are
registered out of band with `scripts/add-admin.mjs` in lcw-admin-back-end.

The passphrase never leaves the browser. It derives an Ed25519 key
(`SHA-256(passphrase)` as the seed, the derivation `add-admin.mjs --passphrase`
uses too), and that key signs every request individually; the API verifies each
signature against the DID registered for it. Nothing is issued at sign-in -
there is no token or cookie to steal, and no session on the server.

The derived key is kept in `sessionStorage` rather than `localStorage`, so it
does not outlive the browser tab. This is a more powerful credential than a
wallet holder's, and it should be held for less time.

`RequireAuth` hides pages from someone who has not signed in, but it is a
convenience, not a control: the API refuses unsigned and unauthorized requests
on its own, so nothing here depends on the console hiding a button.

## Deleting an account

**Deleting an account stops it signing in, without destroying anything.** The
row is what lets someone sign in to the wallet - lcw-back-end's sign-in answers
only an email the table holds - so removing it locks the account out. Its
storage and the credentials in it are untouched, and stay under the account's
own keys: the API holds no permission over them at all. The removed row is
recorded in the activity log *and* downloaded to the admin who removed it, every
attribute included, because putting that row back restores the account exactly
as it was.

There is no "reset the DID" action. An account's DID controls its own storage,
so replacing the row's DID would only lock the tester out; a tester who loses
their password recovers through the wallet's recovery codes.

## Running it locally

Needs DynamoDB Local on `:8000` and the admin API running (see lcw-admin-back-end's
`AGENTS.md`). Then:

```bash
npm install
cp .env.example .env
npm run dev -- --port 5174
```

`5174` by convention, beside the wallet's own front end on `5173`; any free
port works. `.env` points the console at the admin API, whose own
`ExpectedHost` must name the same host and port:

```
VITE_ADMIN_API_BASE_URL=http://localhost:3002
```

Sign in with the admin you registered using lcw-admin-back-end's
`scripts/add-admin.mjs`.

## Deploying

The sandbox serves the console at `admin.lcw-sandbox.org` from a private S3
bucket behind CloudFront ([`infra/template.yaml`](infra/template.yaml): the
bucket, the distribution with AWS's security-headers policy, the certificate
validated through the zone, and the alias records). It calls the admin API at
`admin-api.lcw-sandbox.org`, which `.env.production` bakes into the build.

Once, for the hosting (in us-east-1, where CloudFront keeps its certificates):

```bash
aws cloudformation deploy --stack-name lcw-admin-console --template-file infra/template.yaml \
  --parameter-overrides DomainName=admin.lcw-sandbox.org HostedZoneId=Z04250862QG6MQUAE24XV
```

Then for every release, with the bucket and distribution the stack outputs:

```bash
npm run build
aws s3 sync dist/ s3://<BucketName>/ --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"
```

The admin API stack must be deployed with `ExpectedHost=admin-api.lcw-sandbox.org`
(see lcw-admin-back-end's README), and at least one admin registered, before
anyone can sign in.

## Tests

```bash
ADMIN_EMAIL=you@example.org ADMIN_PASSPHRASE='a long passphrase' npm run test:e2e
```

Playwright, against the local stack. The suite signs in, lists and searches
the accounts, filters by column and checks the exported CSV is exactly the
filtered rows, reads an account's contact choice, and deletes an account,
checking that the accounts table actually changed and that the removed row was
kept. It seeds two throwaway accounts of its own (one that agreed to be
contacted, one registered before the question) and removes them afterwards, so
it never touches anyone else's. With the console on another port, set
`BASE_URL` (Playwright otherwise starts or reuses whatever answers on `5174`).

Two things the suite has to work around, both worth knowing:

- **A refused request can be unreadable.** `sam local` returns an authorizer
  denial without CORS headers, so the browser will not let the page see the
  403 - it arrives as a network error instead. That is why a failed sign-in
  says the passphrase may not be an admin *or* the API may be unreachable: from
  inside the browser, locally, the two are genuinely indistinguishable.
- **The activity log is append-only**, so a throwaway account's history
  accumulates across runs. Assertions have to name what this run did rather
  than match on the log in general.
