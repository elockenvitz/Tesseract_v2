import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RiskFlagBadge, RiskCountBadge, RiskDots } from '../RiskBadge'
import type { RiskFlag } from '../../../lib/org-graph'

describe('RiskFlagBadge', () => {
  it('renders high severity with red styling', () => {
    const flag: RiskFlag = { type: 'empty_team', severity: 'high', label: 'No members assigned' }
    const { container } = render(<RiskFlagBadge flag={flag} />)
    expect(screen.getByText('No members assigned')).toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute('title', 'No members assigned')
    expect((container.firstChild as HTMLElement).className).toContain('red')
  })

  it('renders medium severity with amber styling', () => {
    const flag: RiskFlag = { type: 'uncovered_assets', severity: 'medium', label: 'No coverage assigned' }
    const { container } = render(<RiskFlagBadge flag={flag} />)
    expect((container.firstChild as HTMLElement).className).toContain('amber')
  })

  it('renders low severity with gray styling', () => {
    const flag: RiskFlag = { type: 'missing_coverage_admin', severity: 'low', label: 'No coverage admin assigned' }
    const { container } = render(<RiskFlagBadge flag={flag} />)
    expect((container.firstChild as HTMLElement).className).toContain('gray')
  })

  it('hides label when showLabel is false', () => {
    const flag: RiskFlag = { type: 'empty_team', severity: 'high', label: 'No members assigned' }
    render(<RiskFlagBadge flag={flag} showLabel={false} />)
    expect(screen.queryByText('No members assigned')).not.toBeInTheDocument()
  })
})

describe('RiskCountBadge', () => {
  it('renders count and severity label', () => {
    render(<RiskCountBadge severity="high" count={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('returns null when count is 0 and showZero is false', () => {
    const { container } = render(<RiskCountBadge severity="high" count={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows zero count when showZero is true', () => {
    const { container } = render(<RiskCountBadge severity="high" count={0} showZero />)
    expect(container.firstChild).not.toBeNull()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('applies muted styling when count is 0 with showZero', () => {
    const { container } = render(<RiskCountBadge severity="high" count={0} showZero />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('gray')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<RiskCountBadge severity="medium" count={5} onClick={onClick} />)
    fireEvent.click(screen.getByText('Medium'))
    expect(onClick).toHaveBeenCalled()
  })

  it('renders as button when onClick is provided', () => {
    const { container } = render(
      <RiskCountBadge severity="high" count={2} onClick={() => {}} />
    )
    expect(container.querySelector('button')).toBeInTheDocument()
  })

  it('renders as span when no onClick', () => {
    const { container } = render(
      <RiskCountBadge severity="high" count={2} />
    )
    expect(container.querySelector('button')).not.toBeInTheDocument()
    expect(container.querySelector('span')).toBeInTheDocument()
  })

  it('applies active styling when active prop is true', () => {
    const { container } = render(
      <RiskCountBadge severity="high" count={2} active onClick={() => {}} />
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('ring')
  })
})

describe('RiskDots', () => {
  it('returns null for empty flags', () => {
    const { container } = render(<RiskDots flags={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders dots for each severity present', () => {
    const flags: RiskFlag[] = [
      { type: 'empty_team', severity: 'high', label: 'H' },
      { type: 'no_portfolios', severity: 'medium', label: 'M' },
      { type: 'missing_coverage_admin', severity: 'low', label: 'L' },
    ]
    const { container } = render(<RiskDots flags={flags} />)
    const dots = container.querySelectorAll('span > span')
    expect(dots.length).toBe(3)
  })

  it('shows tooltip with all flag labels', () => {
    const flags: RiskFlag[] = [
      { type: 'empty_team', severity: 'high', label: 'No members' },
    ]
    const { container } = render(<RiskDots flags={flags} />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.title).toContain('HIGH: No members')
  })
})
