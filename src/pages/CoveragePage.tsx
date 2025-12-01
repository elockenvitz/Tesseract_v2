import { CoverageManager } from '../components/coverage/CoverageManager'

interface CoveragePageProps {
  initialView?: 'active' | 'history' | 'requests'
}

export function CoveragePage({ initialView = 'active' }: CoveragePageProps) {
  return (
    <div className="h-full">
      <CoverageManager mode="page" initialView={initialView} />
    </div>
  )
}
