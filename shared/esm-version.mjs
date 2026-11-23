// Multi-file renderer extensions: `main.js` may `import './src/foo.js'`, and those files import others.
//
// The window loads `main` as `/ext/<id>/main.js?v=<hash>`. The browser keeps one module instance per full
// URL, so without this step a sub-module (`./src/foo.js`) would be cached for the lifetime of the page and a
// live reload after an edit would keep running the OLD code. The daemon therefore appends `?v=<hash>` to every
// relative specifier it serves, so one edit anywhere in the extension re-evaluates the whole graph.
//
// Zero dependencies and pure, so it is unit-tested (`esm-version.test.mjs`).

// from './x.js' | from "../x.js"   (import … from / export … from)
const FROM = /(\bfrom\s*)(['"])(\.{1,2}\/[^'"\n]*)\2/g
// import './x.js'  (side-effect import)
const BARE = /(\bimport\s*)(['"])(\.{1,2}\/[^'"\n]*)\2/g
// import('./x.js')  (dynamic import with a literal)
const DYNAMIC = /(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]*)\2/g

const withVersion = (specifier, version) => {
  if (/[?#]/.test(specifier)) return specifier
  return `${specifier}?v=${version}`
}

/** Appends `?v=<version>` to relative import specifiers; bare and absolute specifiers are left alone. */
export function versionRelativeImports(source, version) {
  if (!version) return source
  const rewrite = (_match, head, quote, specifier) => `${head}${quote}${withVersion(specifier, encodeURIComponent(version))}${quote}`
  return source.replace(FROM, rewrite).replace(BARE, rewrite).replace(DYNAMIC, rewrite)
}
