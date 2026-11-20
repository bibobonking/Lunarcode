import { useEffect, useState } from 'react'
import { Check, Globe2, Paperclip, Plug, Plus, Sparkles } from 'lucide-react'
import { useSettings } from '../../store/settings'
import { useSkills } from '../../store/skills'
import { useMcp } from '../../store/mcp'
import { useUi } from '../../store/ui'
import { Popover } from './Popover'
import { cn } from '../../lib/utils'

function Row({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: typeof Plus
  label: string
  hint?: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="adw-menu-item">
      <Icon size={16} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[12px] text-muted">{hint}</span>}
      {active !== undefined && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{active && <Check size={16} className="text-link" />}</span>}
    </button>
  )
}

/** The "+" menu: files, web search, mode, skills and MCP. */
export function PlusMenu({ onAddFiles }: { onAddFiles: () => void }) {
  const settings = useSettings()
  const update = useSettings((state) => state.update)
  const enabledCount = useSkills((state) => state.skills.filter((skill) => skill.enabled).length)
  const skillsLoaded = useSkills((state) => state.loaded)
  const loadSkills = useSkills((state) => state.load)
  const servers = useMcp((state) => state.servers)
  const mcpLoaded = useMcp((state) => state.loaded)
  const loadMcp = useMcp((state) => state.load)
  const openSettings = useUi((state) => state.openSettings)
  const setMcpOpen = useUi((state) => state.setMcpOpen)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    if (!skillsLoaded) void loadSkills()
    if (!mcpLoaded) void loadMcp()
  }, [open, skillsLoaded, mcpLoaded, loadSkills, loadMcp])

  const connected = servers.filter((server) => server.status === 'connected').length
  const close = () => setOpen(false)

  return (
    <Popover
      open={open}
      onClose={close}
      width={280}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn('adw-icon-btn', open && 'bg-ink/[.1]')}
          aria-label="Add files, skills and tools"
          aria-expanded={open}
          title="Add files, skills and tools"
        >
          <Plus size={16} />
        </button>
      }
    >
      <Row
        icon={Paperclip}
        label="Add files or photos"
        onClick={() => {
          close()
          onAddFiles()
        }}
      />
      <Row
        icon={Globe2}
        label="Web search"
        active={settings.webSearchEnabled}
        onClick={() => update({ webSearchEnabled: !settings.webSearchEnabled })}
      />
      <Row
        icon={Plug}
        label="MCP servers"
        hint={servers.length ? `${connected}/${servers.length} connected` : 'Add'}
        onClick={() => {
          close()
          setMcpOpen(true)
        }}
      />

      <Row
        icon={Sparkles}
        label="Skills"
        hint={enabledCount ? `${enabledCount} on` : undefined}
        onClick={() => {
          close()
          openSettings('skills')
        }}
      />
    </Popover>
  )
}
