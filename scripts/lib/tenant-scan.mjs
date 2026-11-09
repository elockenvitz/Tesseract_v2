/**
 * Frontend tenant-boundary scanner.
 *
 * Finds reads of organization-owned tables that do not carry an organization
 * filter, so that each one is a decision somebody made rather than something
 * that drifted in. It does NOT decide whether a finding is an exposure: that
 * is what the reviewed allowlist in `tenant-allowlist.mjs` records, with the
 * database policy that actually enforces the boundary.
 *
 * ── Why this parses instead of matching text ──────────────────────────────
 *
 * The previous scanner was a set of regexes over the raw file, and it was
 * wrong in both directions. Measured against this codebase:
 *
 *   * It only matched the literal identifier `supabase`, so moving a query
 *     into a function that takes its client as a parameter made the query
 *     invisible. That is not hypothetical: commit 75f3fcd7 moved
 *     `supabase.from('conversations')` into a seam where it is
 *     `client.from('conversations')`, and the reported P0 count fell from 30
 *     to 29 with the query completely unchanged.
 *   * It read a 400-character window after `.from(` to look for filters. A
 *     query whose select list is longer than that had its own filters pushed
 *     out of the window (`AssetTab.tsx:2337` selects 14 columns), and a short
 *     query sitting next to a filtered one could be satisfied by its
 *     NEIGHBOUR'S filter. False negatives and false positives from the same
 *     line of code.
 *   * `.eq('organization_id', x)` passed and `.in('organization_id', xs)`
 *     failed, so correct code was reported while the window problem let real
 *     gaps through.
 *
 * None of those are fixable by a better regex: each one needs to know where a
 * call chain begins and ends, which is a parse. The TypeScript compiler is
 * already a dependency of this repository, so this uses it — syntax only, no
 * type checker and no program construction, because a 1,600-file type-aware
 * pass would cost minutes and nothing here needs types.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It cannot know what the database enforces. A finding is a question, not an
 * accusation, and the answer lives in the allowlist beside the policy text.
 */
import ts from 'typescript'

/**
 * Tables that carry `organization_id` and are one organization's property.
 *
 * Sourced from the backend linter's categorization of tables with a direct
 * organization column.
 */
export const ORG_SCOPED_TABLES = new Set([
  // Hub tables
  'workflows',
  'projects',
  'themes',
  'conversations',
  'calendar_events',
  'calendar_deliverables',
  'allocation_periods',
  'target_date_funds',
  'topics',
  'captures',
  'custom_notebooks',
  'text_templates',

  // Org-admin tables
  'organization_memberships',
  'organization_invites',
  'organization_audit_log',
  'organization_contacts',
  'teams',
  'org_chart_nodes',

  // Org-scoped config tables
  'coverage_settings',
  'research_fields',
  'research_sections',
  'rating_scales',
  'user_role_definitions',
  'asset_page_templates',
  'investment_case_templates',
  'model_templates',
  'removal_requests',
  'access_requests',
  'coverage_roles',
  'project_collections',
  'project_tags',
  'template_tags',

  // Trade / allocation
  'trade_ideas',
])

/**
 * The highest-risk subset: user-facing hub tables holding the actual research
 * and planning work, where a cross-organization read would be a disclosure of
 * investment thinking rather than of configuration.
 */
export const P0_TABLES = new Set([
  'workflows',
  'projects',
  'themes',
  'conversations',
  'calendar_events',
  'topics',
  'captures',
])

/**
 * Tables deliberately NOT organization-scoped, with the reason.
 *
 * CLAUDE.md Standing Rule 5 makes a table with no org column by design an
 * explicit exception that "must be documented as such". Without this, the
 * documentation is the ABSENCE of the table from ORG_SCOPED_TABLES, which is
 * indistinguishable from an oversight.
 *
 * Listing one here is a claim, not a waiver: the key must carry a reason, and
 * the table must not also appear in ORG_SCOPED_TABLES. The runner's
 * `registryProblems()` enforces both.
 */
