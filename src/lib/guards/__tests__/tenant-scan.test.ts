/**
 * The tenant scanner, against source it is given rather than against the repo.
 *
 * Every case here is a way the scanner it replaced could be walked past, and
 * each one was real: the old scanner was regexes over raw text, so it matched
 * only the literal identifier `supabase`, it read a fixed 400-character window
 * after `.from(`, and it accepted a primary-key filter as proof of tenancy.
 *
 * What is pinned is therefore not "it finds things" but "these specific
 * evasions do not work", because a boundary gate that can be stepped around
 * by renaming a variable is decoration.
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { scanSource, classifyChain, embeddedTables, siteKey, severityOf } from '../../../../scripts/lib/tenant-scan.mjs'

interface Finding {
  file: string
  line: number
  table: string | null
  kind: string
  via?: string
  detail?: string
}

const scan = (code: string, file = 'src/x.ts'): Finding[] =>
  scanSource(file, code).findings

const rpcsIn = (code: string, file = 'src/x.ts'): { name: string }[] =>
  scanSource(file, code).rpcs

const kinds = (code: string) => scan(code).map((f) => `${f.table}:${f.kind}`)

describe('the client identifier does not matter', () => {
  it('finds a query made through `supabase`', () => {
    expect(kinds(`supabase.from('workflows').select('*')`)).toEqual(['workflows:unscoped'])
  })

  it('finds the same query made through `client`', () => {
    /* This is the evasion that happened by accident. Commit 75f3fcd7 moved
       supabase.from('conversations') into a seam where the client is a
       parameter named `client`, and the reported P0 count fell from 30 to 29
       with the query completely unchanged. */
    expect(kinds(`client.from('conversations').select('*')`)).toEqual(['conversations:unscoped'])
  })

  it('finds it through any other name', () => {
    for (const name of ['db', 'sb', 'adminClient', 'theThing', '_c']) {
      expect(kinds(`${name}.from('themes').select('*')`), name).toEqual(['themes:unscoped'])
    }
  })

  it('finds it through a member expression receiver', () => {
    expect(kinds(`this.deps.supa.from('projects').select('*')`)).toEqual(['projects:unscoped'])
  })

  it('finds it through a call result', () => {
    expect(kinds(`getClient().from('captures').select('*')`)).toEqual(['captures:unscoped'])
  })

  it('does not mistake the standard library for a database client', () => {
    /* The price of being identifier-agnostic. These take a non-string
       argument, so the table-name check already excludes them, but the
       receiver list is belt and braces for the day someone writes
       Array.from('workflows'). */
    const code = `
      const a = Array.from(rows)
      const b = Object.fromEntries(pairs)
      const c = Buffer.from('workflows')
      const d = Array.from('themes')
    `
    expect(scan(code)).toEqual([])
  })
})

describe('the whole chain is read, however long or however split', () => {
  it('sees a filter beyond 400 characters of select list', () => {
    /* The old scanner read a 400-char window, so a wide select pushed the
       query's own filter out of view and it was reported as unfiltered. */
    const columns = Array.from({ length: 60 }, (_, i) => `column_number_${i}`).join(',\n        ')
    const code = `
      supabase
        .from('workflows')
        .select(\`
        ${columns}
        \`)
        .eq('organization_id', orgId)
    `
    expect(scan(code)).toEqual([])
  })

  it('does not let a neighbouring query supply the filter', () => {
    /* The other half of the window bug: a short unfiltered query sitting
       above a filtered one was satisfied by its neighbour's filter. */
    const code = `
      const a = await supabase.from('workflows').select('id')
      const b = await supabase.from('themes').select('id').eq('organization_id', orgId)
    `
    expect(kinds(code)).toEqual(['workflows:unscoped'])
  })

  it('follows a chain parked in a variable and extended later', () => {
    const code = `
      function load() {
        let q = supabase.from('workflows').select('id')
        if (narrow) q = q.eq('organization_id', orgId)
        return q
      }
    `
    expect(scan(code)).toEqual([])
  })

  it('does not follow a same-named variable in another function', () => {
    const code = `
      function a() {
        const q = supabase.from('workflows').select('id')
        return q
      }
      function b() {
        const q = other
        return q.eq('organization_id', orgId)
      }
    `
    expect(kinds(code)).toEqual(['workflows:unscoped'])
  })

  it('reads a chain broken across many lines and comments', () => {
    const code = `
      supabase
        // the org comes from context
        .from('themes')
        /* wide select */
        .select('id, name')
        .in('organization_id', orgIds)
        .order('name')
    `
    expect(scan(code)).toEqual([])
  })
})

