import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { EngagementTarget } from '../../lib/engagement'
import {
  Bot,
  Settings,
  Sparkles,
  ChevronDown,
  PanelLeftOpen,
  PanelLeftClose,
  ArrowLeft,
  Maximize2,
  Minimize2,
  AlertTriangle,
} from 'lucide-react'
import { useAI, useAISuggestions, type TagRef, type AIConversationSummary } from '../../hooks/useAI'
/* Project folders: the shelves, and the two sentinel selections ("all" is
   null, "unfiled" is UNFILED) that the rail always offers. */
import { useAIFolders } from '../../hooks/ai/useAIFolders'
/* The same templates the editor's dot menu reads, so a shortcut means one
   thing in both places. */
import { useTemplates } from '../../hooks/useTemplates'
/* The one opener the application has for a tagged object. It dispatches the
   tab descriptor and the typed event together, so a chip press lands on the
   canonical page rather than on a page that happens to be open. */
import { useQueryClient } from '@tanstack/react-query'
import {
  useReferenceTargets, resolveReferences, referenceSetKey, REFERENCE_TARGETS_KEY,
} from '../../hooks/ai/useReferenceTargets'
import { openReference, referenceKey } from '../../lib/ai/reference-targets'
import { manifestIndex, retrievalBanner, type ChipRetrieval } from '../../lib/ai/context-outcome'
import { UNFILED, type FolderSelection } from '../../lib/ai/folders'
import { useAIConfig, AI_MODELS, AI_PROVIDERS, type AIProvider } from '../../hooks/useAIConfig'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'
/*
 * The presentation layer, shared with the contextual asset briefing.
 *
 * The message bubble, the research trail, the citations footer and the three
 * non-answer states used to be module-local functions in this file. They are
 * in `components/ai` now for one reason: a second surface has to say the same
 * things in the same words, and a copied research trail is how "the lookup
 * failed" starts rendering as "no records found" on one surface and not the
 * other.
 */
import { AiMessage, AiThinking, AiErrorNotice, AiPrompts, AiContextAttach, AiEntryOrientation, AiKeep, AiComposer, AiSlashMenu, AiArtifactSave, slashRowText } from '../ai'
import { AIConversationList } from './AIConversationList'
import { AISuggestedActions } from './AISuggestedActions'
import type { AiAction } from '../../lib/ai'
/*
 * The two shapes this pane takes, and the layout each implies.
 *
 * Derived from the pane the reader is already in rather than stored here: a
 * second, independent mode switch is how a 384px rail ends up claiming to be
 * in research mode. See `lib/ai/chat-modes`.
 */
import { chatLayout, modeToggleLabel, type AiChatMode } from '../../lib/ai/chat-modes'
import { ACT_AI_PLACEHOLDER } from '../../lib/ai/brand'
/* Questions grounded in the reader's own open work, and the merge that puts
   them ahead of the questions derived from the conversation's bindings. */
import { candidatePrompts, mergePrompts } from '../../lib/ai/prompt-candidates'
import { useGroundedPromptFacts } from '../../hooks/ai/useGroundedPrompts'
import { useSlashReading } from '../../hooks/ai/useSlashReading'
import { parseSlashCommand } from '../../lib/ai/slash-commands'
import { useAiArtifacts } from '../../hooks/ai/useAiArtifacts'
import {
  ARTIFACT_SUBJECT_TYPES, initialArtifactDraft, isArtifactSubjectType,
  type ArtifactDraft,
} from '../../lib/ai/artifact-store'

/** What the save form holds while nothing is being kept. */
const EMPTY_ARTIFACT_DRAFT: ArtifactDraft = { title: '', subject: null, folderId: null }

/** How many questions each layout has room for. Matches `chatLayout`. */
const LIMIT_FOR: Record<AiChatMode, number> = { compact: 4, research: 6 }
import {
  conversationContextState, describeSendTarget, shortSubjectLabel,
  subjectsAgree, subjectTag,
} from '../../lib/ai/conversation-context'
/*
 * The one authoritative answer to "what will the next message carry".
 *
 * This pane used to draw context in three bands from three sources, only one
 * of which the request actually reads. The module's own header has the full
 * account; the short version is that `objects` comes from `tags` and nothing
 * else, so removing a chip is true everywhere at once rather than in the one
 * band that happened to be wired to it.
 */
import { activeContext, describeActiveContext } from '../../lib/ai/active-context'
/* The routing a cited source follows, shared with `SourceRef`'s own default
   so the pane can wrap the hop without re-deriving where it goes. */
import { openSourceRef } from '../../lib/ai/source-focus'
import { useEntitySearch } from '../../hooks/useEntitySearch'
import {
  DISCOVERY_TYPES, objectTag, rankObjects, shouldSearchObjects,
  type DiscoveredObject,
} from '../../lib/ai/object-discovery'

interface AISectionProps {
  isOpen: boolean
  onToggle: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  // Tags pre-applied to NEW conversations created in this panel session.
  // Replaces the old `context` prop; opening AI from the AAPL page passes
  // `[{type:'asset', id:aapl_id}]` so new threads start tagged with AAPL.
  initialTags?: TagRef[]
  /**
   * The object and issue this panel was opened about, when it was opened
   * from the engagement seam rather than from a tab.
   *
   * Additive and inert when absent: with no target this component behaves
   * exactly as it did before. It never changes what is SENT to the model —
   * context is still assembled server-side from the conversation's tags by
   * the ai-chat function. It shows the user what was bound, and it offers
   * the surface's suggested question in the composer for the user to send,
   * edit or ignore.
   */
  engagementTarget?: EngagementTarget | null
  /**
   * The object the reader is currently looking at, from the active tab.
   *
   *
   * Distinct from `engagementTarget`, which is a request that was true when
   * it was dispatched and is never cleared. This is what the open
   * conversation is compared against, because it is the only one of the two
   * that follows the reader.
   */
  currentSubject?: { type: string; id: string; label?: string | null } | null
  onOpenSettings?: () => void
  /**
   * Compact rail or full-width research pane.
   *
   * Optional and derived from `isFullscreen` when absent, so every existing
   * caller keeps the behaviour it had. The parent passes it explicitly
   * because only the parent knows whether this is a phone sheet, where
   * "fullscreen" is meaningless and the control is not even rendered.
   */
  mode?: AiChatMode
  /**
   * Switch modes. Rendered as a labelled control inside the pane only when
   * supplied — on a phone there is nothing to switch to.
   *
   * It must be the SAME callback that drives the pane's own width
   * (`onToggleFullscreen`), not a second piece of state.
   */
  onToggleMode?: () => void
}

