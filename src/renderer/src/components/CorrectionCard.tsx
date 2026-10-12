import type { TutorResponse } from '@shared/types'

const CATEGORY: Record<string, string> = {
  grammar: '语法',
  word_choice: '用词',
  naturalness: '地道程度',
  other: '其他'
}

export function CorrectionCard({
  correction
}: {
  correction: NonNullable<TutorResponse['correction']>
}): React.JSX.Element {
  return (
    <details className="border border-line rounded-lg overflow-hidden w-full selectable">
      <summary className="cursor-pointer px-2.5 py-1.5 bg-surface-2 text-[12.5px] flex items-center gap-2 list-none">
        <span className="text-[11px] px-1.5 rounded bg-warn-soft text-warn">
          纠错 · {CATEGORY[correction.category] ?? '其他'}
        </span>
        {correction.uncertain && (
          <span className="text-[11px] px-1.5 rounded border border-dashed border-line text-fg-3">
            可能是识别错误
          </span>
        )}
        <span className="line-through text-bad truncate">{correction.original}</span>
      </summary>
      <div className="px-2.5 py-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[13px]">
        <span className="text-fg-3 text-[11.5px]">原句</span>
        <span className="line-through text-bad">{correction.original}</span>
        <span className="text-fg-3 text-[11.5px]">改为</span>
        <span className="text-good font-semibold">{correction.improved}</span>
        <span className="text-fg-3 text-[11.5px]">解释</span>
        <span className="text-zh">{correction.explanationZh}</span>
      </div>
    </details>
  )
}
