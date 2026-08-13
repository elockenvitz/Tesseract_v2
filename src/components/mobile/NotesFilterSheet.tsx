import { clsx } from 'clsx'
import { Check } from 'lucide-react'
import { BottomSheet } from './BottomSheet'

export interface NotesFilterSheetProps {
  open: boolean
  onClose: () => void

  sourceOptions: { value: string; label: string; icon: React.ComponentType<{ className?: string }> }[]
  selectedSourceTypes: string[]
  onToggleSourceType: (value: string) => void

  noteTypesGrouped: { group: string; types: { id: string; label: string; dotColor: string }[] }[]
  selectedNoteTypes: string[]
  onToggleNoteType: (id: string) => void

  sharedFilter: 'all' | 'shared' | 'private'
  onSharedFilterChange: (value: 'all' | 'shared' | 'private') => void

  /** How many notes the current selection matches — shown on the commit button. */
  matchCount: number
  activeCount: number
  onClearAll: () => void
}

const SHARING: { value: 'all' | 'shared' | 'private'; label: string; hint: string }[] = [
  { value: 'all', label: 'All notes', hint: 'Shared and private' },
  { value: 'shared', label: 'Shared', hint: 'Visible to your team' },
  { value: 'private', label: 'Private', hint: 'Only you' },
]

/**
 * Every notes filter in one sheet.
 *
 * On desktop these are three separate dropdown buttons sitting beside the
 * search field. That row does not survive a phone: search plus three ~90px
 * buttons overflows 390px, and each button's menu is an `absolute` panel
 * anchored to a trigger that has been squeezed to the screen edge.
 *
 * Collapsing them into one trigger is what lets search stay inline and
 * full-width — the thing actually used most — while the filters keep their
 * full expressiveness instead of being cut down to fit. Source and type are
 * multi-select, which is why this is a sheet rather than an OptionPicker.
 *
 * Rows are full-width buttons at tap height. The desktop menus use ~28px rows
 * with a hover state, neither of which means anything on touch.
 */
export function NotesFilterSheet({
  open,
  onClose,
  sourceOptions,
  selectedSourceTypes,
  onToggleSourceType,
  noteTypesGrouped,
  selectedNoteTypes,
  onToggleNoteType,
  sharedFilter,
  onSharedFilterChange,
  matchCount,
  activeCount,
  onClearAll,
}: NotesFilterSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filter notes"
      snapPoints={[0.9]}
      headerAccessory={
        activeCount > 0 ? (
          <button
            type="button"
            onClick={onClearAll}
            className="text-sm font-semibold text-primary-600 dark:text-primary-400 no-touch-target"
          >
            Clear all
          </button>
        ) : null
      }
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full h-12 rounded-xl bg-primary-600 text-white font-semibold"
        >
          {/* The count is the point of the button: it says what applying does
              before the sheet closes over the list. */}
          Show {matchCount} {matchCount === 1 ? 'note' : 'notes'}
        </button>
      }
    >
      <div className="pb-2">
        <Section title="Source">
          {sourceOptions.map(option => {
            const Icon = option.icon
            const on = selectedSourceTypes.includes(option.value)
            return (
              <Row key={option.value} selected={on} onClick={() => onToggleSourceType(option.value)}>
                <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400 shrink-0" />
                <span className="flex-1 min-w-0 truncate">{option.label}</span>
              </Row>
            )
          })}
        </Section>

        <Section title="Sharing">
          {SHARING.map(option => (
            <Row
              key={option.value}
              selected={sharedFilter === option.value}
              onClick={() => onSharedFilterChange(option.value)}
            >
              <span className="flex-1 min-w-0">
                <span className="block truncate">{option.label}</span>
                <span className="block text-xs text-gray-400 truncate">{option.hint}</span>
              </span>
            </Row>
          ))}
        </Section>

        {noteTypesGrouped.map(({ group, types }) => (
          <Section key={group} title={group}>
            {types.map(nt => (
              <Row
                key={nt.id}
                selected={selectedNoteTypes.includes(nt.id)}
                onClick={() => onToggleNoteType(nt.id)}
              >
                <span className={clsx('h-2.5 w-2.5 rounded-full shrink-0', nt.dotColor)} />
                <span className="flex-1 min-w-0 truncate">{nt.label}</span>
              </Row>
            ))}
          </Section>
        ))}
      </div>
    </BottomSheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-3">
      <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">{children}</div>
    </div>
  )
}

function Row({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'w-full px-4 py-3 flex items-center gap-3 text-left text-sm',
        selected
          ? 'text-primary-700 dark:text-primary-300 font-semibold'
          : 'text-gray-700 dark:text-gray-200',
      )}
    >
      {children}
      {selected && <Check className="h-4 w-4 text-primary-600 shrink-0" />}
    </button>
  )
}
