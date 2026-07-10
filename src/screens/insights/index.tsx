import { useState } from 'react'
import { type LogFilter } from '../../data/queries'
import { useDb } from '../../data/store'
import { TabButton } from './bits'
import { FilterSheet, HistoryTab, type ScrollState } from './HistoryTab'
import { toggleFilter } from './helpers'
import { PlanTab } from './PlanTab'

/**
 * Insights (formerly "History") — two sub-tabs:
 *  - History: the workout log (per-session cards + filter sheet).
 *  - Plan: engine suggestions, active targets, muscle balance.
 */
export function Insights({
  now: nowProp,
  initialView = 'history',
}: { now?: number; initialView?: 'history' | 'plan' } = {}) {
  const db = useDb()
  const [now] = useState(() => nowProp ?? Date.now())
  const [view, setView] = useState<'history' | 'plan'>(initialView)
  const [filter, setFilter] = useState<LogFilter>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [weeks, setWeeks] = useState<number>(4)
  const [scroll, setScroll] = useState<Record<string, ScrollState>>({})

  const isHistory = view === 'history'

  return (
    <div className="flex min-h-screen justify-center bg-bg font-mono">
      <div className="box-border flex min-h-screen w-full max-w-[430px] flex-col pt-5 pr-[max(18px,var(--safe-right))] pb-[calc(var(--safe-bottom)+24px)] pl-[max(18px,var(--safe-left))]">
        {/* header */}
        <div className="flex items-baseline pb-[14px]">
          <div className="tt-label text-[17px] font-bold tracking-[0.05em] text-tx">Insights</div>
        </div>

        {/* view switch */}
        <div className="grid grid-cols-2 gap-[6px] pb-4">
          <TabButton label="History" active={isHistory} onClick={() => setView('history')} />
          <TabButton label="Plan" active={!isHistory} onClick={() => setView('plan')} />
        </div>

        {isHistory ? (
          <HistoryTab
            db={db}
            filter={filter}
            onOpenFilter={() => setFilterOpen(true)}
            onClearFilter={() => setFilter(null)}
            scroll={scroll}
            setScroll={setScroll}
          />
        ) : (
          <PlanTab db={db} now={now} weeks={weeks} onWeeks={setWeeks} />
        )}
      </div>

      {filterOpen && (
        <FilterSheet
          db={db}
          filter={filter}
          onClose={() => setFilterOpen(false)}
          onPick={(f) => {
            setFilter((cur) => toggleFilter(cur, f))
            setFilterOpen(false)
          }}
        />
      )}
    </div>
  )
}