export const NOT_ORG_SCOPED_BY_DESIGN = {
  asset_lists:
    'Personal/shared lists, not org property. 64 of 66 rows have a NULL ' +
    'organization_id and no policy references the column; access is ' +
    'created_by + asset_list_collaborations. Verified 2026-10-27: 0 ' +
    'cross-org collaborations, anon sees nothing (every branch tests ' +
    'auth.uid()). If lists are ever made org-owned, the scoping has to be ' +
    'ADDED — it does not already exist.',
  asset_list_items:
    'Rows of an asset_lists list; inherits that table\'s posture. Own-row ' +
    'authorization is enforced by migration 20261027002812.',
  asset_list_collaborations:
    'The sharing grant for an asset_lists list. Scoped to the list and the ' +
    'reader (user_id = auth.uid()), which is narrower than an org term.',
  workflow_collaborations:
    'The sharing grant for a workflow, not org property. Its SELECT policy ' +
    'is user_id = auth.uid() OR invited_by = auth.uid() OR a workflow the ' +
    'caller created, which is narrower than an organization term. The ' +
    'workflow it points at is org-scoped and is listed above.',
}

/** Views whose own definition carries the organization term. */
export const ORG_SCOPED_VIEWS = new Set([
  'organization_members_v',
  'org_workflows_v',
  'org_themes_v',
  'org_calendar_events_v',
  'org_topics_v',
  'org_captures_v',
  'org_projects_v',
  'org_org_chart_nodes_v',
])

/**
 * Receivers that own a `.from()` of their own and are not a database client.
 *
 * Checked by identifier rather than by argument type so that the scanner can
 * stay identifier-agnostic about the client itself: anything else calling
 * `.from('<an org-scoped table name>')` is a query, whatever the variable is
 * called.
 */
const NON_CLIENT_RECEIVERS = new Set([
  'Array', 'Object', 'Buffer', 'Date', 'Set', 'Map', 'WeakMap', 'WeakSet',
  'Promise', 'JSON', 'Number', 'String', 'Int8Array', 'Uint8Array',
  'Float32Array', 'Float64Array', 'BigInt64Array',
])

/** Methods that make the statement a write. */
const MUTATION_METHODS = new Set(['insert', 'update', 'upsert', 'delete'])

/** Methods whose first argument names a column. */
const FILTER_METHODS = new Set([
  'eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is',
  'contains', 'containedBy', 'overlaps', 'match',
])

/**
 * Columns that bound a row to one record rather than to an organization.
 *
 * A filter on one of these is NOT proof of tenant isolation, which is the
 * whole reason they are separated from the organization filter: knowing a
 * UUID is not an authorization, and the previous scanner treated it as one.
 * Whether the row is safe depends on the policy on the table, so these become
 * `pk-filtered` or `fk-filtered` findings and have to be answered in the
 * allowlist with the policy that does the enforcing.
 */
const PK_COLUMNS = new Set(['id'])

const FK_COLUMNS = new Set([
  'workflow_id', 'team_id', 'project_id', 'conversation_id', 'theme_id',
  'portfolio_id', 'node_id', 'asset_id', 'template_id', 'parent_workflow_id',
  'context_id', 'created_by', 'user_id', 'requester_id', 'assigned_to',
])

export const ORG_COLUMN = 'organization_id'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parse(fileName, text) {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

const literalText = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null

/**
 * A template literal's static parts, for `.or(\`created_by.eq.${id}\`)`.
 *
 * The interpolated values are not knowable here, but the column names around
 * them are, and the column names are what classification turns on.
 */
function staticText(node) {
  if (!node) return null
  const direct = literalText(node)
  if (direct !== null) return direct
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => s.literal.text).join(' ')
  }
  return null
}

