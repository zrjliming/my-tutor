export function AnalysisPage({
  onStartTargeted
}: {
  onStartTargeted: () => void
}): React.JSX.Element {
  return (
    <div className="p-6 text-fg-2">
      学习分析 <button onClick={onStartTargeted}>开始针对性练习</button>
    </div>
  )
}
