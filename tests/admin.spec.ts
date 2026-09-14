import { test, expect, type Page } from '@playwright/test'
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand
} from '@aws-sdk/client-dynamodb'

// Runs against the local stack: DynamoDB Local on :8000 and the admin API on
// :3002. See README.md. The admin these tests sign in as must already be
// registered - lcw-admin-backend's scripts/add-admin.mjs does that.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.org'
const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE ?? 'admin-secret-seed-that-is-long-e'
const ACCOUNT_TABLE = process.env.ACCOUNT_TABLE ?? 'wallet-test'

// A throwaway account, created and cleaned up by these tests. Nothing here
// touches an account it did not make, so the wallet's own local stack (and its
// seeded demo account) is unaffected.
const TEST_EMAIL = 'playwright-admin@example.org'
const TEST_DID = 'did:key:z6MkfDLjE5Kip9E7YRitEbrNAcCYi2AviAY8Ny7hoYnCSgav'
const REPLACEMENT_DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'

// Named as the backend names it, so one export configures both.
const AUDIT_TABLE = process.env.AUDIT_TABLE_NAME ?? 'lcw-admin-audit'

const dynamo = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: process.env.DYNAMO_ENDPOINT_URL ?? 'http://localhost:8000',
  credentials: { accessKeyId: 'localtest', secretAccessKey: 'localtest' }
})

async function seedAccount() {
  await dynamo.send(new PutItemCommand({
    TableName: ACCOUNT_TABLE,
    Item: {
      email: { S: TEST_EMAIL },
      did: { S: TEST_DID },
      spaceURL: { S: 'http://localhost:3000/space/dcc-was-playwright-admin' },
      CreatedAt: { S: new Date().toISOString() }
    }
  }))
}

async function removeAccount() {
  await dynamo.send(new DeleteItemCommand({
    TableName: ACCOUNT_TABLE,
    Key: { email: { S: TEST_EMAIL } }
  }))
}

async function readAccount() {
  const { Item } = await dynamo.send(new GetItemCommand({
    TableName: ACCOUNT_TABLE,
    Key: { email: { S: TEST_EMAIL } }
  }))
  return Item
}

// Writes one record straight into the log, to render states the UI cannot be
// driven into on demand.
const seededAuditKeys: { targetEmail: string; createdAt: string }[] = []

async function seedAuditRecord(action: string, detail: object) {
  const createdAt = new Date().toISOString()
  seededAuditKeys.push({ targetEmail: TEST_EMAIL, createdAt })
  await dynamo.send(new PutItemCommand({
    TableName: AUDIT_TABLE,
    Item: {
      targetEmail: { S: TEST_EMAIL },
      createdAt: { S: createdAt },
      log: { S: 'all' },
      action: { S: action },
      adminDid: { S: 'did:key:z6MkuFws5wb95oYR5ZihACEdQUTxQEgZ3t5kp78Xbv4P7ukJ' },
      adminEmail: { S: ADMIN_EMAIL },
      detail: { S: JSON.stringify(detail) }
    }
  }))
}

async function signIn(page: Page) {
  await page.goto('/')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Passphrase').fill(ADMIN_PASSPHRASE)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
}

test.beforeEach(async () => {
  await seedAccount()
})

test.afterEach(async () => {
  await removeAccount()
  // The log is append-only by design, so a test that writes to it has to clean
  // up directly - otherwise every run leaves a permanent record behind and the
  // throwaway account's history grows past what account-get returns.
  while (seededAuditKeys.length > 0) {
    const key = seededAuditKeys.pop()!
    await dynamo.send(new DeleteItemCommand({
      TableName: AUDIT_TABLE,
      Key: { targetEmail: { S: key.targetEmail }, createdAt: { S: key.createdAt } }
    }))
  }
})

test('refuses a passphrase that is not a registered admin', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill('nobody@example.org')
  await page.getByLabel('Passphrase').fill('definitely not an admin passphrase')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('registered admin')
})

test('lists and searches accounts', async ({ page }) => {
  await signIn(page)
  await page.getByLabel('Search accounts').fill('playwright-admin')
  await expect(page.getByRole('link', { name: TEST_EMAIL })).toBeVisible()
})

test('resets the controlling DID and records who did it', async ({ page }) => {
  await signIn(page)
  await page.getByLabel('Search accounts').fill('playwright-admin')
  await page.getByRole('link', { name: TEST_EMAIL }).click()

  await page.getByLabel('New controlling DID').fill(REPLACEMENT_DID)
  await page.getByLabel('Reason for the reset').fill('playwright')
  await page.getByRole('button', { name: 'Reset controlling DID' }).click()

  // Wait on the account's own displayed DID rather than on the history, which
  // carries entries from earlier runs: this log is append-only, so the same
  // throwaway email accumulates them.
  await expect(page.getByRole('button', { name: REPLACEMENT_DID })).toBeVisible()
  expect((await readAccount())?.did?.S).toBe(REPLACEMENT_DID)

  // The previous DID is kept, which is what makes the handover reversible.
  await expect(page.getByText(TEST_DID, { exact: false }).first()).toBeVisible()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByRole('cell', { name: TEST_EMAIL }).first()).toBeVisible()
  // The feed says what the handover changed, not merely that one happened.
  // DIDs are truncated there, so the full value is matched on the title.
  await expect(page.getByTitle(REPLACEMENT_DID, { exact: false }).first()).toBeVisible()
  await expect(page.getByTitle(TEST_DID, { exact: false }).first()).toBeVisible()
})

