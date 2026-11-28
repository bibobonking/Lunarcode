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

/** First words that make the desktop binary behave as the CLI (`CreateCode ext pack …`) instead of opening a window. */
export const CLI_COMMANDS = new Set(['ext', 'extension', 'extensions', 'version', 'help'])

/** The CLI arguments of this launch, or null for a normal window launch. `defaultApp` is true for `electron .`. */
export function cliArguments(argv, defaultApp = false) {
  const args = argv.slice(defaultApp ? 2 : 1)
  return args.length > 0 && CLI_COMMANDS.has(args[0]) ? args : null
}
