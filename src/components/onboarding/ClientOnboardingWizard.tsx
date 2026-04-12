/**
 * ClientOnboardingWizard — Guided org setup for new client admins.
 *
 * Shown instead of the main app when org_onboarding_status.is_completed = false.
 * 6 steps: Welcome → Org Structure → Portfolios → Upload Holdings → Invite Team → Review & Launch
 *
 * Progress is saved after each step. Steps can be skipped (tracked for ops).
 * Pre-created resources (from founder provisioning) are shown as already done.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Users, Briefcase, CheckCircle2, ArrowRight,
  ArrowLeft, Plus, Trash2, Loader2, Hexagon,
  ChevronRight, SkipForward, Rocket, Upload, FileSpreadsheet, Table2,
  AlertCircle, Check, LayoutTemplate,
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useClientOnboarding, ONBOARDING_STEPS, type OnboardingStepKey } from '../../hooks/useClientOnboarding'
import { useToast } from '../common/Toast'
import { parseHoldingsCSV, autoDetectMappings, STANDARD_FIELDS, type ParsedPosition } from '../../hooks/useHoldingsUpload'
import { TEMPLATE_PORTFOLIOS, type TemplatePortfolio } from '../../lib/pilot/template-portfolios'

// ─── Types ────────────────────────────────────────────────────

interface PortfolioEntry { name: string; benchmark: string; teamName: string }
interface RecommendationEntry { name: string; email: string; role: string }

// ─── Component ────────────────────────────────────────────────

export function ClientOnboardingWizard() {
  const { user } = useAuth()
  const { currentOrgId, currentOrg } = useOrganization()
  const { status, finishOnboarding } = useClientOnboarding(currentOrgId)
  const { success, error: showError } = useToast()
  const queryClient = useQueryClient()

  // ─── Navigation: fully local, DB syncs in background ───────
  const [currentStep, setCurrentStep] = useState(() => status?.current_step ?? 1)
  const [stepsCompleted, setStepsCompleted] = useState<string[]>(() => (status?.steps_completed as string[]) || [])
  const [stepsSkipped, setStepsSkipped] = useState<string[]>(() => (status?.steps_skipped as string[]) || [])

  // Sync from DB on first load
  useEffect(() => {
    if (status) {
      setCurrentStep(prev => prev === 1 && status.current_step ? status.current_step : prev)
    }
  }, [status?.current_step])

  // Local form state
  const [portfolios, setPortfolios] = useState<PortfolioEntry[]>([{ name: '', benchmark: '', teamName: '' }])
  const [recommendations, setRecommendations] = useState<RecommendationEntry[]>([{ name: '', email: '', role: '' }])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Holdings upload state
  const [holdingsMode, setHoldingsMode] = useState<'choose' | 'csv' | 'template'>('choose')
  const [csvText, setCsvText] = useState('')
  const [csvFileName, setCsvFileName] = useState('')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({})
  const [parsedPositions, setParsedPositions] = useState<ParsedPosition[]>([])
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<TemplatePortfolio | null>(null)
  const [selectedPortfolioForHoldings, setSelectedPortfolioForHoldings] = useState<string>('')
  const [holdingsUploaded, setHoldingsUploaded] = useState<Record<string, number>>({}) // portfolioId -> position count
  const fileInputRef = useRef<HTMLInputElement>(null)

  const orgName = currentOrg?.name || 'Your Organization'
  const totalSteps = ONBOARDING_STEPS.length

  // Pre-existing data queries
  const { data: existingPortfolios = [] } = useQuery({
    queryKey: ['onboarding-existing-portfolios', currentOrgId],
    queryFn: async () => {
      const { data } = await supabase.from('portfolios').select('id, name')
        .eq('organization_id', currentOrgId!).eq('is_active', true)
      return data || []
    },
    enabled: !!currentOrgId,
  })

  const { data: existingMembers = [] } = useQuery({
    queryKey: ['onboarding-existing-members', currentOrgId],
    queryFn: async () => {
      const { data } = await supabase.from('organization_memberships').select('user_id')
        .eq('organization_id', currentOrgId!).eq('status', 'active')
      return data || []
    },
    enabled: !!currentOrgId,
  })

  // ─── Step handlers (instant local, async DB sync) ──────────

  // Persist current state to DB (fire-and-forget)
  const syncToDb = useCallback((step: number, completed: string[], skipped: string[]) => {
    if (!currentOrgId) return
    supabase
      .from('org_onboarding_status')
      .update({
        current_step: step,
        steps_completed: completed,
        steps_skipped: skipped,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', currentOrgId)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['org-onboarding-status', currentOrgId] })
      })
  }, [currentOrgId, queryClient])

  const handleCompleteStep = (stepKey: OnboardingStepKey) => {
    const newCompleted = [...new Set([...stepsCompleted, stepKey])]
    const nextStep = Math.min(currentStep + 1, totalSteps)
    setStepsCompleted(newCompleted)
    setCurrentStep(nextStep)
    syncToDb(nextStep, newCompleted, stepsSkipped)
  }

  const handleSkipStep = (stepKey: OnboardingStepKey) => {
    const newSkipped = [...new Set([...stepsSkipped, stepKey])]
    const nextStep = Math.min(currentStep + 1, totalSteps)
    setStepsSkipped(newSkipped)
    setCurrentStep(nextStep)
    syncToDb(nextStep, stepsCompleted, newSkipped)
  }

  const handleGoBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleCreatePortfolios = async () => {
    setIsSubmitting(true)
    try {
      const validPortfolios = portfolios.filter(p => p.name.trim())
      if (validPortfolios.length > 0) {
        for (const p of validPortfolios) {
          const { data: newP } = await supabase.from('portfolios').insert({
            organization_id: currentOrgId,
            name: p.name.trim(),
            benchmark: p.benchmark.trim() || null,
            is_active: true,
          }).select('id').single()
          if (newP && user?.id) {
            await supabase.from('portfolio_memberships').insert({ portfolio_id: newP.id, user_id: user.id }).then(() => {})
            await supabase.from('portfolio_team').insert({ portfolio_id: newP.id, user_id: user.id, role: 'pm' }).then(() => {})
          }
        }
        queryClient.invalidateQueries({ queryKey: ['onboarding-existing-portfolios'] })
        success(`Created ${validPortfolios.length} portfolio${validPortfolios.length !== 1 ? 's' : ''}`)
      }
      handleCompleteStep('portfolios')
    } catch (err: any) {
      showError(err.message || 'Failed to create portfolios')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitRecommendations = async () => {
    setIsSubmitting(true)
    try {
      const validRecs = recommendations.filter(r => r.name.trim() || r.email.trim())
      if (validRecs.length > 0) {
        // Store recommendations in onboarding status metadata for ops team to review
        await supabase
          .from('org_onboarding_status')
          .update({
            recommended_users: validRecs.map(r => ({
              name: r.name.trim(),
              email: r.email.trim().toLowerCase(),
              role: r.role.trim(),
              recommended_at: new Date().toISOString(),
            })),
            updated_at: new Date().toISOString(),
          })
          .eq('organization_id', currentOrgId!)
      }
      handleCompleteStep('recommend_users')
      if (validRecs.length > 0) {
        success(`Thanks! We'll follow up with ${validRecs.length} recommendation${validRecs.length !== 1 ? 's' : ''}`)
      }
    } catch (err: any) {
      showError(err.message || 'Failed to save recommendations')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleLaunch = async () => {
    setIsSubmitting(true)
    try {
      await finishOnboarding.mutateAsync()
      success('Welcome to Tesseract!')
    } catch (err: any) {
      showError(err.message || 'Failed to complete setup')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Holdings upload handlers ──────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFileName(file.name)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      setCsvText(text)

      // Parse headers for auto-detect
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length > 0) {
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
        setCsvHeaders(headers)
        const detected = autoDetectMappings(headers)
        setColumnMappings(detected)

        // Auto-parse with detected mappings
        const result = parseHoldingsCSV(text, detected)
        setParsedPositions(result.positions)
        setParseWarnings(result.warnings)
        setParseErrors(result.errors)
      }
    }
    reader.readAsText(file)
  }, [])

  const handleUploadHoldings = async () => {
    if (!selectedPortfolioForHoldings || !user?.id || !currentOrgId) return
    setIsSubmitting(true)

    try {
      let positions: { symbol: string; shares: number; price: number | null; market_value: number | null; cost_basis: number | null; weight_pct: number | null; sector: string | null }[]

      if (holdingsMode === 'template' && selectedTemplate) {
        positions = selectedTemplate.positions.map(p => ({
          symbol: p.symbol,
          shares: p.shares,
          price: p.price,
          market_value: p.shares * p.price,
          cost_basis: null,
          weight_pct: p.weight_pct,
          sector: p.sector,
        }))
      } else if (holdingsMode === 'csv' && parsedPositions.length > 0) {
        positions = parsedPositions
      } else {
        showError('No holdings data to upload')
        return
      }

      // Resolve symbols against assets table
      const symbols = positions.map(p => p.symbol)
      const { data: assets } = await supabase
        .from('assets')
        .select('id, symbol')
        .in('symbol', symbols)
      const assetMap = new Map((assets || []).map(a => [a.symbol, a.id]))

      const snapshotDate = new Date().toISOString().split('T')[0]
      const totalMarketValue = positions.reduce((s, p) => s + (p.market_value || (p.shares * (p.price || 0))), 0)

      // 1. Create snapshot
      const { data: snapshot, error: snapErr } = await supabase
        .from('portfolio_holdings_snapshots')
        .insert({
          portfolio_id: selectedPortfolioForHoldings,
          organization_id: currentOrgId,
          snapshot_date: snapshotDate,
          source: 'manual_upload',
          total_market_value: totalMarketValue || null,
          total_positions: positions.length,
          uploaded_by: user.id,
          notes: holdingsMode === 'template' ? `Seeded from template: ${selectedTemplate?.name}` : `CSV upload: ${csvFileName}`,
        })
        .select('id')
        .single()

      if (snapErr) throw snapErr

      // 2. Insert positions into snapshot
      const positionRows = positions.map(p => ({
        snapshot_id: snapshot.id,
        portfolio_id: selectedPortfolioForHoldings,
        organization_id: currentOrgId,
        asset_id: assetMap.get(p.symbol) || null,
        symbol: p.symbol,
        shares: p.shares,
        price: p.price,
        market_value: p.market_value || (p.shares * (p.price || 0)),
        cost_basis: p.cost_basis,
        weight_pct: p.weight_pct,
        sector: p.sector,
      }))

      const { error: posErr } = await supabase
        .from('portfolio_holdings_positions')
        .insert(positionRows)

      if (posErr) throw posErr

      // 3. Upsert into portfolio_holdings (the "current" table used by simulations)
      const holdingsRows = positions
        .filter(p => assetMap.has(p.symbol))
        .map(p => ({
          portfolio_id: selectedPortfolioForHoldings,
          asset_id: assetMap.get(p.symbol)!,
          shares: p.shares,
          price: p.price || 0,
          cost: p.price || 0,
          date: snapshotDate,
        }))
      if (holdingsRows.length > 0) {
        await supabase.from('portfolio_holdings').upsert(
          holdingsRows,
          { onConflict: 'portfolio_id,asset_id,date' }
        )
      }

      // 4. Log upload
      await supabase.from('holdings_upload_log').insert({
        organization_id: currentOrgId,
        portfolio_id: selectedPortfolioForHoldings,
        snapshot_id: snapshot.id,
        filename: holdingsMode === 'template' ? `template:${selectedTemplate?.id}` : csvFileName,
        snapshot_date: snapshotDate,
        positions_count: positions.length,
        warnings: [],
        status: 'success',
        uploaded_by: user.id,
      })

      setHoldingsUploaded(prev => ({
        ...prev,
        [selectedPortfolioForHoldings]: positions.length,
      }))

      const portfolioName = existingPortfolios.find(p => p.id === selectedPortfolioForHoldings)?.name || 'Portfolio'
      success(`Loaded ${positions.length} positions into ${portfolioName}`)

      // Reset for next portfolio
      setHoldingsMode('choose')
      setCsvText('')
      setCsvFileName('')
      setParsedPositions([])
      setSelectedTemplate(null)
    } catch (err: any) {
      showError(err.message || 'Failed to upload holdings')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-indigo-50 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 bg-white/80 backdrop-blur border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <Hexagon className="w-6 h-6 text-indigo-600" />
          <span className="text-lg font-bold text-gray-900 tracking-tight">Tesseract</span>
        </div>
        <button
          onClick={handleLaunch}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Finish later
        </button>
      </header>

      {/* Progress bar */}
      <div className="px-8 pt-6">
        <div className="max-w-2xl mx-auto flex items-start">
          {ONBOARDING_STEPS.map((step, i) => {
            const isActive = step.number === currentStep
            const isDone = stepsCompleted.includes(step.key) || stepsSkipped.includes(step.key)
            const isPast = step.number < currentStep
            const isLast = i === ONBOARDING_STEPS.length - 1
            return (
              <div key={step.key} className={clsx('flex flex-col items-center', isLast ? '' : 'flex-1')}>
                <div className="flex items-center w-full">
                  <div className={clsx(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-all',
                    isDone ? 'bg-indigo-600 text-white' :
                    isActive ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-600' :
                    'bg-gray-200 text-gray-500'
                  )}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : step.number}
                  </div>
                  {!isLast && (
                    <div className={clsx('flex-1 h-0.5 rounded mx-1', isDone || isPast ? 'bg-indigo-600' : 'bg-gray-200')} />
                  )}
                </div>
                <span className={clsx('text-[10px] font-medium mt-1.5 whitespace-nowrap', isActive ? 'text-indigo-700' : 'text-gray-400')}>
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-start justify-center px-8 py-8">
        <div className="w-full max-w-2xl">

          {/* Step 1: Welcome */}
          {currentStep === 1 && (
            <StepCard
              title={`Welcome to Tesseract, ${user?.user_metadata?.first_name || 'there'}!`}
              subtitle={`You're setting up ${orgName}. Let's get your team ready to go.`}
            >
              <div className="space-y-4">
                <div className="bg-indigo-50 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-medium text-indigo-900">Here's what we'll set up:</p>
                  <ul className="text-sm text-indigo-700 space-y-1.5">
                    <li className="flex items-center gap-2"><Briefcase className="w-4 h-4" /> Portfolios you manage</li>
                    <li className="flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> Load your holdings</li>
                    <li className="flex items-center gap-2"><Users className="w-4 h-4" /> Recommend colleagues for access</li>
                  </ul>
                </div>
                {existingPortfolios.length > 0 && (
                  <div className="bg-green-50 rounded-xl p-4">
                    <p className="text-sm font-medium text-green-800">Already set up for you:</p>
                    <ul className="text-sm text-green-700 mt-1 space-y-0.5">
                      <li>{existingPortfolios.length} portfolio{existingPortfolios.length !== 1 ? 's' : ''}</li>
                    </ul>
                  </div>
                )}
              </div>
              <StepActions onNext={() => handleCompleteStep('welcome')} isSubmitting={false} />
            </StepCard>
          )}

          {/* Step 2: Portfolios */}
          {currentStep === 2 && (
            <StepCard
              title="Set Up Portfolios"
              subtitle="Create your own portfolio or start with a pre-built template that includes sample holdings."
            >
              {existingPortfolios.length > 0 && (
                <div className="bg-green-50 rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-green-700">
                    Already created: {existingPortfolios.map(p => p.name).join(', ')}
                    {Object.keys(holdingsUploaded).length > 0 && (
                      <> ({Object.values(holdingsUploaded).reduce((a, b) => a + b, 0)} positions loaded)</>
                    )}
                  </p>
                </div>
              )}

              {/* Template portfolios */}
              <div className="space-y-2 mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Quick start with a template</p>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATE_PORTFOLIOS.map(tpl => {
                    const alreadyCreated = existingPortfolios.some(p => p.name === tpl.name)
                    return (
                    <button
                      key={tpl.id}
                      disabled={isSubmitting || alreadyCreated}
                      onClick={async () => {
                        if (alreadyCreated) return
                        setIsSubmitting(true)
                        try {
                          // Create portfolio
                          const { data: newPortfolio, error: pErr } = await supabase.from('portfolios').insert({
                            organization_id: currentOrgId,
                            name: tpl.name,
                            benchmark: tpl.benchmark,
                            is_active: true,
                          }).select('id').single()
                          if (pErr) throw pErr

                          // Add creator as portfolio member
                          if (user?.id) {
                            await supabase.from('portfolio_memberships').insert({ portfolio_id: newPortfolio.id, user_id: user.id }).then(() => {})
                            await supabase.from('portfolio_team').insert({ portfolio_id: newPortfolio.id, user_id: user.id, role: 'pm' }).then(() => {})
                          }

                          // Load template holdings into it
                          setSelectedPortfolioForHoldings(newPortfolio.id)
                          setSelectedTemplate(tpl)
                          setHoldingsMode('template')
                          // Resolve symbols
                          const symbols = tpl.positions.map(p => p.symbol)
                          const { data: assets } = await supabase.from('assets').select('id, symbol').in('symbol', symbols)
                          const assetMap = new Map((assets || []).map(a => [a.symbol, a.id]))

                          const snapshotDate = new Date().toISOString().split('T')[0]
                          const totalMV = tpl.positions.reduce((s, p) => s + p.shares * p.price, 0)

                          const { data: snapshot, error: snapErr } = await supabase.from('portfolio_holdings_snapshots').insert({
                            portfolio_id: newPortfolio.id,
                            organization_id: currentOrgId,
                            snapshot_date: snapshotDate,
                            source: 'manual_upload',
                            total_market_value: totalMV,
                            total_positions: tpl.positions.length,
                            uploaded_by: user!.id,
                            notes: `Seeded from template: ${tpl.name}`,
                          }).select('id').single()
                          if (snapErr) throw snapErr

                          await supabase.from('portfolio_holdings_positions').insert(
                            tpl.positions.map(p => ({
                              snapshot_id: snapshot.id,
                              portfolio_id: newPortfolio.id,
                              organization_id: currentOrgId,
                              asset_id: assetMap.get(p.symbol) || null,
                              symbol: p.symbol,
                              shares: p.shares,
                              price: p.price,
                              market_value: p.shares * p.price,
                              weight_pct: p.weight_pct,
                              sector: p.sector,
                            }))
                          )

                          // Upsert into portfolio_holdings for simulation baseline
                          const today = new Date().toISOString().split('T')[0]
                          const holdingsRows = tpl.positions
                            .filter(p => assetMap.has(p.symbol))
                            .map(p => ({
                              portfolio_id: newPortfolio.id,
                              asset_id: assetMap.get(p.symbol)!,
                              shares: p.shares,
                              price: p.price,
                              cost: p.price,
                              date: today,
                            }))
                          if (holdingsRows.length > 0) {
                            await supabase.from('portfolio_holdings').upsert(
                              holdingsRows,
                              { onConflict: 'portfolio_id,asset_id,date' }
                            )
                          }

                          // Seed sample trade ideas at different pipeline stages
                          const sampleIdeas = [
                            { symbol: tpl.positions[0]?.symbol, action: 'add', stage: 'idea', thesis: 'Strong momentum and earnings growth trajectory. Consider adding to position.' },
                            { symbol: tpl.positions[3]?.symbol, action: 'trim', stage: 'discussing', thesis: 'Valuation stretched relative to peers. Evaluate trimming to reduce concentration risk.' },
                            { symbol: tpl.positions[6]?.symbol, action: 'buy', stage: 'deep_research', thesis: 'Compelling entry point after recent pullback. Needs further analysis on competitive positioning.' },
                          ]
                          for (const idea of sampleIdeas) {
                            const ideaAssetId = assetMap.get(idea.symbol || '')
                            if (!ideaAssetId) continue
                            try {
                              await supabase.from('trade_queue_items').insert({
                                asset_id: ideaAssetId,
                                portfolio_id: newPortfolio.id,
                                action: idea.action,
                                stage: idea.stage,
                                status: 'idea',
                                thesis: idea.thesis,
                                created_by: user!.id,
                                origin_type: 'manual',
                                origin_metadata: { source: 'pilot_onboarding' },
                                context_tags: [],
                              })
                            } catch {}
                          }

                          setHoldingsUploaded(prev => ({ ...prev, [newPortfolio.id]: tpl.positions.length }))
                          queryClient.invalidateQueries({ queryKey: ['onboarding-existing-portfolios'] })
                          success(`Created "${tpl.name}" with ${tpl.positions.length} positions`)
                        } catch (err: any) {
                          showError(err.message || 'Failed to create template portfolio')
                        } finally {
                          setIsSubmitting(false)
                        }
                      }}
                      className={clsx(
                        'text-left p-3 rounded-lg border transition-all disabled:opacity-50',
                        alreadyCreated
                          ? 'border-green-200 bg-green-50/50'
                          : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-800">{tpl.name}</p>
                        {alreadyCreated && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">{tpl.positions.length} positions &middot; {tpl.benchmark}</p>
                    </button>
                    )
                  })}
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">or create your own</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {/* Manual portfolio creation */}
              <div className="space-y-3">
                {portfolios.map((p, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        placeholder={i === 0 ? 'Portfolio name' : 'Portfolio name'}
                        value={p.name}
                        onChange={e => setPortfolios(prev => prev.map((pt, j) => j === i ? { ...pt, name: e.target.value } : pt))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      <input
                        type="text"
                        placeholder="Benchmark (optional, e.g., S&P 500)"
                        value={p.benchmark}
                        onChange={e => setPortfolios(prev => prev.map((pt, j) => j === i ? { ...pt, benchmark: e.target.value } : pt))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                    </div>
                    {portfolios.length > 1 && (
                      <button onClick={() => setPortfolios(prev => prev.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-500 mt-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <button onClick={() => setPortfolios(prev => [...prev, { name: '', benchmark: '', teamName: '' }])} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                    <Plus className="w-4 h-4" /> Add another
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    <Upload className="w-4 h-4" /> Upload CSV
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>
              </div>

              {/* CSV preview (shown after file selected) */}
              {csvText && parsedPositions.length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
                      <span className="font-medium text-gray-700">{csvFileName}</span>
                      <span className="text-xs text-gray-400">({parsedPositions.length} positions)</span>
                    </div>
                    <button
                      onClick={() => { setCsvText(''); setCsvFileName(''); setParsedPositions([]); setParseErrors([]); setParseWarnings([]) }}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      Remove
                    </button>
                  </div>

                  {parseErrors.length > 0 && (
                    <div className="bg-red-50 rounded-lg p-3">
                      {parseErrors.map((err, i) => (
                        <p key={i} className="text-xs text-red-600">{err}</p>
                      ))}
                    </div>
                  )}

                  {/* Portfolio selector for CSV upload */}
                  {existingPortfolios.length > 0 && !selectedPortfolioForHoldings && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Upload into which portfolio?</label>
                      <select
                        value={selectedPortfolioForHoldings}
                        onChange={e => setSelectedPortfolioForHoldings(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="">Select portfolio...</option>
                        {existingPortfolios.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(selectedPortfolioForHoldings || portfolios.some(p => p.name.trim())) && (
                    <button
                      onClick={async () => {
                        // If they typed a manual portfolio name, create it first
                        if (!selectedPortfolioForHoldings && portfolios.some(p => p.name.trim())) {
                          const p = portfolios.find(p => p.name.trim())!
                          const { data, error } = await supabase.from('portfolios').insert({
                            organization_id: currentOrgId,
                            name: p.name.trim(),
                            benchmark: p.benchmark.trim() || null,
                            is_active: true,
                          }).select('id').single()
                          if (error) { showError(error.message); return }
                          setSelectedPortfolioForHoldings(data.id)
                          queryClient.invalidateQueries({ queryKey: ['onboarding-existing-portfolios'] })
                          // Wait for state to settle then upload
                          setTimeout(() => handleUploadHoldings(), 100)
                          return
                        }
                        setHoldingsMode('csv')
                        handleUploadHoldings()
                      }}
                      disabled={isSubmitting}
                      className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      Load {parsedPositions.length} Positions
                    </button>
                  )}
                </div>
              )}

              <StepActions
                onNext={handleCreatePortfolios}
                onBack={handleGoBack}
                onSkip={() => handleSkipStep('portfolios')}
                isSubmitting={isSubmitting}
                nextLabel={portfolios.some(p => p.name.trim()) ? 'Create Portfolios' : (existingPortfolios.length > 0 ? 'Continue' : undefined)}
                skippable={existingPortfolios.length > 0}
              />
            </StepCard>
          )}

          {/* Step 3: Recommend Colleagues */}
          {currentStep === 3 && (
            <StepCard
              title="Who else should try Tesseract?"
              subtitle="Recommend colleagues who would benefit from the platform. We'll reach out to them on your behalf."
            >
              <div className="bg-indigo-50 rounded-lg p-3 mb-4">
                <p className="text-xs text-indigo-700">
                  This won't send any emails automatically. Our team will personally follow up with anyone you recommend.
                </p>
              </div>
              <div className="space-y-3">
                {recommendations.map((rec, i) => (
                  <div key={i} className="space-y-2 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Name"
                        value={rec.name}
                        onChange={e => setRecommendations(prev => prev.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                      />
                      {recommendations.length > 1 && (
                        <button onClick={() => setRecommendations(prev => prev.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="email"
                        placeholder="Email (optional)"
                        value={rec.email}
                        onChange={e => setRecommendations(prev => prev.map((r, j) => j === i ? { ...r, email: e.target.value } : r))}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                      />
                      <input
                        type="text"
                        placeholder="Role (e.g., PM, Analyst)"
                        value={rec.role}
                        onChange={e => setRecommendations(prev => prev.map((r, j) => j === i ? { ...r, role: e.target.value } : r))}
                        className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                      />
                    </div>
                  </div>
                ))}
                <button onClick={() => setRecommendations(prev => [...prev, { name: '', email: '', role: '' }])} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                  <Plus className="w-4 h-4" /> Add another person
                </button>
              </div>
              <StepActions
                onNext={handleSubmitRecommendations}
                onBack={handleGoBack}
                onSkip={() => handleSkipStep('recommend_users')}
                isSubmitting={isSubmitting}
                nextLabel={recommendations.some(r => r.name.trim()) ? 'Submit Recommendations' : undefined}
                skippable
              />
            </StepCard>
          )}

          {/* Step 4: Review & Launch */}
          {currentStep === 4 && (
            <StepCard
              title="You're All Set!"
              subtitle="Here's a summary of your organization setup."
            >
              <div className="space-y-3">
                <SummaryRow icon={Building2} label="Organization" value={orgName} />
                <SummaryRow icon={Users} label="Recommendations" value={
                  recommendations.some(r => r.name.trim())
                    ? `${recommendations.filter(r => r.name.trim()).length} colleague${recommendations.filter(r => r.name.trim()).length !== 1 ? 's' : ''} recommended`
                    : 'None yet'
                } />
                <SummaryRow icon={Briefcase} label="Portfolios" value={existingPortfolios.length > 0 ? existingPortfolios.map(p => p.name).join(', ') : 'None yet'} />
                <SummaryRow icon={Table2} label="Holdings" value={
                  existingPortfolios.length > 0
                    ? existingPortfolios.map(p => {
                        const count = holdingsUploaded[p.id]
                        return count ? `${p.name}: ${count} positions` : p.name
                      }).join(', ')
                    : 'None yet'
                } />
              </div>

              {stepsSkipped.length > 0 && (
                <div className="bg-amber-50 rounded-lg p-3 mt-4">
                  <p className="text-xs text-amber-700">
                    You skipped: {stepsSkipped.map(s => ONBOARDING_STEPS.find(st => st.key === s)?.label).filter(Boolean).join(', ')}.
                    You can set these up anytime from settings.
                  </p>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between">
                <button onClick={handleGoBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={handleLaunch}
                  disabled={isSubmitting}
                  className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-base flex items-center gap-2 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
                  Launch Tesseract
                </button>
              </div>
            </StepCard>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────

function StepCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function StepActions({ onNext, onBack, onSkip, isSubmitting, nextLabel, skippable }: {
  onNext: () => void
  onBack?: () => void
  onSkip?: () => void
  isSubmitting: boolean
  nextLabel?: string
  skippable?: boolean
}) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-6">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} disabled={isSubmitting} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
        {skippable && onSkip && (
          <button onClick={onSkip} disabled={isSubmitting} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50">
            <SkipForward className="w-4 h-4" /> Skip
          </button>
        )}
      </div>
      <button
        onClick={onNext}
        disabled={isSubmitting}
        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
      >
        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {nextLabel || 'Continue'}
        {!isSubmitting && <ArrowRight className="w-4 h-4" />}
      </button>
    </div>
  )
}

function SummaryRow({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-indigo-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900 truncate">{value}</p>
      </div>
    </div>
  )
}
