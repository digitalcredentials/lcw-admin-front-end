import { useState } from 'react'

interface Props {
  value?: string
  // A DID is long and unmemorable, but the tail is what tells two apart, so a
  // truncated one keeps its ending rather than trailing off.
  truncate?: boolean
}

export default function Did({ value, truncate = false }: Props) {
  const [copied, setCopied] = useState(false)

  if (!value) {
    return <span className="text-gray-400">none</span>
  }

  const shown =
    truncate && value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value

  async function copy() {
    try {
      await navigator.clipboard.writeText(value!)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be refused; the full value is in the title.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`${value}\n\nClick to copy`}
      className="cursor-pointer font-mono text-xs text-gray-700 underline decoration-gray-300 decoration-dotted hover:text-indigo-700"
    >
      {copied ? 'copied' : shown}
    </button>
  )
}
