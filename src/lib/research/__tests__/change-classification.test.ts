/**
 * Content-vs-metadata classification.
 *
 * These run WITHOUT the `content_updated_at` migration — the classifier is
 * pure, and its job is to be correct before anything depends on it.
 *
 * The negative cases are the point: a gate that only proves `content` is
 * reported for real edits has not shown it REFUSES to report one for a
 * visibility flip, which is the defect being fixed.
 */

import { describe, it, expect } from 'vitest'
import {
  classifyContributionChange,
  isSubstantiveChange,
  normalizeProse,
} from '../change-classification'

describe('normalizeProse', () => {
  it('flattens markup and whitespace without altering wording', () => {
    expect(normalizeProse('<p>Margins  expand</p>')).toBe('Margins expand')
    expect(normalizeProse('<p>Margins expand</p>\n')).toBe(normalizeProse('<div>Margins expand</div>'))
  })

  it('treats nbsp as whitespace', () => {
    expect(normalizeProse('a&nbsp;b')).toBe('a b')
  })

  it('does NOT normalise away wording, casing or punctuation', () => {
    expect(normalizeProse('Margins expand.')).not.toBe(normalizeProse('Margins expand'))
    expect(normalizeProse('margins expand')).not.toBe(normalizeProse('Margins expand'))
  })
})

describe('classifyContributionChange — content', () => {
  it('reports an edited thesis', () => {
    expect(classifyContributionChange({
      oldContent: '<p>Margins expand on mix.</p>',
      newContent: '<p>Margins expand on mix and price.</p>',
    })).toBe('content')
  })

  it('reports first publication', () => {
    expect(classifyContributionChange({ oldContent: null, newContent: '<p>New thesis.</p>' })).toBe('content')
    expect(classifyContributionChange({ oldContent: '', newContent: '<p>New thesis.</p>' })).toBe('content')
  })

  it('reports a retraction — prose removed is an edit to the case', () => {
    expect(classifyContributionChange({ oldContent: '<p>Thesis.</p>', newContent: '' })).toBe('content')
  })

  it('reports a one-word edit (it does not judge importance)', () => {
    expect(classifyContributionChange({
      oldContent: 'Underweight on valuation',
      newContent: 'Overweight on valuation',
    })).toBe('content')
  })
})

describe('classifyContributionChange — metadata', () => {
  it('refuses to report a content change when the prose is unchanged', () => {
    const prose = '<p>Margins expand on mix.</p>'
    expect(classifyContributionChange({ oldContent: prose, newContent: prose })).toBe('metadata')
    expect(isSubstantiveChange({ oldContent: prose, newContent: prose })).toBe(false)
  })

  it('refuses to report a re-serialisation of identical prose', () => {
    expect(classifyContributionChange({
      oldContent: '<p>Margins expand on mix.</p>',
      newContent: '<div>Margins  expand on mix.</div>\n',
    })).toBe('metadata')
  })

  it('refuses to report a touched-but-empty row', () => {
    expect(classifyContributionChange({ oldContent: '', newContent: '' })).toBe('metadata')
    expect(classifyContributionChange({ oldContent: null, newContent: null })).toBe('metadata')
    expect(classifyContributionChange({ oldContent: '<p></p>', newContent: '<p><br></p>' })).toBe('metadata')
  })
})

describe('classifyContributionChange — ambiguous', () => {
  /**
   * The envelope the production trigger writes. Its exact format is unread,
   * so it must not be compared as prose in either direction.
   */
  it('reports ambiguous for the observed attachment envelope, never content', () => {
    expect(classifyContributionChange({
      oldContent: '<p>Thesis.</p>',
      newContent: '[Attachments: 2 items]',
    })).toBe('ambiguous')

    expect(classifyContributionChange({
      oldContent: '[Attachments: 1 items]',
      newContent: '[Attachments: 2 items]',
    })).toBe('ambiguous')
  })

  it('does not count an ambiguous event as substantive', () => {
    expect(isSubstantiveChange({ oldContent: null, newContent: '[Attachments: 2 items]' })).toBe(false)
  })

  it('does not swallow real prose that merely mentions attachments', () => {
    expect(classifyContributionChange({
      oldContent: '<p>Thesis.</p>',
      newContent: '<p>See [Attachments: the 10-K] for the build.</p>',
    })).toBe('content')
  })
})
