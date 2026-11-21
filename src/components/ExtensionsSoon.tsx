import { Package, Sparkles } from 'lucide-react'
import { useUi } from '../store/ui'
import { Modal, ModalHeader } from './ui'

/** Placeholder for the Extensions area while the extension system is being rebuilt. */
export function ExtensionsSoon() {
  const open = useUi((state) => state.extensionsOpen)
  const setOpen = useUi((state) => state.setExtensionsOpen)
  return (
    <Modal open={open} onClose={() => setOpen(false)} labelledBy="extensions-soon-title" className="sm:!w-[min(520px,94vw)]">
      <ModalHeader id="extensions-soon-title" title="Extensions" description="Update coming soon" onClose={() => setOpen(false)} />
      <div className="flex flex-col items-center gap-3 px-8 pb-9 pt-4 text-center">
        <span className="tool-icon h-14 w-14 rounded-[16px]" aria-hidden="true">
          <Package size={26} />
        </span>
        <h3 className="text-[17px] font-semibold text-ink">
          Extension update <span className="lunar-text">coming soon</span>
        </h3>
        <p className="max-w-[360px] text-[13px] leading-relaxed text-muted">
          Extensions are getting a rebuild: themes, tools and skills you can install in one click. Your existing setup keeps working in the meantime.
        </p>
        <span className="tool-chip" data-tone="running">
          <Sparkles size={11} /> Soon
        </span>
      </div>
    </Modal>
  )
}
