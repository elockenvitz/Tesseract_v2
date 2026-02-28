import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthPill, getHealthColorClass } from '../HealthPill'

describe('HealthPill', () => {
  it('renders the score as percentage', () => {
    render(<HealthPill score={82} />)
    expect(screen.getByText('82%')).toBeInTheDocument()
  })

  it('applies green styling for score >= 80', () => {
    const { container } = render(<HealthPill score={85} />)
    const pill = container.firstChild as HTMLElement
    expect(pill.className).toContain('emerald')
  })

  it('applies amber styling for score 50-79', () => {
    const { container } = render(<HealthPill score={65} />)
    const pill = container.firstChild as HTMLElement
    expect(pill.className).toContain('amber')
  })

  it('applies red styling for score < 50', () => {
    const { container } = render(<HealthPill score={30} />)
    const pill = container.firstChild as HTMLElement
    expect(pill.className).toContain('red')
  })

  it('shows label when showLabel is true', () => {
    render(<HealthPill score={72} showLabel />)
    expect(screen.getByText('health')).toBeInTheDocument()
  })

  it('has a title tooltip', () => {
    render(<HealthPill score={72} />)
    expect(screen.getByTitle('Health: 72%')).toBeInTheDocument()
  })

  it('shows detailed tooltip when showTooltip is true', () => {
    render(<HealthPill score={72} showTooltip />)
    const el = screen.getByTitle(/Scoring weights/)
    expect(el).toBeInTheDocument()
    expect(el.title).toContain('Members assigned: 25pts')
    expect(el.title).toContain('No high-severity risks: 20pts')
  })

  it('renders lg size with larger text', () => {
    const { container } = render(<HealthPill score={80} size="lg" />)
    const pill = container.firstChild as HTMLElement
    expect(pill.className).toContain('text-sm')
  })
})

describe('getHealthColorClass', () => {
  it('returns emerald for >= 80', () => {
    expect(getHealthColorClass(80)).toContain('emerald')
    expect(getHealthColorClass(100)).toContain('emerald')
  })

  it('returns amber for 50-79', () => {
    expect(getHealthColorClass(50)).toContain('amber')
    expect(getHealthColorClass(79)).toContain('amber')
  })

  it('returns red for < 50', () => {
    expect(getHealthColorClass(0)).toContain('red')
    expect(getHealthColorClass(49)).toContain('red')
  })
})