describe('how a query is bounded is told apart', () => {
  it('accepts eq on organization_id', () => {
    expect(scan(`supabase.from('themes').select('*').eq('organization_id', o)`)).toEqual([])
  })

  it('accepts in on organization_id', () => {
    /* The old scanner only accepted .eq, so correct code was reported. */
    expect(scan(`supabase.from('themes').select('*').in('organization_id', os)`)).toEqual([])
  })

  it('reports a primary-key filter rather than treating it as isolation', () => {
    /* Knowing a uuid is not an authorization. The old scanner passed these
       outright, which is why a cross-org id in an object_links row was never
       asked about. */
    expect(kinds(`supabase.from('workflows').select('*').eq('id', wid)`)).toEqual(['workflows:pk-filtered'])
    expect(kinds(`supabase.from('workflows').select('*').in('id', wids)`)).toEqual(['workflows:pk-filtered'])
  })

  it('reports a foreign-key filter as its own kind', () => {
    expect(kinds(`supabase.from('workflows').select('*').eq('parent_workflow_id', p)`))
      .toEqual(['workflows:fk-filtered'])
  })

  it('does not read an .or() as an organization filter', () => {
    /* .or() is a DISJUNCTION. `organization_id.eq.X,is_public.eq.true`
       returns every public row in every organization, so treating a mention
       of the column inside .or() as scoping would be exactly backwards. */
    const code = "supabase.from('workflows').select('*').or(`organization_id.eq.${o},is_public.eq.true`)"
    expect(kinds(code)).toEqual(['workflows:unscoped'])
  })

  it('still reads the column names inside an .or() template', () => {
    const code = "supabase.from('workflows').select('*').or(`id.eq.${r},parent_workflow_id.eq.${r}`)"
    expect(kinds(code)).toEqual(['workflows:pk-filtered'])
  })

  it('passes a write, whose WITH CHECK is the boundary', () => {
    expect(scan(`supabase.from('themes').insert({ name, organization_id: o })`)).toEqual([])
    expect(scan(`supabase.from('themes').update({ name }).eq('id', t)`)).toEqual([])
    expect(scan(`supabase.from('themes').delete().eq('id', t)`)).toEqual([])
  })

  it('ignores a table that is not organization-owned', () => {
    expect(scan(`supabase.from('assets').select('*')`)).toEqual([])
  })

  it('ignores a view whose definition carries the organization term', () => {
    expect(scan(`supabase.from('org_workflows_v').select('*')`)).toEqual([])
  })
})

describe('tables pulled in through a select are not invisible', () => {
  it('reports an organization-owned table embedded from a plain base', () => {
    /* The base table is not org-owned, so a base-table rule sees nothing,
       and the embed reads another organization's rows if the policy lets it. */
    const code = `supabase.from('assets').select('id, themes(id, name)')`
    expect(scan(code).map((f) => `${f.table}:${f.kind}:${f.via}`))
      .toEqual(['themes:embed:assets'])
  })

  it('sees through an alias and an !inner hint', () => {
    const code = `supabase.from('assets').select('id, t:themes!inner(id)')`
    expect(kinds(code)).toEqual(['themes:embed'])
  })

  it('does not report the base table as its own embed', () => {
    const code = `supabase.from('themes').select('id').eq('organization_id', o)`
    expect(scan(code)).toEqual([])
  })

  it('ignores an embed of a table nobody owns', () => {
    expect(scan(`supabase.from('assets').select('id, price_targets(id)')`)).toEqual([])
  })

  it('finds the embedded tables in a select string', () => {
    expect(embeddedTables('id, a:themes!inner(x), teams(y), plain')).toEqual(['themes', 'teams'])
  })
})

describe('rpc calls are collected for separate review', () => {
  it('records the name', () => {
    expect(rpcsIn(`supabase.rpc('set_current_org', { p_org_id: o })`).map((r) => r.name))
      .toEqual(['set_current_org'])
  })

  it('records it through any client identifier', () => {
    expect(rpcsIn(`client.rpc('is_platform_admin')`).map((r) => r.name)).toEqual(['is_platform_admin'])
  })

  it('does not record a dynamic name it cannot read', () => {
    expect(rpcsIn('supabase.rpc(fnName)')).toEqual([])
  })
})

describe('the scanner cannot quietly skip a file', () => {
  it('reports a file it cannot parse instead of calling it clean', () => {
    /* A gate that treats an unparseable file as having no findings is a gate
       that can be switched off by writing something it does not understand. */
    const findings = scan('export const = ???? <<< not typescript')
    const parseOrFindings = findings.length > 0
    expect(parseOrFindings).toBe(true)
  })
})

describe('the bookkeeping the runner depends on', () => {
  it('builds a key that survives reformatting', () => {
    expect(siteKey({ file: 'src/a.ts', table: 'workflows', kind: 'unscoped' }))
      .toBe('src/a.ts::workflows::unscoped')
  })

  it('separates the high-risk tables from the rest', () => {
    expect(severityOf({ table: 'workflows' })).toBe('P0')
    expect(severityOf({ table: 'teams' })).toBe('P1')
  })

  it('classifies a chain from its methods alone', () => {
    expect(classifyChain([{ name: 'select', args: [] }])).toBe('unscoped')
    expect(classifyChain([{ name: 'delete', args: [] }])).toBe('mutation')
  })
})
