interface ProgressBarProps {
  completed: number
  total: number
  className?: string
}

export function ProgressBar({ completed, total, className = "" }: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className={`progress-bar ${className}`}>
      <div className="progress-bar__track">
        <div
          className="progress-bar__fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="progress-bar__text">
        {completed}/{total} ({percentage}%)
      </span>
    </div>
  )
}