/** Every method call applied to the result of `fromCall`, in chain order. */
function chainCalls(fromCall) {
  const calls = []
  let node = fromCall
  while (
    node.parent &&
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node &&
    node.parent.parent &&
    ts.isCallExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent
  ) {
    const call = node.parent.parent
    calls.push({ name: node.parent.name.text, args: call.arguments })
    node = call
  }
  return { calls, tail: node }
}

const enclosingBody = (node) => {
  let n = node.parent
  while (n) {
    if (
      ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isSourceFile(n)
    ) return n
    n = n.parent
  }
  return null
}

/**
 * Method calls made on a query that was parked in a variable first.
 *
 * `let q = supabase.from('workflows'); if (x) q = q.eq('organization_id', o)`
 * is one query in two statements, and a scanner that only follows the fluent
 * chain sees the first half and reports a filter that is right there. This
 * collects `q.<method>(...)` across the enclosing function so the classifier
 * sees the whole query. It is intentionally not flow-sensitive: a filter
 * applied on only one branch still counts, because the question being asked
 * is whether the author thought about tenancy here at all.
 */
function deferredCalls(tail) {
  let name = null
  if (ts.isVariableDeclaration(tail.parent) && ts.isIdentifier(tail.parent.name)) {
    name = tail.parent.name.text
  } else if (
    ts.isBinaryExpression(tail.parent) &&
    tail.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(tail.parent.left)
  ) {
    name = tail.parent.left.text
  }
  if (!name) return []

  const body = enclosingBody(tail)
  if (!body) return []

  const found = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === name
    ) {
      found.push({ name: node.expression.name.text, args: node.arguments })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(body, visit)
  return found
}

/**
 * Embedded tables named in a PostgREST select string.
 *
 * `select('*, project_assignments!inner(assigned_to)')` reads a second table
 * that the base-table check never sees. Matches `name(`, with an optional
 * `alias:` prefix and an optional `!inner` / `!left` hint.
 */
