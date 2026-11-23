import { createHash } from 'node:crypto'

// Direct file patching, the way a BepInEx/Harmony mod or a userscript edits a program it does not own.
//
// A patch is data: a target file (glob), what to find, what to put there. The engine is pure: it takes
// text in and gives text out, so the daemon can apply it to the served app (`scope: "web"`, in memory,
// per request) or to Node modules as they load (`scope: "server"`). Nothing on disk is rewritten, so
// disabling or removing an extension restores the original behaviour exactly.

/** `*` matches inside one path segment, `**` across segments, `?` one character. */
export function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*'
        i += 1
        if (glob[i + 1] === '/') i += 1
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

export function matchesTarget(glob, relativePath) {
  return globToRegExp(glob.replace(/^\/+/, '')).test(relativePath.replaceAll('\\', '/').replace(/^\/+/, ''))
}

function fill(text, vars) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole))
}

function replacement(patch, vars) {
  const text = patch.__text ?? patch.replace ?? patch.insertBefore ?? patch.insertAfter ?? patch.append ?? patch.prepend ?? ''
  return fill(text, vars)
}

/**
 * Applies the patches that target `relativePath`, in order.
 *
 * `patches` entries are manifest patches, optionally with `__text` (the contents of the patch's `file`)
 * and `__owner` (the extension id, for reporting). `vars` fills `{{ext}}`, `{{id}}`, `{{version}}`.
 *
 * Returns `{ source, results }`; each result is `{ index, owner, applied, matches, error? }`. A patch whose
 * pattern is missing is reported and skipped; it never throws, so one stale patch cannot break the app.
 */
export function applyPatches(source, relativePath, patches, varsFor = () => ({})) {
  let text = source
  const results = []
  patches.forEach((patch, index) => {
    if (!matchesTarget(patch.target, relativePath)) return
    const owner = patch.__owner ?? ''
    const vars = varsFor(patch)
    const result = { index, owner, target: patch.target, scope: patch.scope, applied: false, matches: 0 }
    results.push(result)
    try {
      if (patch.append !== undefined) {
        text = `${text}${replacement(patch, vars)}`
        result.applied = true
        result.matches = 1
        return
      }
      if (patch.prepend !== undefined) {
        // Keep a shebang or "use strict" style first line valid: prepend goes before everything, as asked.
        text = `${replacement(patch, vars)}${text}`
        result.applied = true
        result.matches = 1
        return
      }
      const body = replacement(patch, vars)
      const wrap = (found) =>
        patch.insertBefore !== undefined ? `${body}${found}` : patch.insertAfter !== undefined ? `${found}${body}` : body

      if (typeof patch.find === 'string') {
        let from = 0
        let out = ''
        let count = 0
        while (true) {
          const at = text.indexOf(patch.find, from)
          if (at < 0) break
          count += 1
          out += text.slice(from, at) + wrap(patch.find)
          from = at + patch.find.length
          if (!patch.all) break
        }
        if (count === 0) {
          result.error = 'pattern not found'
          return
        }
        text = out + text.slice(from)
        result.matches = count
        result.applied = true
        return
      }

      const flags = patch.find.flags.includes('g') || patch.all ? patch.find.flags.replace('g', '') + 'g' : patch.find.flags
      const regex = new RegExp(patch.find.regex, flags)
      let count = 0
      text = text.replace(regex, (...args) => {
        count += 1
        const found = args[0]
        if (patch.replace === undefined) return wrap(found)
        // `replace` understands $1, $&, $<name> like String.replace; insertBefore/insertAfter are literal.
        const last = args[args.length - 1]
        const groups = last && typeof last === 'object' ? last : {}
        const groupCount = args.findIndex((value) => typeof value === 'number') - 1
        return body.replace(/\$(\d{1,2}|&|<[^>]+>)/g, (_whole, ref) => {
          if (ref === '&') return found
          if (ref.startsWith('<')) return groups[ref.slice(1, -1)] ?? ''
          const group = Number(ref)
          return group >= 1 && group <= groupCount ? (args[group] ?? '') : ''
        })
      })
      if (count === 0) {
        result.error = 'pattern not found'
        return
      }
      result.matches = count
      result.applied = true
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }
  })
  // A patch marked optional is not an error when it finds nothing.
  for (const result of results) {
    const patch = patches[result.index]
    if (!result.applied && result.error === 'pattern not found' && patch.optional) result.error = undefined
  }
  return { source: text, results }
}

/** Stable hash of a patch set (and the text of their `file`s). '' for no patches. Daemon and preload must agree. */
export function fingerprintPatches(patches) {
  if (patches.length === 0) return ''
  const hash = createHash('sha1')
  for (const patch of patches) {
    const { __text, __index, __owner, __version, __priority, ...rest } = patch
    hash.update(JSON.stringify([__owner, __index, Object.keys(rest).sort().map((key) => [key, rest[key]]), __text ?? '']))
    hash.update('\n')
  }
  return hash.digest('hex')
}
