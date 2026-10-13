import type { TutorResponse } from '@shared/types'
import { t } from '../i18n'

const CATEGORY_KEY: Record<string, string> = {
  grammar: 'chat.category.grammar',
  word_choice: 'chat.category.wordChoice',
  naturalness: 'chat.category.naturalness',
  other: 'chat.category.other'
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
          {t('chat.correction.title', {
            category: t(CATEGORY_KEY[correction.category] ?? 'chat.category.other')
          })}
        </span>
        {correction.uncertain && (
          <span className="text-[11px] px-1.5 rounded border border-dashed border-line text-fg-3">
            {t('chat.correction.uncertain')}
          </span>
        )}
        <span className="line-through text-bad truncate">{correction.original}</span>
      </summary>
      <div className="px-2.5 py-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[13px]">
        <span className="text-fg-3 text-[11.5px]">{t('chat.correction.original')}</span>
        <span className="line-through text-bad">{correction.original}</span>
        <span className="text-fg-3 text-[11.5px]">{t('chat.correction.improved')}</span>
        <span className="text-good font-semibold">{correction.improved}</span>
        <span className="text-fg-3 text-[11.5px]">{t('chat.correction.explanation')}</span>
        <span className="text-zh">{correction.explanationZh}</span>
      </div>
    </details>
  )
}
