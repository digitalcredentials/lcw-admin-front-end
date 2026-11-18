// Saves text as a file. The anchor is attached to the document before it is
// clicked, and the object URL outlives the click: a detached anchor or a
// synchronously revoked URL works in Chromium and silently does nothing in
// some other browsers - and a deletion's download is the only copy of a row
// that has just been removed.
export function download(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  setTimeout(() => {
    anchor.remove()
    URL.revokeObjectURL(url)
  }, 30_000)
}