const EMBED_REGEX = /(?:([A-Za-z_][\w]*)\s*:\s*)?([A-Za-z_][\w]*)\s*(?:!\s*\w+\s*)?\(/g

export function embeddedTables(selectText) {
  if (!selectText) return []
  const out = []
  EMBED_REGEX.lastIndex = 0
  let m
  while ((m = EMBED_REGEX.exec(selectText)) !== null) {
    out.push(m[2])
  }
  return out
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * How a query is bounded, from its methods alone.
 *
 * Returns one of:
 *   mutation      a write; the WITH CHECK clause is what bounds it
 *   org-filtered  eq or in on organization_id
 *   pk-filtered   eq or in on a primary key, and nothing about the org
 *   fk-filtered   eq or in on a foreign key, and nothing about the org
 *   unscoped      nothing that could bound tenancy
 */
export function classifyChain(calls) {
  let sawPk = false
  let sawFk = false

  for (const { name, args } of calls) {
    if (MUTATION_METHODS.has(name)) return 'mutation'

    if (FILTER_METHODS.has(name)) {
      const column = literalText(args[0])
      if (column === ORG_COLUMN) return 'org-filtered'
      if (column && PK_COLUMNS.has(column)) sawPk = true
      else if (column && FK_COLUMNS.has(column)) sawFk = true
      /* An embedded column such as `project_assignments.assigned_to` bounds
         the read to rows the caller is attached to, not to an organization. */
      if (column && column.includes('.')) sawFk = true
    }

    /*
     * `.or()` is a disjunction, so a term mentioning organization_id does NOT
     * scope the query: `organization_id.eq.X,is_public.eq.true` returns every
     * public row in every organization. It is therefore never treated as an
     * org filter, only as evidence that some column was considered.
     */
    if (name === 'or') {
      const text = staticText(args[0]) || ''
      for (const part of text.split(',')) {
        const column = part.split('.')[0].trim()
        if (PK_COLUMNS.has(column)) sawPk = true
        else if (FK_COLUMNS.has(column)) sawFk = true
      }
    }
  }

  if (sawPk) return 'pk-filtered'
  if (sawFk) return 'fk-filtered'
  return 'unscoped'
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Findings for one file.
 *
 * `relPath` is used verbatim in the finding, so callers should pass a
 * repository-relative, forward-slashed path — that string is the allowlist key.
 */
export function scanSource(relPath, text) {
  const findings = []
  const rpcs = []
  let source
  try {
    source = parse(relPath, text)
  } catch (err) {
    return {
      findings: [{
        file: relPath, line: 1, table: null, kind: 'parse-error',
        detail: String(err && err.message ? err.message : err),
      }],
      rpcs,
    }
  }

  /*
   * `createSourceFile` is error-tolerant: it does not throw on malformed
   * input, it records the syntax errors and returns whatever tree it could
   * build. So the try/catch above almost never fires, and without this check
   * a file the scanner cannot read would come back with zero findings and be
   * counted as clean -- a gate anyone could switch off for a file by writing
   * something it does not understand. Found by the scanner's own test.
   *
   * `parseDiagnostics` is not in the public typings. It is read defensively
   * so that a TypeScript upgrade moving it cannot silently restore the hole:
   * if it ever goes missing, that is itself reported.
   */
  const diagnostics = source.parseDiagnostics
  if (!Array.isArray(diagnostics)) {
    return {
      findings: [{
        file: relPath, line: 1, table: null, kind: 'parse-error',
        detail:
          'SourceFile.parseDiagnostics is missing, so syntax errors cannot ' +
          'be detected and this file cannot be certified as scanned',
      }],
      rpcs,
    }
  }
  if (diagnostics.length > 0) {
    const first = diagnostics[0]
    return {
      findings: [{
        file: relPath, line: 1, table: null, kind: 'parse-error',
        detail: ts.flattenDiagnosticMessageText(first.messageText, ' '),
      }],
      rpcs,
    }
  }

  const lineOf = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = node.expression.expression

      if (method === 'rpc') {
        const name = literalText(node.arguments[0])
        if (name) rpcs.push({ file: relPath, line: lineOf(node), name })
      }

      if (method === 'from') {
        const table = literalText(node.arguments[0])
        const receiverName = ts.isIdentifier(receiver) ? receiver.text : null
        const isClient = !receiverName || !NON_CLIENT_RECEIVERS.has(receiverName)

        if (table && isClient) {
          const { calls, tail } = chainCalls(node)
          const all = [...calls, ...deferredCalls(tail)]
          const kind = classifyChain(all)
          const line = lineOf(node)

          const selectCall = all.find((c) => c.name === 'select')
          const selectText = selectCall ? staticText(selectCall.args[0]) : null

          const interesting =
            ORG_SCOPED_TABLES.has(table) && !ORG_SCOPED_VIEWS.has(table)

          if (interesting && kind !== 'mutation' && kind !== 'org-filtered') {
            findings.push({ file: relPath, line, table, kind })
          }

          /*
           * Embeds are checked on EVERY chain, not only org-scoped bases: a
           * read of a non-org table can still pull an org-owned table in
           * through a join, and the base-table rule would never see it.
           */
          for (const embedded of embeddedTables(selectText)) {
            if (embedded === table) continue
            if (!ORG_SCOPED_TABLES.has(embedded)) continue
            if (ORG_SCOPED_VIEWS.has(embedded)) continue
            if (kind === 'mutation') continue
            findings.push({
              file: relPath, line, table: embedded, kind: 'embed',
              via: table,
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(source, visit)
  return { findings, rpcs }
}

/** Severity for a finding's table. */
export const severityOf = (finding) =>
  finding.table && P0_TABLES.has(finding.table) ? 'P0' : 'P1'

/** The allowlist key: stable under reformatting, unlike a line number. */
export const siteKey = (finding) =>
  `${finding.file}::${finding.table}::${finding.kind}`
