import { useState } from 'react'
import { Check, ChevronDown, FolderOpen, GitBranch } from 'lucide-react'
import { useUi } from '../../store/ui'
import { useWorkspace } from '../../store/workspace'
import { Popover, MenuLabel, TextButton } from './Popover'
import { cn } from '../../lib/utils'
import { Spinner } from '../ui'

/** The project folder, shown above the composer. Click to switch folders. */
export function WorkspacePicker() {
  const info = useWorkspace((state) => state.info)
  const git = useWorkspace((state) => state.git)
  const addWorkspace = useWorkspace((state) => state.addWorkspace)
  const setWorkspaceOpen = useUi((state) => state.setWorkspaceOpen)
  const notify = useUi((state) => state.notify)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState('')

  const choose = async (path: string) => {
    if (path === info.root) {
      setOpen(false)
      return
    }
    setSwitching(path)
    try {
      await addWorkspace(path)
      setOpen(false)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open that folder.', 'error')
    } finally {
      setSwitching('')
    }
  }

  const recent = [...info.workspaces].sort((a, b) => b.lastOpened - a.lastOpened)

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="below"
      width={280}
      maxHeight={260}
      trigger={
        <TextButton
          open={open}
          onClick={() => setOpen((value) => !value)}
          title={info.available ? info.root : 'Choose a project folder'}
          className="max-w-[240px]"
        >
          <FolderOpen size={16} className="shrink-0" />
          <span className="truncate">{info.available ? info.name : 'Select folder'}</span>
          {info.available && git.available && git.branch && (
            <span className="flex shrink-0 items-center gap-1 text-muted">
              <GitBranch size={14} />
              {git.branch}
            </span>
          )}
          <ChevronDown size={14} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
        </TextButton>
      }
    >
      <MenuLabel>Folders</MenuLabel>
      <div>
        {recent.length === 0 && <p className="px-3 pb-2 text-[12px] text-muted">No folders yet.</p>}
        {recent.map((workspace) => (
          <button
            key={workspace.path}
            type="button"
            onClick={() => void choose(workspace.path)}
            disabled={Boolean(switching)}
            className="adw-menu-item h-auto min-h-[40px] py-1.5 disabled:opacity-60"
            title={workspace.path}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {workspace.path === info.root ? <Check size={16} className="text-link" /> : <FolderOpen size={16} className="text-muted" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] leading-snug text-ink">{workspace.name}</span>
              <span className="block truncate text-[12px] leading-snug text-muted">{workspace.path}</span>
            </span>
            {switching === workspace.path && (
              <Spinner size={14} className="shrink-0 text-muted" />
            )}
          </button>
        ))}
      </div>
      <div className="adw-menu-sep" />
      <div>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setWorkspaceOpen(true)
          }}
          className="adw-menu-item"
        >
          <FolderOpen size={16} className="text-muted" />
          Open another folder…
        </button>
      </div>
    </Popover>
  )
}
