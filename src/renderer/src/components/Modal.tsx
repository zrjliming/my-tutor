import { useEffect, type DragEvent, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  onDrop?: (e: DragEvent) => void
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  onDrop
}: Props): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-20 bg-black/35 flex items-center justify-center p-4"
      onClick={onClose}
      onDragOver={onDrop && ((e) => e.preventDefault())}
      onDrop={onDrop}
    >
      <div
        className="bg-surface border border-line rounded-xl w-[560px] max-w-full max-h-[90vh] overflow-auto p-5 flex flex-col gap-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {children}
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
