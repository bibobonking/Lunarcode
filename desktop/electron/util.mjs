const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** The port the daemon prints after binding, or null for any other output line. */
export function parseListeningPort(line) {
  const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(line)
  return match ? Number(match[1]) : null
}

/** True for the loading page, blob URLs made by the app and URLs served by the local daemon. `data:` is not trusted: a link to one must not replace the app. */
export function isLocalUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (['file:', 'about:', 'blob:'].includes(url.protocol)) return true
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return LOCAL_HOSTS.has(url.hostname)
}
