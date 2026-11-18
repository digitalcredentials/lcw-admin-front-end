import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  type AttributeValue
} from '@aws-sdk/client-dynamodb'

// Runs against the local stack: DynamoDB Local on :8000 and the admin API on
// :3002. See README.md. The admin these tests sign in as must already be
// registered - lcw-admin-backend's scripts/add-admin.mjs does that.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.org'
const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE ?? 'admin-secret-seed-that-is-long-e'
const ACCOUNT_TABLE = process.env.ACCOUNT_TABLE ?? 'lcw-accounts'

// Throwaway accounts, created and cleaned up by these tests, in the shape
// lcw-back-end writes: one that agreed to be contacted, one registered before
// the question was asked. Nothing here touches an account it did not make.
const TEST_EMAIL = 'playwright-admin@example.org'
const EARLIER_EMAIL = 'playwright-admin-earlier@example.org'
const TEST_DID = 'did:key:z6MkfDLjE5Kip9E7YRitEbrNAcCYi2AviAY8Ny7hoYnCSgav'
const OTHER_DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const REGISTRATION_CODE = 'playwright-registration-code'
const AGREED_AT = '2026-11-18T12:00:00.000Z'

const dynamo = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: process.env.DYNAMO_ENDPOINT_URL ?? 'http://localhost:8000',
  credentials: { accessKeyId: 'localtest', secretAccessKey: 'localtest' }
})

async function seedAccounts() {
  const rows: Record<string, AttributeValue>[] = [
    {
      email: { S: TEST_EMAIL },
      did: { S: TEST_DID },
      token: { S: REGISTRATION_CODE },
      CreatedAt: { S: AGREED_AT },
      contactOptIn: { BOOL: true },
      contactOptInUpdatedAt: { S: AGREED_AT }
    },
    {
      email: { S: EARLIER_EMAIL },
      did: { S: OTHER_DID },
      token: { S: REGISTRATION_CODE },
      CreatedAt: { S: '2026-11-01T09:00:00.000Z' }
    }
  ]
  for (const item of rows) {
    await dynamo.send(new PutItemCommand({ TableName: ACCOUNT_TABLE, Item: item }))
  }
}

async function removeAccounts() {
  for (const email of [TEST_EMAIL, EARLIER_EMAIL]) {
    await dynamo.send(new DeleteItemCommand({
      TableName: ACCOUNT_TABLE,
      Key: { email: { S: email } }
    }))
  }
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
  // Every account is loaded before the table can be filtered
  await expect(page.getByText(/^Showing \d+ of \d+ accounts$/)).toBeVisible()
}

test.beforeEach(async () => {
  await seedAccounts()
})

test.afterEach(async () => {
  await removeAccounts()
})

test('refuses a passphrase that is not a registered admin', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill('nobody@example.org')
  await page.getByLabel('Passphrase').fill('definitely not an admin passphrase')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('registered admin')
})

test('lists every account, and searches all columns', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('link', { name: TEST_EMAIL })).toBeVisible()
  await expect(page.getByRole('link', { name: EARLIER_EMAIL })).toBeVisible()
  // The search reaches every column, the contact choice included
  await page.getByLabel('Search accounts').fill('playwright-admin-earlier')
  await expect(page.getByRole('link', { name: EARLIER_EMAIL })).toBeVisible()
  await expect(page.getByRole('link', { name: TEST_EMAIL })).toHaveCount(0)
})

test('filters by column and exports exactly the filtered rows', async ({ page }) => {
  await signIn(page)
  await page.getByLabel('Filter Email').fill('playwright-admin')
  await expect(page.getByText('Showing 2 of', { exact: false })).toBeVisible()
  // An account registered before the question reads as not agreed
  const contact = page.getByLabel('Filter Contact', { exact: true })
  await contact.selectOption('Not agreed')
  await expect(page.getByRole('link', { name: EARLIER_EMAIL })).toBeVisible()
  await expect(page.getByRole('link', { name: TEST_EMAIL })).toHaveCount(0)
  await contact.selectOption('Agreed')
  await expect(page.getByRole('link', { name: TEST_EMAIL })).toBeVisible()
  await expect(page.getByRole('link', { name: EARLIER_EMAIL })).toHaveCount(0)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^lcw-accounts-\d{4}-\d{2}-\d{2}\.csv$/)
  const lines = (await readFile(await file.path(), 'utf8')).trim().split('\r\n')
  expect(lines).toEqual([
    'email,did,registered,contact,contact_last_changed',
    `${TEST_EMAIL},${TEST_DID},2026-11-18,Agreed,2026-11-18`
  ])

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('link', { name: EARLIER_EMAIL })).toBeVisible()
  await expect(page.getByLabel('Filter Email')).toHaveValue('')
})

test('shows an account\'s contact choice', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: TEST_EMAIL }).click()
  await expect(page.getByText('Agreed on', { exact: false })).toBeVisible()
  await page.goto(`/#/account?email=${encodeURIComponent(EARLIER_EMAIL)}`)
  await expect(page.getByText('Not agreed')).toBeVisible()
})

test('deletes an account, keeping the row that was removed', async ({ page }) => {
  await signIn(page)
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

  // The account is gone, but its history - and the whole row, the
  // registration token included - remain.
  await page.goto(`/#/account?email=${encodeURIComponent(TEST_EMAIL)}`)
  await expect(page.getByText('no longer exists')).toBeVisible()
  await page.getByText('The removed row').first().click()
  await expect(page.getByText(REGISTRATION_CODE).first()).toBeVisible()
})

// Moving between accounts must not leave a destructive panel armed for the one
// that was on screen a moment ago.
test('clears the delete confirmation when switching accounts', async ({ page }) => {
  await signIn(page)
  await page.goto(`/#/account?email=${encodeURIComponent(TEST_EMAIL)}`)
  await page.getByLabel(`Type ${TEST_EMAIL} to confirm`).fill(TEST_EMAIL)
  await expect(page.getByRole('button', { name: 'Delete account' })).toBeEnabled()

  await page.goto(`/#/account?email=${encodeURIComponent(EARLIER_EMAIL)}`)
  await expect(page.getByRole('heading', { name: EARLIER_EMAIL })).toBeVisible()
  await expect(page.getByLabel(`Type ${EARLIER_EMAIL} to confirm`)).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Delete account' })).toBeDisabled()
})

// The API answers 404 for any email it has no row for. Reporting that as a
// deletion would tell an admin an account was destroyed that never existed.
test('does not claim an unknown address was deleted', async ({ page }) => {
  await signIn(page)
  await page.goto(`/#/account?email=${encodeURIComponent('never-registered@example.org')}`)

  await expect(page.getByText('No wallet account is registered')).toBeVisible()
  await expect(page.getByText('no longer exists')).toHaveCount(0)
})
