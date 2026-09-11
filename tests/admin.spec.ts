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