test('deletes an account, keeping the row that was removed', async ({ page }) => {
  await signIn(page)
  await page.getByLabel('Search accounts').fill('playwright-admin')
  await page.getByRole('link', { name: TEST_EMAIL }).click()

  // The confirmation is the account's own email, typed out.
  const deleteButton = page.getByRole('button', { name: 'Delete account' })
  await expect(deleteButton).toBeDisabled()
  await page.getByLabel(`Type ${TEST_EMAIL} to confirm`).fill(TEST_EMAIL)

  const download = page.waitForEvent('download')
  await deleteButton.click()
  expect((await download).suggestedFilename()).toContain(TEST_EMAIL)

  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
  expect(await readAccount()).toBeUndefined()

  // The account is gone, but its history - and the row itself - remain.
  await page.goto(`/#/account?email=${encodeURIComponent(TEST_EMAIL)}`)
  await expect(page.getByText('no longer exists')).toBeVisible()
  await page.getByText('The removed row').first().click()
  await expect(page.getByText('dcc-was-playwright-admin').first()).toBeVisible()
})


// The API appends a correction when an action was recorded and then did not
// apply. Showing that as a completed handover would tell an admin the opposite
// of what happened.
test('shows an aborted DID reset as not applied', async ({ page }) => {
  await seedAuditRecord('account.did.reset.aborted', {
    newDid: REPLACEMENT_DID,
    why: 'The account changed between reading it and writing it; nothing was changed.'
  })

  await signIn(page)
  await page.goto(`/#/account?email=${encodeURIComponent(TEST_EMAIL)}`)

  await expect(page.getByText('DID reset recorded but not applied').first()).toBeVisible()
  await expect(page.getByText('nothing was changed').first()).toBeVisible()

  // And on the feed, where the same two DIDs would otherwise read as a
  // handover that took place.
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByText('DID reset recorded but not applied').first()).toBeVisible()
  await expect(page.getByText('would have been').first()).toBeVisible()
})

// Moving between accounts must not leave a destructive panel armed for the one
// that was on screen a moment ago.
test('clears the delete confirmation when switching accounts', async ({ page }) => {
  const other = 'playwright-admin-other@example.org'
  await dynamo.send(new PutItemCommand({
    TableName: ACCOUNT_TABLE,
    Item: {
      email: { S: other },
      did: { S: REPLACEMENT_DID },
      spaceURL: { S: 'http://localhost:3000/space/dcc-was-playwright-other' },
      CreatedAt: { S: new Date().toISOString() }
    }
  }))

  try {
    await signIn(page)
    await page.goto(`/#/account?email=${encodeURIComponent(TEST_EMAIL)}`)
    await page.getByLabel(`Type ${TEST_EMAIL} to confirm`).fill(TEST_EMAIL)
    await expect(page.getByRole('button', { name: 'Delete account' })).toBeEnabled()

    await page.goto(`/#/account?email=${encodeURIComponent(other)}`)
    await expect(page.getByRole('heading', { name: other })).toBeVisible()
    await expect(page.getByLabel(`Type ${other} to confirm`)).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Delete account' })).toBeDisabled()
  } finally {
    await dynamo.send(new DeleteItemCommand({
      TableName: ACCOUNT_TABLE,
      Key: { email: { S: other } }
    }))
  }
})


// The passphrase an admin chooses on someone's behalf is the only way into that
// account afterwards: it is not in the audit log, which stores only the public
// DID. It must survive the reload that follows the reset.
test('keeps the admin-chosen passphrase on screen after the reset', async ({ page }) => {
  const passphrase = 'a passphrase chosen for the account holder'

  await signIn(page)
  await page.goto(`/#/account?email=${encodeURIComponent(TEST_EMAIL)}`)
  await page.getByRole('radio', { name: /Choose a passphrase on their behalf/ }).check()
  await page.getByLabel('Passphrase for the account holder').fill(passphrase)
  await page.getByRole('button', { name: 'Reset controlling DID' }).click()

  await expect(page.getByText('then forget it')).toBeVisible()
  await expect(page.getByText(passphrase, { exact: false })).toBeVisible()

  // Still there once the reload has completed and the panels have remounted.
  await expect(page.getByText('Controlling DID reset').first()).toBeVisible()
  await expect(page.getByText(passphrase, { exact: false })).toBeVisible()
})

// The API answers 404 for any email it has no row for. Reporting that as a
// deletion would tell an admin an account was destroyed that never existed.
test('does not claim an unknown address was deleted', async ({ page }) => {
  await signIn(page)
  await page.goto(`/#/account?email=${encodeURIComponent('never-registered@example.org')}`)

  await expect(page.getByText('No wallet account is registered')).toBeVisible()
  await expect(page.getByText('no longer exists')).toHaveCount(0)
})
