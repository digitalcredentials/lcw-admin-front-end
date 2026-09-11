# LCW Admin

A small console for administering **Learner Credential Wallet accounts**:
viewing them, searching them, deleting them, and resetting the DID that
controls one. React + Vite, talking to
[lcw-admin-backend](https://github.com/digitalcredentials/lcw-admin-backend).

This is not part of the wallet. It is a separate application, with separate
sign-in, that reaches the wallet only through the accounts table. The wallet
itself is [lcw-front-end][fe], [lcw-back-end][be] and [was-server-aws][was].

[fe]: https://github.com/digitalcredentials/lcw-front-end
[be]: https://github.com/digitalcredentials/lcw-back-end
[was]: https://github.com/digitalcredentials/was-server-aws

## What an admin can see and do

An account is four fields - an email, the `did:key` that controls it, the URL
of its Wallet Attached Storage space, and when it was registered - and that is
the whole of what this console shows. Credentials are not here. They live in
the account holder's space, which this console and the API behind it have no
access to whatsoever.

| | |
| --- | --- |
| **Accounts** | Every account, searchable by email, DID or space |
| **Account** | One account, what admins have done to it, and the two actions below |
| **Reset the controlling DID** | Hand the account to a different key |
| **Delete** | Remove the account row, keeping a copy that can restore it |
| **Activity** | Everything every admin has done, newest first |

There is no way to create a wallet account here. Registration stays
user-initiated, through the wallet's own email confirmation flow.

## Signing in

Admin accounts are separate from wallet accounts - a wallet passphrase does not
work here, and no wallet account can be turned into an admin. Admins are
registered out of band with `scripts/add-admin.mjs` in lcw-admin-backend.

The passphrase never leaves the browser. It derives an Ed25519 key
(`SHA-256(passphrase)` as the seed, the same derivation the wallet uses), and
that key signs every request individually; the API verifies each signature
against the DID registered for it. Nothing is issued at sign-in - there is no
token or cookie to steal, and no session on the server.

The derived key is kept in `sessionStorage` rather than `localStorage`, so it
does not outlive the browser tab. This is a more powerful credential than a
wallet holder's, and it should be held for less time.

`RequireAuth` hides pages from someone who has not signed in, but it is a
convenience, not a control: the API refuses unsigned and unauthorized requests
on its own, so nothing here depends on the console hiding a button.

## The two consequential actions

**Resetting the controlling DID hands the account over.** Whoever holds the new
key can sign in as that person and open everything in their space, immediately
and silently. Two ways to do it:

- *Use a DID the account holder generated* - they keep their passphrase, and
  only their public DID is ever entered here. This is the right way.
- *Choose a passphrase on their behalf* - for when they cannot generate a DID
  themselves, which is currently everyone, because the wallet has no screen
  that shows someone their own DID. It means briefly holding a credential that
  opens their wallet.

Closing that gap is a change to the wallet, not to this console: a "generate a
new key / show my DID" affordance in lcw-front-end would make the first option
usable and the second unnecessary.

**Deleting an account revokes access without destroying anything.** The row is
what lets someone sign in and what proves to the WAS server that they control
their space, so removing it locks the account out. The space and the
credentials in it are untouched - the API holds no S3 permission at all. The
removed row is recorded in the activity log *and* downloaded to the admin who
removed it, because putting that row back restores the account exactly as it
was.

## Running it locally

Needs the wallet's local stack (DynamoDB Local on `:8000`; see `AGENTS.md` in
[lcw-front-end][fe]) and the admin API on `:3002` (see lcw-admin-backend's
README). Then:

```bash
npm install
cp .env.example .env
npm run dev -- --port 5174
```

`5174` rather than `5173`, so this and the wallet's own front end can run side
by side. `.env` points the console at the admin API:

```
VITE_ADMIN_API_BASE_URL=http://localhost:3002
```

Sign in with the admin you registered using lcw-admin-backend's
`scripts/add-admin.mjs`.

## Tests

```bash
npm run test:e2e
```

Playwright, against the local stack. The suite signs in, searches, resets a
DID, and deletes an account, checking each time that the accounts table
actually changed and that the action was recorded. It creates a throwaway
account of its own and removes it afterwards, so it never touches the wallet's
seeded demo account.

Two things the suite has to work around, both worth knowing:

- **A refused request can be unreadable.** `sam local` returns an authorizer
  denial without CORS headers, so the browser will not let the page see the
  403 - it arrives as a network error instead. That is why a failed sign-in
  says the passphrase may not be an admin *or* the API may be unreachable: from
  inside the browser, locally, the two are genuinely indistinguishable.
- **The activity log is append-only**, so a throwaway account's history
  accumulates across runs. Assertions have to name what this run did rather
  than match on the log in general.