export function AISection({
  isOpen,
  onToggle,
  isFullscreen,
  onToggleFullscreen,
  initialTags = [],
  engagementTarget = null,
  currentSubject = null,
  onOpenSettings,
  mode: modeProp,
  onToggleMode,
}: AISectionProps) {
  /* One source of truth for the width: the pane's own fullscreen state. */
  const mode: AiChatMode = modeProp ?? (isFullscreen ? 'research' : 'compact')
  const layout = chatLayout(mode)
  const {
    messages,
    tags,
    isConfigured,
    isConfigResolving,
    configMode,
    conversationId,
    /* Whether this pane yet knows what it is showing. See the thread area. */
    isRestoringConversation,
    sendMessage,
    clearConversation,
    isLoading,
    error,
    // Stage 2: grounded activity text and the stop control.
    status,
    cancelGeneration,
    /*
     * What the server reported it could actually read, per attached object.
     *
     * The chips were drawn from this pane's own tag write, so one said
     * "Large Cap Growth" while the answer beside it had been built from no
     * portfolio. A chip is now the server's claim, not the client's.
     *
     * Defaulted, because an absent manifest must mean "nothing reported"
     * rather than throwing. That is the real state against a server that
     * predates the field, and the honest state in a test that stubs the hook.
     */
    contextManifest = [],
    // Tag labels are still used for read-only display (e.g. "About: AAPL"
    // hint in the header) — but the user no longer adds or removes tags
    // directly. They're inferred from whatever page launched the panel.
    tagLabels,
    // Multi-conversation: list + actions
    conversations,
    isLoadingList,
    selectConversation,
    newConversation,
    draftFolderId,
    setTags,
    renameConversation,
    archiveConversation,
    togglePin,
    deleteConversation,
    /*
     * Attaching an object is now a reader action again.
     *
     * These two were in the hook and unused by this pane: the comment above
     * said tags are "inferred from whatever page launched the panel", which
     * left a reader who wanted a second name in the conversation with no way
     * to say so. Both persist to `ai_conversation_tags`, which is what the
     * server reads, so this changes the sources rather than a label.
     */
    addTag,
    removeTag,
    /* Detach everything, and delete the rows, in one action. The row of chips
       offers it; see the hook's own note for why it is not a per-chip loop. */
    clearContext,
    // Project folders: the thread's one organizational home.
    moveConversationToFolder,
    // Archiving had no way back in the UI. These two are it.
    loadArchived,
    unarchiveConversation,
  } = useAI(initialTags)

  /*
   * The archived threads, held only once a reader opens the disclosure.
   *
   * `undefined` means "not asked yet" and `[]` means "asked, nothing there",
   * which the list renders differently. Collapsing the two is the defect
   * this product has shipped three times: a default rendered as a verdict.
   */
  const [archivedConversations, setArchivedConversations] = useState<AIConversationSummary[] | undefined>(undefined)
  const handleLoadArchived = async () => {
    const rows = await loadArchived()
    setArchivedConversations(rows)
  }
  const handleUnarchive = (id: string) => {
    unarchiveConversation(id)
    setArchivedConversations(prev => prev?.filter(c => c.id !== id))
  }

  /*
   * Which of the conversation's objects the READER chose.
   *
   * Everything in `initialTags` arrived with the pane, from whatever page
   * opened it. The rest the reader attached. The distinction is not
   * cosmetic: it is the difference between "you asked about this" and "you
   * happen to be standing here", and a reader deciding whether ACT AI has
   * the right sources needs to see which is which.
   */
  const inheritedTagKeys = useMemo(
    () => initialTags.map(t => `${t.type}:${t.id}`),
    [initialTags],
  )

  /*
   * ── The active context, assembled once ──────────────────────────────────
   *
   * Everything on screen that claims to describe what ACT AI will receive is
   * drawn from this one value, and this one value is drawn from `tags`.
   *
   * The orientation line is in here too, but as an `event` rather than as an
   * object, because it is neither: it is a sentence about why the reader is
   * on this screen. It is never put on the wire as context, and dismissing it
   * detaches nothing.
   */
  /*
   * Dismissal is keyed to the event, not kept as a bare boolean.
   *
   * A boolean dismissed for one event stays dismissed for the next, so the
   * reader who closed AAPL's valuation breach would never be told why the
   * pane had opened again on NVDA. The key is the title plus the object, and
   * a new key is a new event that has not been dismissed.
   */
  const [dismissedEventKey, setDismissedEventKey] = useState<string | null>(null)
  const eventKey = engagementTarget?.issue?.title
    ? `${engagementTarget.objectType}:${engagementTarget.objectId}:${engagementTarget.issue.title}`
    : null

  const context = useMemo(
    () => activeContext({
      tags,
      inheritedKeys: inheritedTagKeys,
      target: engagementTarget,
      currentSubject,
      eventDismissed: eventKey !== null && dismissedEventKey === eventKey,
    }),
    [tags, inheritedTagKeys, engagementTarget, currentSubject, eventKey, dismissedEventKey],
  )

  /** The sentence form, for the row's own title attribute. */
  const contextSummary = useMemo(
    () => describeActiveContext(
      context,
      o => o.tag.label || tagLabels[o.key] || o.tag.id,
    ),
    [context, tagLabels],
  )

  /*
   * Opening the object a chip names.
   *
   * All four kinds now, each through the destination the application already
   * has for it -- see `lib/ai/reference-targets`, which holds the
   * descriptors and the reason none of them is invented here.
   *
   * The reference is resolved by READING the object, not by trusting the
   * cached label beside it, so a chip is a link exactly when the object is
   * still there and still visible to this reader. That is also what makes a
   * deleted reference degrade into text saying so instead of a link to a tab
   * that cannot render.
   *
   * The pane is not unmounted by any of this: a chip press dispatches a tab
   * descriptor, and the conversation is still open behind it when the reader
   * comes back.
   */
  const { targets: referenceTargets, isLoading: isResolvingReferences } = useReferenceTargets(tags)

  const referenceStatus = useCallback(
    (tag: TagRef): 'open' | 'checking' | 'gone' => {
      if (referenceTargets.has(referenceKey(tag))) return 'open'
      return isResolvingReferences ? 'checking' : 'gone'
    },
    [referenceTargets, isResolvingReferences],
  )

  /*
   * The server's verdict for one chip.
   *
   * Separate from `referenceStatus` above on purpose -- see the prop's own
   * note in `AiContextAttach`. `unknown` for anything the server has not
   * spoken about, which is every chip until the first answer returns.
   */
  const servedIndex = useMemo(() => manifestIndex(contextManifest), [contextManifest])

  const retrieval = useCallback(
    (tag: TagRef): ChipRetrieval => servedIndex.get(referenceKey(tag))?.outcome ?? 'unknown',
    [servedIndex],
  )

  /*
   * The line the reader cannot miss.
   *
   * A tooltip alone is not enough: finding out that the answer in front of
   * you was built without the portfolio you attached should not require
   * hovering the right chip. Labels come from the chip's own vocabulary so
   * the banner names the same thing the chip does.
   */
  const retrievalWarning = useMemo(
    () => retrievalBanner(
      contextManifest,
      e => tagLabels[`${e.type}:${e.id}`] || tags.find(t => t.id === e.id)?.label || `this ${e.type}`,
    ),
    [contextManifest, tagLabels, tags],
  )

  /*
   * ── Following a reference out of expanded research mode ─────────────────
   *
   * The destination worked and the transition did not. Pressing a reference
   * in expanded ACT AI navigated the page underneath, and expanded ACT AI
   * stayed over the top of it, so the reader saw nothing change and had to
   * close the pane by hand to find out where they had been sent. Then
   * re-opening it to carry on.
   *
   * So a reference press in research mode steps the pane back to the rail.
   * It is a mode change, not a close: the same component stays mounted, so
   * the conversation, the scroll position and an unsent draft all survive --
   * `mode-continuity.test.tsx` already pins that a mode change costs none of
   * them, which is what makes this safe to do automatically.
   *
   * In compact mode nothing happens. The rail is 384px beside the page, the
   * destination is already visible, and collapsing a pane the reader can see
   * past would be the same mistake in the other direction.
   */
  /** Set when a reference press collapsed research mode, so the toggle back
      can say what it is for rather than reading "Expand". */
  const [returnToResearch, setReturnToResearch] = useState(false)

  const followReference = useCallback((go: () => void) => {
    go()
    if (mode === 'research' && onToggleMode) {
      setReturnToResearch(true)
      onToggleMode()
    }
  }, [mode, onToggleMode])

  const openTaggedObject = useCallback(
    (tag: TagRef) => {
      followReference(() => openReference(referenceTargets.get(referenceKey(tag))))
    },
    [referenceTargets, followReference],
  )

  /**
   * A record the answer cited.
   *
   * Passed explicitly so the hop goes through `followReference`. Without it
   * `SourceRef` navigates on its own and the pane never learns a reference
   * was followed -- which is the half of the transition that was missing.
   * `openSourceRef` is the component's own default, lifted into `lib` so
   * both callers share one routing table.
   */
  const openCitedSource = useCallback(
    (source: Parameters<typeof openSourceRef>[0]) => {
      followReference(() => { openSourceRef(source, 'ai-chat-reference') })
    },
    [followReference],
  )

  /*
   * The reader's shelves, for the organization they are in.
   *
   * Private per reader and checked against live membership on every verb --
   * see the RLS note on the hook. The selection is component state because
   * it is a view, not a fact about the data: switching organizations
   * replaces the folder list, so the effect below drops a selection that no
   * longer names anything rather than leaving the list filtered by a folder
   * from the other firm.
   */
  const {
    folders, archivedFolders, createFolder, renameFolder, setFolderArchived, deleteFolder,
    lastError: folderError, organizationId: folderOrgId,
  } = useAIFolders()
  const { getByShortcut: getTemplateByShortcut } = useTemplates()
  const [folderSelection, setFolderSelection] = useState<FolderSelection>(null)

  useEffect(() => {
    if (folderSelection === null || folderSelection === UNFILED) return
    if (!folders.some(f => f.id === folderSelection)) setFolderSelection(null)
  }, [folders, folderSelection, folderOrgId])

  /*
   * The project an unsaved thread is destined for, named.
   *
   * Resolved against the live folder list rather than remembered, so a
   * project archived or deleted in another tab stops being announced instead
   * of naming somewhere that is no longer there.
   */
  const draftFolderName = useMemo(
    () => (draftFolderId ? folders.find(f => f.id === draftFolderId)?.name ?? null : null),
    [draftFolderId, folders],
  )

  /*
   * ── Object discovery, for the sidebar ───────────────────────────────────
   *
   * The search lives here rather than in the list because the list is driven
   * entirely by props and has never needed a Supabase client, which is what
   * makes it testable without auth or an organization provider. It mirrors
   * its query up; this runs the search and hands back ranked results.
   *
   * Permission scoping is `useEntitySearch`'s own: every branch queries
   * under the reader's RLS, so an object they cannot read never comes back.
   * Nothing here can widen that -- `rankObjects` only ever sorts what it was
   * given.
   */
  const [objectQuery, setObjectQuery] = useState('')
  /* The cache the reference resolver shares with `useReferenceTargets`, so
     opening an object the chips have already resolved is free. */
  const objectQueryClient = useQueryClient()
  const searchObjects = shouldSearchObjects(objectQuery)
  const { results: objectHits, isLoading: isSearchingObjects } = useEntitySearch({
    query: objectQuery.trim(),
    /* The four types the request can carry. `useEntitySearch` defaults to
       nine, including users and workflows, and offering one of those would
       be a dead end: there is nothing ACT AI could be asked about it. */
    types: [...DISCOVERY_TYPES],
    limit: 4,
    enabled: searchObjects,
  })
  const objectResults = useMemo(
    () => (searchObjects ? rankObjects(objectHits, objectQuery) : []),
    [searchObjects, objectHits, objectQuery],
  )

  /*
   * Starting a thread about an object the reader found.
   *
   * `newConversation()` first, because it resets to the entry point's tags,
   * and then the object as the only one -- the same order and the same
   * reason as `startHere`. Nothing is written until something is sent, so
   * changing their mind costs nothing.
   */
  const startConversationAbout = useCallback((object: DiscoveredObject) => {
    newConversation()
    setTags([objectTag(object) as TagRef])
  }, [newConversation, setTags])

  /*
   * ── Opening the object itself ───────────────────────────────────────────
   *
   * The band could narrow the list to an object's conversations and start a
   * new one about it, and could not open the object. That is the third of
   * the three things the brief asks of searchable discovery, and its absence
   * made the band a filter with a name rather than a place: a reader who
   * found CEG could talk about it and could not go and look at it.
   *
   * ── Resolved on press, through the same resolver the chips use ──────────
   *
   * `resolveReferences` is the function `useReferenceTargets` calls, shared
   * rather than copied, and `fetchQuery` on its own key so the two callers
   * populate one cache entry. Pressing is also the right moment: the band
   * renders for every object the reader opens, and resolving on render would
   * query four tables for a destination most of them never press.
   *
   * ── Why resolving IS the permission check ──────────────────────────────
   *
   * The probe runs as the reader under RLS, so an object they may not read
   * comes back empty and nothing is dispatched. That is the same mechanism
   * the reference chips use to decide whether they are links, and it means
   * "can I open this" and "is it still there" cannot disagree -- a search
   * result the reader found a moment ago can have been deleted since, and an
   * optimistic hop would open a tab on an id that resolves to nothing.
   *
   * A note needs the resolution for a second reason: its id does not say
   * which of three tables it is in, and the tab id is built from the entity
   * that owns it.
   */
  const openObjectDestination = useCallback(async (object: DiscoveredObject) => {
    const tag = { type: object.type, id: object.id }
    const key = referenceSetKey([tag])
    if (!key) return false
    try {
      const targets = await objectQueryClient.fetchQuery({
        queryKey: [REFERENCE_TARGETS_KEY, key],
        staleTime: 30_000,
        queryFn: () => resolveReferences(key),
      })
      const resolved = targets.get(referenceKey(tag)) ?? null
      if (!resolved) return false
      /*
       * Through `followReference`, the same seam the answer's own chips use.
       * Expanded research mode covers the destination, so a hop that did not
       * step out of it would navigate somewhere the reader cannot see -- the
       * defect that seam exists for -- and the conversation and draft are
       * preserved either way.
       */
      let went = false
      followReference(() => { went = openReference(resolved) })
      return went
    } catch {
      /* A failed read is "we could not confirm this is still yours", which
         is the same answer as a row that did not come back: do not navigate.
         The band says so rather than opening a tab that cannot render. */
      return false
    }
  }, [objectQueryClient, followReference])

  /** Everything the list needs to show and change folders, in one object. */
  const folderProps = {
    folders,
    archivedFolders,
    activeFolderId: folderSelection,
    onSelectFolder: setFolderSelection,
    onCreateFolder: createFolder,
    onRenameFolder: renameFolder,
    onArchiveFolder: setFolderArchived,
    onDeleteFolder: deleteFolder,
    onMoveConversation: (id: string, folderId: string | null) => {
      void moveConversationToFolder(id, folderId)
    },
    folderError,
    archivedConversations,
    onLoadArchived: handleLoadArchived,
    onUnarchive: handleUnarchive,
    objectResults,
    isSearchingObjects,
    onQueryChange: setObjectQuery,
    onNewConversationAbout: startConversationAbout,
    onOpenObject: openObjectDestination,
  }

  const { effectiveConfig, updateUserPrefs } = useAIConfig()
  /*
   * The questions offered on an empty thread.
   *
   * `tags` is the open conversation's own binding, so the suggestions follow
   * the thread rather than the last engagement. The target contributes only
   * what it alone knows — the ticker, the portfolio name, and the issue that
   * raised this — and `suggestedPrompts` names nothing it was not given.
   */
  /*
   * ...and only while the target still describes where the reader is. It is
   * never cleared, so after walking from AAPL to MSFT its ticker would
   * otherwise seed a question about AAPL on an MSFT thread. Same rule, and
   * the same helper, as the bound-object header below.
   */
  const targetStillCurrent = subjectsAgree(
    engagementTarget
      ? { type: engagementTarget.objectType, id: engagementTarget.objectId }
      : null,
    currentSubject,
  )
  const suggestions = useAISuggestions(tags, tagLabels, {
    target: engagementTarget && targetStillCurrent
      ? {
          symbol: engagementTarget.symbol ?? null,
          portfolioName: engagementTarget.portfolioName ?? null,
          issue: engagementTarget.issue ?? null,
        }
      : null,
    mode,
  })

  /*
   * ── The grounded half ──────────────────────────────────────────────────
   *
   * The questions above are derived from what this conversation is BOUND to.
   * These come from what the reader actually has open: recommendations
   * waiting on them, requirements past their date, ideas that have stopped
   * moving. Each carries the records that justify it, so the panel can say
   * why it is offering a question rather than just offering one.
   *
   * Fetched once per minute and cached, never recomputed per render: the old
   * list was rebuilt on every keystroke, and a re-ranked button under a
   * moving cursor is how a reader presses a question they did not read.
   *
   * Gated on the pane being open. An unopened pane reads nothing.
   */
  /*
   * `isSettling`, not `isLoading`. A disabled React Query reports
   * `isLoading: false` -- and this query is disabled until the user AND the
   * active organization are known, neither of which is true on the first
   * paint. Gating on `isLoading` let the generic questions paint and then be
   * replaced, which is the flash the gate exists to prevent.
   */
  const { data: promptFacts, isSettling: isLoadingPromptFacts } =
    useGroundedPromptFacts(isOpen)

  const groundedSuggestions = useMemo(() => {
    const grounded = candidatePrompts({
      ...(promptFacts ?? {}),
      subject: currentSubject
        ? {
            /* "AAPL" from "AAPL - Apple Inc.", the same trim the header
               uses, so a question names the ticker rather than the row. */
            label: shortSubjectLabel(currentSubject.label) ?? null,
            kind: currentSubject.type === 'asset' ? 'asset'
              : currentSubject.type === 'portfolio' ? 'portfolio'
              : currentSubject.type === 'theme' ? 'theme'
              : 'other',
          }
        : null,
      limit: LIMIT_FOR[mode],
    })
    /* Grounded first, the bound-context questions to fill, generic last. */
    return mergePrompts(grounded, suggestions, LIMIT_FOR[mode])
  }, [promptFacts, currentSubject, suggestions, mode])

  const [input, setInput] = useState('')
  /*
   * Slash Command keyboard state, held here because it spans two children.
   *
   * `AiSlashMenu` knows how many rows it is showing and `AiComposer` has the
   * focus that sees the arrow keys, so neither can own this alone. The
   * cursor resets whenever the row count changes: keeping the index would
   * leave it pointing at whatever now occupies that position, which is the
   * same defect the Add Context picker had.
   */
  const [slashRows, setSlashRows] = useState(0)
  const [slashCursor, setSlashCursor] = useState(0)
  useEffect(() => { setSlashCursor(0) }, [slashRows])

  /**
   * Place the surface's suggested question in the composer.
   *
   * Placed, never sent. Stage D1 lets the model analyse and propose; a
   * question the user did not choose to send is neither, and auto-sending
   * would also spend their tokens on a prompt they never read.
   *
   * Keyed on the seed itself rather than on the target, so re-opening the
   * panel for the same item does not clobber a reply the user has started
   * typing. Anything already in the box wins.
   *
   * ── Why it reads the EVENT and not the target ──────────────────────────
   *
   * Opening ACT AI and analysing an event are two different actions, and the
   * composer is where the difference is visible. "Ask ACT AI" from an asset
   * means the reader wants to ask something; finding a three-clause question
   * about what has changed since the case was written already typed into the
   * box answers a question they did not ask, and they then have to clear it
   * before they can ask their own.
   *
   * `context.event` exists only when the entry point named an issue -- a
   * valuation breach, a pending recommendation, research past its date. So a
   * seed is offered exactly when something specific raised this, and a plain
   * open gets an empty composer. The discriminator is the data the surfaces
   * already send; nothing new had to be threaded through them.
   *
   * `WorkspaceActions`' "Ask ACT AI" supplies a `seedPrompt` with no issue
   * and is therefore now a plain open, which is what its label promises.
   */
  const seedPrompt = context.event?.seedPrompt ?? null
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    if (!seedPrompt || seededRef.current === seedPrompt) return
    seededRef.current = seedPrompt
    setInput(prev => (prev.trim() ? prev : seedPrompt))
  }, [seedPrompt])

  /**
   * Resume the conversation the surface asked for.
   *
   * SELECTS, never creates: `selectConversation` loads an existing thread's
   * messages and tags and does not write. The guard on `conversationId` is
   * what makes re-opening the same thread safe — the request is already
   * satisfied, so nothing is re-fetched and an in-progress reply is not
   * discarded. A request for a different thread is honoured, which is
   * exactly what clicking another row in the sidebar already does.
   *
   * Keyed on the target object rather than on the id string, because each
   * engagement dispatch carries a fresh target: asking for a thread,
   * switching away by hand, then asking for the same thread again must work
   * the second time, and a dep on the bare id would make that a no-op.
   */
  /*
   * ── Does the open thread belong to where the reader is standing? ────────
   *
   * `tags` is the OPEN conversation's own tag set — `selectConversation`
   * loads it with the thread — so this compares the conversation against the
   * active tab, never against the engagement target, which does not follow
   * navigation and is exactly what made the pane claim AAPL on an MSFT page.
   */
  const contextState = conversationContextState({
    conversationId,
    conversationTags: tags,
    currentSubject,
  })
  const openConversationTitle =
    conversations.find(c => c.id === conversationId)?.title ?? null

  /*
   * Kept answers.
   *
   * `available` is false in every environment today -- the table's migration
   * is authored and unapplied -- so the Keep menu's artifact row is absent
   * rather than broken. Applying the migration turns it on with no change
   * here: the hook probes instead of reading a flag.
   */
  const artifacts = useAiArtifacts()
  const keptMessageIds = useMemo(
    () => new Set(
      artifacts.artifacts
        .filter(a => a.conversation_id === conversationId)
        .map(a => a.message_id),
    ),
    [artifacts.artifacts, conversationId],
  )
  /*
   * The open save form: which answer, its text for the preview, and the
   * reader's choices so far.
   *
   * The draft lives here rather than in the form so that a rejection from
   * the write can be shown without throwing the reader's title and subject
   * away -- which is what closing the dialog on failure would do.
   */
  const [keeping, setKeeping] = useState<
    { messageId: string; content: string; draft: ArtifactDraft } | null
  >(null)

  /* Its own query, separate from the sidebar's: the reader is choosing what
     an answer is ABOUT, which is a different search from finding a thread. */
  const [artifactSubjectQuery, setArtifactSubjectQuery] = useState('')
  const { results: artifactSubjectHits } = useEntitySearch({
    query: artifactSubjectQuery.trim(),
    /* Three types, not four. A note is something the reader wrote; an
       artifact is about a research object. The table's CHECK agrees. */
    types: [...ARTIFACT_SUBJECT_TYPES],
    limit: 4,
    enabled: shouldSearchObjects(artifactSubjectQuery),
  })
  const artifactSubjectResults = useMemo(
    () => (shouldSearchObjects(artifactSubjectQuery)
      ? rankObjects(artifactSubjectHits, artifactSubjectQuery, 6)
        .filter(o => isArtifactSubjectType(o.type))
        .map(o => ({ type: o.type, id: o.id, label: o.label, detail: o.detail }))
      : []),
    [artifactSubjectHits, artifactSubjectQuery],
  )

  const confirmKeepArtifact = async () => {
    if (!keeping || !conversationId) return
    const pending = keeping
    const row = await artifacts.keep({
      conversationId,
      messageId: pending.messageId,
      draft: pending.draft,
    })
    /* Closed only on success. A rejection leaves the form open with the
       reader's title and subject intact and the reason above the buttons;
       closing it would discard both and say nothing. */
    if (row) setKeeping(null)
  }
  const subjectName = shortSubjectLabel(currentSubject?.label)

  /*
   * Does the bound-object header still describe where the reader is?
   *
   * `engagementTarget` is frozen at the last engagement, so after walking
   * from AAPL to MSFT it still announces "context already supplied: Asset
   * AAPL". With no conversation open that is not a FOREIGN thread — there is
   * no thread — but it is still a false claim about the page, so the header
   * is suppressed whenever the two disagree.
   */
  const targetSubject = engagementTarget
    ? {
        type: engagementTarget.objectType,
        id: engagementTarget.objectId,
      }
    : null
  const headerDescribesHere = subjectsAgree(targetSubject, currentSubject)

  /**
   * Begin an investigation in the CURRENT page's context.
   *
   * `newConversation()` resets to `initialTags`, and those are derived from
   * the same stale target — so on its own it would have started a thread
   * tagged AAPL from a button labelled "Start one about MSFT". The tag for
   * where the reader actually is, is set explicitly after the reset.
   *
   * Still no write: both calls are local state. The row is created when the
   * user sends something, which is the only point at which they have said
   * anything to record.
   */
  const startHere = () => {
    newConversation()
    const tag = subjectTag(currentSubject)
    if (tag) setTags([tag as TagRef])
  }

  const requestedConversationId = engagementTarget?.conversationId ?? null
  useEffect(() => {
    if (!requestedConversationId) return
    if (requestedConversationId === conversationId) return
    void selectConversation(requestedConversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementTarget])
  const [showModelSelector, setShowModelSelector] = useState(false)
  // Sidebar visibility — separate state for inline (fullscreen) vs screen
  // (compact). In fullscreen the sidebar lives alongside chat and the
  // toggle hides/shows it. In compact the AI pane is too narrow for both,
  // so the conversation list takes over the whole pane like a screen
  // switch — the user navigates back via the same toggle.
  const [showConversationList, setShowConversationList] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('ai-panel.show-conversations') !== '0'
  })
  useEffect(() => {
    try {
      localStorage.setItem('ai-panel.show-conversations', showConversationList ? '1' : '0')
    } catch { /* ignore */ }
  }, [showConversationList])

  // In compact (right-pane) mode the conversation list is its own screen.
  // When the user picks a conversation, snap back to chat automatically —
  // they almost always want to read it, not stare at the list.
  const [showListAsScreen, setShowListAsScreen] = useState(false)
  /* Research mode has the width for the list beside the thread; compact does
     not, and hands the whole pane over to it instead. */
  const isInlineSidebar = layout.showInlineSidebar
  const handleSelectConversationFromList = (id: string) => {
    selectConversation(id)
    if (!isInlineSidebar) setShowListAsScreen(false)
  }
  const handleNewConversationFromList = (folderId?: string | null) => {
    newConversation(folderId ?? null)
    if (!isInlineSidebar) setShowListAsScreen(false)
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  // Current model — effectiveConfig already resolves: user pref →
  // org default → fallback (see useAIConfig).
  const currentProvider = (effectiveConfig.provider || 'anthropic') as AIProvider
  const currentModel = effectiveConfig.model || AI_MODELS[currentProvider]?.[0]?.id

  const currentModelInfo = AI_MODELS[currentProvider]?.find(m => m.id === currentModel)
  const currentProviderInfo = AI_PROVIDERS.find(p => p.id === currentProvider)

  // Per-user pref: any user can pick a model within the org's configured
  // provider. Cost still flows to the org's BYOK key. Disabled for
  // platform mode (the platform key choice is set globally).
  const canChangeModel = effectiveConfig.isConfigured && effectiveConfig.mode !== 'platform'

  // Close model selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleModelChange = (model: string) => {
    if (!canChangeModel) return
    updateUserPrefs({ preferred_model: model })
    setShowModelSelector(false)
  }

  // initialTags is the only "incoming" signal now. The hook handles
  // auto-loading the most recent conversation that overlaps initialTags
  // — no parent-context-sync effect needed here.

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /*
   * What was last sent, so a failed turn can be sent again.
   *
   * The hook POPS the message that failed, so after an error the text is gone
   * from the thread as well as from the composer: the reader's only move was
   * to retype what they had just typed. A ref rather than state because it is
   * never rendered and must not re-render the pane on every send.
   */
  const lastSentRef = useRef<string | null>(null)

  const send = (text: string) => {
    lastSentRef.current = text
    sendMessage(text)
  }

  /*
   * The reader's own templates, for `/template.<shortcut>` in the composer.
   *
   * The same `getByShortcut` the editor's dot menu uses, so a shortcut means
   * one thing in both places. It returns the stored text; nothing here
   * substitutes a variable, because a template's variables are filled in the
   * editor's own flow and a half-filled one in a question would read as the
   * reader's words.
   */
  const templateBody = useCallback(
    (shortcut: string) => getTemplateByShortcut(shortcut)?.content ?? null,
    [getTemplateByShortcut],
  )

  /*
   * The figure behind a market-data command.
   *
   * Read HERE rather than in the menu, because the composer's Enter key has
   * to insert exactly what the menu is showing: two components each doing
   * their own read is two answers, and the one the reader presses would not
   * be the one they saw. The hook returns null unless the command is one the
   * store can actually answer, so `/pe.AAPL` costs no query.
   */
  const slashParsed = useMemo(() => parseSlashCommand(input), [input])
  const slashReading = useSlashReading({
    id: slashParsed && !slashParsed.partial ? slashParsed.id : null,
    symbol: slashParsed?.symbol ?? null,
  })

  /* The composer hands over already-trimmed text and decides for itself when
     sending is allowed; this clears the box, which is what shrinks it. */
  const handleComposerSend = (text: string) => {
    send(text)
    setInput('')
  }

  /* Offered only while we still hold the exact text. A Retry that sends
     something else, or nothing, would be worse than no Retry. */
  const retryLastSend = lastSentRef.current && !isLoading
    ? () => send(lastSentRef.current as string)
    : undefined

  // When the AI mentions a $TICKER in its response, dispatch a CustomEvent
  // (same pattern as `open-shared-simulation` elsewhere). Any dashboard
  // listener can pick this up and open the asset tab. Until that listener
  // is wired, the pill renders but clicks are a no-op — visual win first,
  // navigation later.
  const handleTickerClick = (symbol: string) => {
    followReference(() => {
      window.dispatchEvent(new CustomEvent('open-asset-by-symbol', { detail: { symbol } }))
    })
  }

  const handleSuggestionClick = (suggestion: string) => {
    send(suggestion)
  }

  /*
   * The model's display name, from the catalogue.
   *
   * Falls back to the raw id for a model logged before the catalogue knew
   * about it — a stale label is worse than an honest identifier.
   */
  const modelLabelFor = (model?: string | null): string | null => {
    if (!model) return null
    for (const list of Object.values(AI_MODELS)) {
      const found = list.find(m => m.id === model)
      if (found) return found.name
    }
    return model
  }

  /*
   * ── Not configured, once we actually know that ──────────────────────────
   *
   * `isConfigured` is resolved from three queries, and until they land every
   * input is undefined and the resolver falls through to `false`. That false
   * is a DEFAULT, not a verdict, and rendering this whole screen on it is
   * what put a flash of "AI Assistant Not Configured" in front of every
   * reader who opened the pane.
   *
   * Nothing is rendered in its place. The pane's chrome is drawn by the
   * caller and this branch replaces the entire body, so a spinner here would
   * be a second full-pane state on the way to the first -- two flashes rather
   * than none. The resolve is three cached queries; the thread area's own
   * settle gate covers the rest.
   */
  /*
   * Not configured, once we actually know that -- and otherwise the real pane.
   *
   * `isConfigured` resolves from three queries and falls through to `false`
   * while they are in flight, so that false is a DEFAULT, not a verdict.
   * Rendering this screen on it told every reader their AI was not set up.
   *
   * The first fix returned an empty div for the resolving window, which
   * traded a wrong screen for a blank pane -- correct and worse. The pane's
   * chrome does not depend on the configuration at all: the header, the
   * context chips and the composer can paint immediately and be right. So
   * resolving now falls THROUGH to the real pane, and only the thread area
   * waits, which is the one region whose content is actually unknown.
   *
   * One transition, and the pane never looks broken or absent on the way to
   * it.
   */
  if (!isConfigured && !isConfigResolving) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-purple-100 dark:from-primary-900/30 dark:to-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="h-8 w-8 text-primary-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              AI Assistant Not Configured
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Connect your AI provider to unlock intelligent analysis of your investment research.
            </p>

            <div className="space-y-2 text-left bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Analyze your thesis for blind spots</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Generate outcome scenarios</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Summarize notes and discussions</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Answer research questions</span>
              </div>
            </div>

            <Button
              variant="primary"
              onClick={onOpenSettings}
              className="w-full"
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure in Settings
            </Button>

            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              You'll need an API key from Anthropic, OpenAI, Google, or Perplexity. Typical usage costs $5-20/month.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Compact-mode "screen": when the user opens the conversation list and
  // we don't have room for the inline sidebar, render the list full-pane
  // and stop rendering the chat surface entirely. Done as an early return
  // so the chat tree (with its own scroll/focus state) doesn't stay
  // mounted under it.
  if (!isInlineSidebar && showListAsScreen) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
          <button
            onClick={() => setShowListAsScreen(false)}
            className="text-sm text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 inline-flex items-center gap-1.5 font-medium"
            title="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to chat
          </button>
          <span className="text-sm font-medium text-gray-900 dark:text-white">Conversations</span>
        </div>
        <div className="flex-1 min-h-0">
          <AIConversationList
            conversations={conversations}
            activeConversationId={conversationId}
            tagLabels={tagLabels}
            onSelect={handleSelectConversationFromList}
            onNewConversation={handleNewConversationFromList}
            onRename={renameConversation}
            onArchive={archiveConversation}
            onTogglePin={togglePin}
            onDelete={deleteConversation}
            isLoading={isLoadingList}
            fullWidth
            {...folderProps}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Inline sidebar — only shown in fullscreen, where there's room.
          Compact mode uses the screen-takeover branch above. */}
      {isInlineSidebar && showConversationList && (
        <AIConversationList
          conversations={conversations}
          activeConversationId={conversationId}
          tagLabels={tagLabels}
          onSelect={selectConversation}
          onNewConversation={(folderId) => newConversation(folderId ?? null)}
          onRename={renameConversation}
          onArchive={archiveConversation}
          onTogglePin={togglePin}
          onDelete={deleteConversation}
          isLoading={isLoadingList}
          {...folderProps}
        />
      )}

      {/* Main pane */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
      {/*
        Why the reader is here — one line, and only that.

        This used to be `EngagementContextHeader`, which also announced
        "Context already supplied to the model" over a row of chips built from
        the engagement request. That claim was false in the way that matters:
        the model's context is the conversation's `tags`, and this band was
        drawn from something else entirely, so it kept naming an asset the
        reader had just detached by the composer. `AiEntryOrientation`'s
        header has the full list of what that band got wrong.

        Still suppressed over a foreign thread, for the original reason: a
        reader who has walked to a thread about something else should not be
        told why a different screen opened this pane.
      */}
      {context.event && contextState !== 'foreign' && headerDescribesHere && (
        <AiEntryOrientation
          event={context.event}
          onDismiss={() => setDismissedEventKey(eventKey)}
        />
      )}

      {/*
        Continuing and beginning, as two visible choices.

        A conversation that spans companies is a legitimate investigation,
        not a mistake, so continuing stays available and nothing is moved,
        re-tagged or cleared. What changes is that it is no longer silent:
        the reader is told which thread a message would join, and offered the
        other option by name.

        `newConversation` only resets local state to the current page's tags;
        no row is written until something is sent.
      */}
      {contextState === 'foreign' && (
        <div
          data-testid="ai-context-mismatch"
          className="flex-shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-400/30 dark:bg-amber-500/[0.08]"
        >
          <span className="text-[11px] text-amber-800 dark:text-amber-300">
            {describeSendTarget(contextState, openConversationTitle)}
            {subjectName ? ` Not about ${subjectName}.` : ''}
          </span>
          <button
            type="button"
            data-testid="ai-start-here"
            onClick={startHere}
            className="ml-auto rounded bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-700"
          >
            {subjectName ? `Start one about ${subjectName}` : 'Start a new conversation'}
          </button>
        </div>
      )}
      {/* The pane's own controls: conversations, and the mode this is in. */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <button
          onClick={() => {
            if (isInlineSidebar) setShowConversationList(v => !v)
            else                 setShowListAsScreen(true)
          }}
          className="p-1 rounded text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          title={
            isInlineSidebar
              ? (showConversationList ? 'Hide conversations' : 'Show conversations')
              : 'Open conversations'
          }
        >
          {isInlineSidebar && showConversationList
            ? <PanelLeftClose className="h-4 w-4" />
            : <PanelLeftOpen  className="h-4 w-4" />}
        </button>

        {/*
          The mode, named rather than implied.

          The width control already existed in the pane's outer chrome as an
          unlabelled Maximize icon, which is why nobody found the research
          layout: "fullscreen" describes the window, not what the pane becomes.
          Same callback, same single piece of state — this one says what it is
          for. Absent on a phone, where the sheet is already edge to edge.
        */}
        {onToggleMode && (
          <button
            type="button"
            data-testid="ai-mode-toggle"
            onClick={() => { setReturnToResearch(false); onToggleMode() }}
            aria-pressed={mode === 'research'}
            className={clsx(
              'ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
              mode === 'research'
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200',
            )}
            title={
              returnToResearch && mode !== 'research'
                ? 'Back to the conversation in research mode. Your draft is still there.'
                : modeToggleLabel(mode)
            }
          >
            {mode === 'research'
              ? <Minimize2 className="h-3.5 w-3.5" />
              : <Maximize2 className="h-3.5 w-3.5" />}
            {/*
              The way back, named.

              The pane steps out of research mode by itself when a reference
              is followed, so that the reader can see where they landed. A
              control reading "Expand" after that is technically true and
              useless: the thing the reader wants is the conversation they
              were just in, and nothing on screen said it was still open.
              The word changes until they use it.
            */}
            {mode === 'research'
              ? 'Research mode'
              : returnToResearch ? 'Back to ACT AI' : 'Expand'}
          </button>
        )}
      </div>

      {/*
        There is no second context row here any more.

        `AiContextChips` used to sit at this point, drawn from `currentSubject`
        and `engagementTarget`. It answered "which company am I asking about"
        on a scrolled rail, which is a real question — but it answered it from
        inputs the request never reads, so it was the band that went on saying
        "AAPL" after AAPL had been detached. The composer's row answers the
        same question from the authoritative set and is pinned to the bottom
        of the pane, so it is on screen whenever this was.
      */}

      {/*
        Messages.

        The scrollport is the pane; the COLUMN inside it is the reading
        measure. Research mode centres a 48rem column rather than stretching a
        thread across a 1600px monitor, where prose runs to about 200
        characters a line and a reply becomes unreadable at exactly the moment
        the reader asked for more room.
      */}
      <div className={clsx('flex-1 overflow-y-auto', layout.threadPad)}>
        {/* `min-h-full` so the empty state's own centring still has a box to
            centre inside once the column, rather than the scrollport, is the
            prompts' parent. */}
        <div className={clsx(layout.column, layout.threadGap, 'flex min-h-full flex-col')}>
        {/* The grounded facts join the same gate: questions paint once,
            already grounded, rather than appearing generic and re-ranking a
            moment later. One transition, which is the whole point of the
            gate. A failed fetch still resolves, so this cannot hang. */}
        {(isRestoringConversation || isLoadingPromptFacts || isConfigResolving) ? (
          /*
            Not known yet, so nothing claimed.

            Opening the panel on an asset used to paint the empty state first,
            then rewrite its prompts once the tag labels landed, then replace
            the whole screen with the restored thread. Each paint was honest
            about what was known at the time, which is exactly the problem:
            "we have not looked yet" and "there is nothing here" rendered the
            same.

            An empty column rather than a skeleton or a spinner. The header,
            the context chips and the composer are already painted, so the
            pane reads as open and working, and a placeholder that survives
            300ms is the flash this change exists to remove. No timer, no
            minimum duration: the gate is the data landing.
          */
          <div data-testid="ai-thread-settling" className="flex-1" aria-busy="true" />
        ) : messages.length === 0 ? (
          /* An empty thread. The prompts carry the explanation; if the prior
             message failed and got popped, the error rides above them so it
             does not just look as though nothing happened. */
          <AiPrompts
            suggestions={groundedSuggestions}
            onPick={handleSuggestionClick}
            header={
              <>
                <AiErrorNotice error={error} onRetry={retryLastSend} />
                {/* Where this will land, said before it lands.
                    The row is written on the first answer, so without this
                    the reader presses "New conversation in Earnings season"
                    and then has nothing but faith that it stuck. */}
                {draftFolderName && (
                  <p
                    data-testid="ai-draft-folder"
                    className="mb-2 text-[11px] text-gray-500 dark:text-gray-400"
                  >
                    Will be saved in {draftFolderName}.
                  </p>
                )}
              </>
            }
            columns={layout.promptColumns}
          />
        ) : (
          <>
            {messages.map((message) => (
              <AiMessage
                key={message.id}
                message={message}
                modelLabel={modelLabelFor(message.model)}
                onTickerClick={handleTickerClick}
                /* So a cited record is followed through the pane rather than
                   around it. See `openCitedSource`. */
                onOpenSource={openCitedSource}
                /* The bubble's ceiling, and whether the evidence rail starts
                   open. Research mode is where sources get checked. */
                mode={mode}
                /* Structured recommendations arrive already validated against
                   the action catalogue and against this conversation's own
                   context. The pane never reads the prose to find them, and
                   the presentation layer never renders an action of its own. */
                footer={message.actions && message.actions.length > 0
                  ? <AISuggestedActions actions={message.actions} />
                  : null}
                /* Keeping an answer. It opens the canonical capture form with
                   the text in it and saves nothing on its own -- the thread's
                   title rides along as the record's provenance. */
                metaActions={
                  <AiKeep
                    message={message}
                    conversationTitle={openConversationTitle}
                    subject={currentSubject ?? null}
                    /* Needs a thread to point at: an artifact is a pointer,
                       and an unsaved conversation has no id to point with. */
                    canKeepArtifact={
                      artifacts.available && !!conversationId && !keptMessageIds.has(message.id)
                    }
                    onKeepArtifact={() => setKeeping({
                      messageId: message.id,
                      content: message.content,
                      /* Pre-filled from where the reader already is -- the
                         subject, and the project the thread is filed in --
                         and all of it changeable before it is saved. */
                      draft: initialArtifactDraft({
                        content: message.content,
                        conversationTitle: openConversationTitle,
                        subject: currentSubject ?? null,
                        folderId: conversations.find(c => c.id === conversationId)?.folder_id ?? null,
                      }),
                    })}
                  />
                }
              />
            ))}

            {/* Loading indicator */}
            {/* Only while the answer has not started arriving. Once prose is
                streaming into the bubble above, a second spinner underneath it
                says nothing the reader cannot already see. The label is a
                grounded activity from the stream, never model text. */}
            {/* No Stop here any more. The composer owns it, so there is one
                Stop in one place for the whole generation rather than one that
                vanishes the moment prose starts arriving. */}
            {isLoading && !messages.some(m => m.streaming && m.content) && (
              <AiThinking status={status} />
            )}

            {/* Error message */}
            {error && (
              <div className="flex justify-center">
                <AiErrorNotice error={error} onRetry={retryLastSend} className="max-w-[85%]" />
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
        </div>
      </div>

      {/* Input */}
      <div className={clsx('border-t border-gray-200 dark:border-gray-700', mode === 'research' ? 'px-6 py-4' : 'p-4')}>
        <div className={layout.column}>
        {/*
          What this conversation may use, and the control that adds to it.

          Unlike the chip row above the thread, this one WRITES: it changes
          `ai_conversation_tags`, which is the canonical input `ai-chat` reads
          to build its document blocks. Attached, inherited and merely
          mentioned are three different things and only the first two are
          drawn — see the component's own note.
        */}
        {/*
          Tesseract's own slash commands, for the few that mean something in
          a chat message. It names the ones that do not -- a chart needs an
          editor node and chat has no renderer for one -- rather than drawing
          a degraded version. Nothing it offers sends anything: the expansion
          lands in the box under the reader's hands.

          Above the container rather than inside it, because it is a picker
          over the box, not a part of it.
        */}
        {/*
          What the last answer could not see, stated once, above the box.

          This is the part of the context fix a reader cannot miss. The chips
          carry the same information per object, but only on hover, and the
          reader has no reason to hover a chip that looks attached. It sits
          above the composer rather than beside the answer because it is also
          a reason to ask again.

          `role="status"` rather than `alert`: it is the consequence of an
          action the reader just took, not an interruption, so it should be
          announced after the answer rather than over it.
        */}
        {retrievalWarning && (
          <div
            role="status"
            data-testid="ai-context-warning"
            className="mb-1.5 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11.5px] leading-snug text-amber-900 dark:border-amber-500/50 dark:bg-amber-900/20 dark:text-amber-200"
          >
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{retrievalWarning}</span>
          </div>
        )}
        <AiSlashMenu
          value={input}
          onPick={setInput}
          templateBody={templateBody}
          reading={slashReading}
          activeIndex={slashRows > 0 ? slashCursor : undefined}
          onRowCountChange={setSlashRows}
        />
        {/*
          ONE composer. The box, the attachments, the model picker, Settings
          and the send control are all inside a single bordered container
          now, which is what the five separate complaints off the screenshot
          came down to: a bordered field with a filled square beside it, a
          context band floating above it and a model row detached below.
          `AiComposer`'s own header carries each cause.
        */}
        <AiComposer
          value={input}
          onChange={setInput}
          onSend={handleComposerSend}
          onStop={cancelGeneration}
          isStreaming={isLoading}
          placeholder={ACT_AI_PLACEHOLDER}
          /* The Slash Command keyboard. The menu above owns the list; the
             composer owns the keys, because it is what has focus. */
          slashRows={slashRows}
          slashCursor={slashCursor}
          onSlashCursorChange={setSlashCursor}
          onSlashPick={i => slashRowText(input, i, { templateBody, reading: slashReading })}
          toolbar={
            <>
              <div className="relative shrink-0" ref={modelSelectorRef}>
                <button
                  onClick={() => canChangeModel && setShowModelSelector(!showModelSelector)}
                  className="flex max-w-[11rem] items-center gap-1 rounded-md px-1.5 py-1 text-xs
                             text-gray-500 hover:bg-gray-100 hover:text-gray-700
                             disabled:hover:bg-transparent
                             dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  disabled={!canChangeModel}
                  title={
                    !canChangeModel && effectiveConfig.mode === 'byok'
                      ? 'Model is set by your organization admin'
                      : undefined
                  }
                >
                  <div className={clsx(
                    'h-2.5 w-2.5 shrink-0 rounded-sm bg-gradient-to-br',
                    currentProviderInfo?.color || 'from-gray-400 to-gray-600'
                  )} />
                  <span className="truncate font-medium">{currentModelInfo?.name || currentModel}</span>
                  {canChangeModel && <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />}
                </button>

            {/* Model Selector Dropdown */}
            {showModelSelector && canChangeModel && (
              <div className="absolute bottom-full left-0 mb-2 w-72 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
                {/* Only show models for the org's configured provider — if
                    Anthropic is the BYOK key, an Opus pick is fine but a
                    GPT-4o pick would 401. Today's schema supports one
                    provider per org; if/when we move to multi-provider
                    keys, expand this list to the org's enabled providers. */}
                {(() => {
                  const provider = AI_PROVIDERS.find(p => p.id === currentProvider)
                  if (!provider) return null
                  const models = AI_MODELS[provider.id] || []
                  return (
                    <div>
                      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center space-x-2">
                          <div className={clsx('w-4 h-4 rounded bg-gradient-to-br', provider.color)} />
                          <span className="font-medium text-gray-900 dark:text-white text-sm">{provider.name}</span>
                        </div>
                      </div>
                      <div className="py-1">
                        {models.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-gray-400 italic">No models configured.</div>
                        ) : models.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => handleModelChange(model.id)}
                            className={clsx(
                              'w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                              currentModel === model.id && 'bg-primary-50 dark:bg-primary-900/20'
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className={clsx(
                                'text-sm',
                                currentModel === model.id ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-300'
                              )}>
                                {model.name}
                              </span>
                              {model.recommended && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">
                                  Best
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{model.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
              <button
                onClick={onOpenSettings}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs
                           text-gray-500 hover:bg-gray-100 hover:text-primary-600
                           dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-400"
              >
                <Settings className="h-3 w-3" aria-hidden="true" />
                <span>Settings</span>
              </button>
            </>
          }
        >
          {/*
            What this conversation may use, and the control that adds to it.

            Unlike the chip row above the thread, this one WRITES: it changes
            `ai_conversation_tags`, which is the canonical input `ai-chat`
            reads to build its document blocks. Attached, inherited and
            merely mentioned are three different things and only the first
            two are drawn — see the component's own note.

            Inside the composer, because an attachment is part of the
            question being asked. It used to float above the box in a band
            of its own.
          */}
          {/*
            Rendered from `context.objects`, not from `tags` directly.

            Same data — `activeContext` has no other input for them — but
            routing it through the module makes that structurally true rather
            than a convention, and the row inherits its de-duplication: a
            reader who attached the asset the entry point had already seeded
            used to get two chips for one object, each with its own remove
            button, so removing either left the other looking like a failure.
          */}
          <AiContextAttach
            attached={context.objects.map(o => o.tag)}
            inheritedKeys={context.objects.filter(o => o.origin === 'inherited').map(o => o.key)}
            labels={tagLabels}
            onAttach={addTag}
            onDetach={removeTag}
            onOpenObject={openTaggedObject}
            referenceStatus={referenceStatus}
            retrieval={retrieval}
            /* Clears the state AND deletes the rows the edge function reads,
               so the next request is genuinely different. */
            onClearAll={clearContext}
            className="w-full"
          />
          <p data-testid="ai-context-summary" className="sr-only">{contextSummary}</p>
        </AiComposer>
        </div> {/* reading column */}
      </div>
      </div> {/* main pane */}

      {/*
        Keeping an answer as an artifact.

        This was a confirmation with a title the reader could not change, no
        sight of what was being kept, and nowhere to say what it was about --
        so the only way to find it again was to recognise, in a list, a
        sentence a model had written. It is a form now: the name, a preview,
        the research object, and optionally a project.

        The sentence inside still says what an artifact is NOT, because that
        is the thing a reader has to understand: it is a pointer to an answer
        they wanted again, readable only by them, and not firm-approved
        research.

        Still gated. `artifacts.available` is false in every environment
        because the table does not exist, so the Keep menu's artifact row is
        absent and nothing opens this.
      */}
      <AiArtifactSave
        open={!!keeping}
        content={keeping?.content ?? ''}
        draft={keeping?.draft ?? EMPTY_ARTIFACT_DRAFT}
        onChange={draft => setKeeping(k => (k ? { ...k, draft } : k))}
        onCancel={() => setKeeping(null)}
        onSave={confirmKeepArtifact}
        folders={folders}
        subjectResults={artifactSubjectResults}
        onSubjectQueryChange={setArtifactSubjectQuery}
        error={artifacts.lastError}
      />
    </div>
  )
}

