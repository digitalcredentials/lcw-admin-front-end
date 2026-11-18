import type { Account } from './api'

// The Accounts table: every account the API lists, filtered by column and
// searched across all columns in the browser, and exported as a CSV of
// exactly the rows the filters leave. Dates are ISO days (2026-11-18), so a
// filter can match a year or a month by typing its prefix.

export type ColumnKey = 'email' | 'did' | 'registered' | 'contact' | 'contactChanged'

export const CONTACT_AGREED = 'Agreed'
export const CONTACT_NOT_AGREED = 'Not agreed'

export interface Column {
  key: ColumnKey
  label: string
  // The header the CSV gives the column
  csvHeader: string
  value: (account: Account) => string
  // A column with fixed values is filtered by choosing one; the others by
  // typing part of the value
  choices?: string[]
}

const isoDay = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '')

export const COLUMNS: Column[] = [
  { key: 'email', label: 'Email', csvHeader: 'email', value: (account) => account.email },
  { key: 'did', label: 'DID', csvHeader: 'did', value: (account) => account.did ?? '' },
  { key: 'registered', label: 'Registered', csvHeader: 'registered', value: (account) => isoDay(account.createdAt) },
  {
    key: 'contact',
    label: 'Contact',
    csvHeader: 'contact',
    value: (account) => (account.contactOptIn ? CONTACT_AGREED : CONTACT_NOT_AGREED),
    choices: [CONTACT_AGREED, CONTACT_NOT_AGREED]
  },
  {
    key: 'contactChanged',
    label: 'Contact last changed',
    csvHeader: 'contact_last_changed',
    value: (account) => isoDay(account.contactOptInUpdatedAt)
  }
]

// A filter per column (empty matches everything) and one search across all
export interface TableQuery {
  search: string
  filters: Partial<Record<ColumnKey, string>>
}

export const EMPTY_QUERY: TableQuery = { search: '', filters: {} }

export function isFiltered(query: TableQuery): boolean {
  return query.search.trim() !== '' || Object.values(query.filters).some((value) => (value ?? '').trim() !== '')
}

const contains = (value: string, wanted: string) => value.toLowerCase().includes(wanted.toLowerCase())

export function filterAccounts(accounts: Account[], query: TableQuery): Account[] {
  const search = query.search.trim()
  return accounts.filter((account) => {
    for (const column of COLUMNS) {
      const wanted = (query.filters[column.key] ?? '').trim()
      if (!wanted) {
        continue
      }
      const value = column.value(account)
      if (column.choices ? value !== wanted : !contains(value, wanted)) {
        return false
      }
    }
    return !search || COLUMNS.some((column) => contains(column.value(account), search))
  })
}

// A spreadsheet runs a cell that starts with one of these as a formula, and an
// email address may legally start with some of them; a leading apostrophe
// makes the cell plain text.
const FORMULA_START = /^[=+\-@\t\r]/

function csvCell(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function accountsCsv(accounts: Account[]): string {
  const lines = [
    COLUMNS.map((column) => column.csvHeader).join(','),
    ...accounts.map((account) => COLUMNS.map((column) => csvCell(column.value(account))).join(','))
  ]
  return `${lines.join('\r\n')}\r\n`
}
