import type { TutorResponse } from '@shared/types'

export function VocabChips({
  vocabulary
}: {
  vocabulary: NonNullable<TutorResponse['vocabulary']>
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {vocabulary.map((v) => (
        <details key={v.word} className="relative">
          <summary className="cursor-pointer list-none text-xs px-2 py-0.5 rounded-full bg-accent-soft text-accent">
            {v.word}
          </summary>
          <div className="mt-1.5 px-2.5 py-2 border border-line rounded-lg bg-surface text-[12.5px] max-w-[320px] selectable">
            <div>
              <b>{v.word}</b> <span className="text-zh">{v.meaningZh}</span>
            </div>
            <div className="italic text-fg-2">{v.example}</div>
          </div>
        </details>
      ))}
    </div>
  )
}
