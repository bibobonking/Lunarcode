import {
  Archive,
  Braces,
  Database,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Lock,
  Music,
  Settings,
  SquareTerminal,
  Table2,
  Type,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../lib/utils'

/** Monochrome 16px Lucide file and folder icons: one neutral tone, shape alone tells the type apart. */

export interface FileKind {
  icon: LucideIcon
}

const CODE = ['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'php', 'lua', 'dart', 'vue', 'svelte', 'astro', 'sql', 'graphql', 'gql', 'xml', 'wasm', 'ipynb']
const EXT: Record<string, LucideIcon> = {
  json: Braces,
  jsonc: Braces,
  json5: Braces,
  yml: Settings,
  yaml: Settings,
  toml: Settings,
  ini: Settings,
  conf: Settings,
  env: Settings,
  sh: SquareTerminal,
  bash: SquareTerminal,
  zsh: SquareTerminal,
  ps1: SquareTerminal,
  bat: SquareTerminal,
  md: FileText,
  mdx: FileText,
  txt: FileText,
  log: FileText,
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  ppt: FileText,
  pptx: FileText,
  xls: Table2,
  xlsx: Table2,
  csv: Table2,
  lock: Lock,
  db: Database,
  sqlite: Database,
  ttf: Type,
  otf: Type,
  woff: Type,
  woff2: Type,
}
for (const ext of CODE) EXT[ext] = FileCode
for (const ext of ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp']) EXT[ext] = Image
for (const ext of ['mp4', 'mov', 'webm', 'mkv']) EXT[ext] = Video
for (const ext of ['mp3', 'wav', 'ogg', 'flac']) EXT[ext] = Music
for (const ext of ['zip', 'tar', 'gz', 'tgz', 'rar', '7z']) EXT[ext] = Archive

const NAMES: Record<string, LucideIcon> = {
  'package.json': Braces,
  'package-lock.json': Lock,
  'tsconfig.json': Settings,
  'jsconfig.json': Settings,
  dockerfile: SquareTerminal,
  makefile: SquareTerminal,
  '.gitignore': Settings,
  '.env': Settings,
  license: FileText,
  readme: FileText,
}

export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase()
  const byName = NAMES[lower]
  if (byName) return { icon: byName }
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot + 1) : ''
  return { icon: EXT[ext] ?? (lower.startsWith('.') ? Settings : File) }
}

export function FileIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon = fileKind(name).icon
  return <Icon size={size} className={cn('shrink-0 text-muted', className)} aria-hidden="true" />
}

export function FolderIcon({ open = false, size = 16, className }: { name?: string; open?: boolean; size?: number; className?: string }) {
  const Icon = open ? FolderOpen : Folder
  return <Icon size={size} className={cn('shrink-0 text-accent', className)} aria-hidden="true" />
}
