/**
 * Keep telling someone, every time, until it is fixed.
 *
 * ── The defect this replaces ─────────────────────────────────────────────
 *
 * `ingest.yml`'s notifier read:
 *
 *   if (existing.data.length === 0) {
 *     await github.rest.issues.create({ ... })
 *   }
 *
 * The intent was "do not open a hundred duplicate issues". The effect was
 * that after the FIRST failure opened an issue, every later failure did
 * nothing at all. Issue #248 was opened on 2026-10-06 and then 24 further
 * nightly failures passed in complete silence, which is how a market-data
 * outage ran for 35 days inside a product whose prices were visibly wrong.
 *
 * The bug is not the dedupe. It is that dedupe was applied to the
 * NOTIFICATION rather than to the issue. One issue is right; one notification
 * is not.
 *
 * ── What this does instead ───────────────────────────────────────────────
 *
 * One open issue per subject, and a comment on it for every subsequent
 * failure. A comment sends a notification to everyone subscribed to the
 * issue, so the signal repeats without the issue list filling up. The comment
 * carries the run link and the consecutive-failure count, because "it failed
 * again" and "it has failed every night for five weeks" call for different
 * responses and the issue should not require arithmetic to tell them apart.
 *
 * If the issue was closed while the job is still failing, it is REOPENED.
 * Closing an issue is a claim that the thing is fixed; the next failure is
 * evidence it is not, and silently leaving it closed would recreate the
 * original defect in a new place.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * No throttling, no exponential backoff, no "only alert once a week". Every
 * one of those is a dedupe on the notification, which is the bug. These jobs
 * run at most once a weekday, so the worst case is five comments a week on
 * one issue -- cheap, and exactly proportional to the problem.
 */

/**
 * @param {object} args
 * @param {object} args.github   the authenticated Octokit from github-script
 * @param {object} args.context  the github-script context
 * @param {string} args.subject  the issue title, stable across failures
 * @param {string} args.label    the label used to find the existing issue
 * @param {string[]} args.detail lines of body text explaining this failure
 */
module.exports = async function alertOnFailure({ github, context, subject, label, detail }) {
  const owner = context.repo.owner
  const repo = context.repo.repo
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`
  const when = new Date().toISOString()

  /*
   * Search open AND closed, newest first.
   *
   * Open-only is what let a closed-but-unfixed issue become a second silent
   * channel: the notifier would see no open issue, create a new one, and the
   * history of the outage would be split across two.
   */
  const found = await github.rest.issues.listForRepo({
    owner, repo, labels: label, state: 'all', sort: 'created', direction: 'desc', per_page: 20,
  })
  const issue = found.data.find((i) => i.title === subject) ?? found.data[0]

  const lines = [
    `**${subject}** at ${when}.`,
    '',
    ...detail,
    '',
    `Run: ${runUrl}`,
  ]

  if (!issue) {
    const created = await github.rest.issues.create({
      owner, repo, title: subject, body: lines.join('\n'), labels: [label],
    })
    console.log(`opened issue #${created.data.number}`)
    return { action: 'opened', number: created.data.number }
  }

  if (issue.state === 'closed') {
    await github.rest.issues.update({ owner, repo, issue_number: issue.number, state: 'open' })
    console.log(`reopened issue #${issue.number}`)
  }

  /*
   * Count how many times this has already been reported, so the comment can
   * say "the 26th consecutive failure" rather than "it failed". Comments are
   * the record because the issue body is only written once.
   */
  let priorReports = 1
  try {
    const comments = await github.rest.issues.listComments({
      owner, repo, issue_number: issue.number, per_page: 100,
    })
    priorReports += comments.data.filter((c) => c.body?.includes('Run: ')).length
  } catch (e) {
    console.log(`could not count prior reports: ${e.message}`)
  }

  await github.rest.issues.createComment({
    owner, repo, issue_number: issue.number,
    body: [
      `Still failing. Report ${priorReports + 1} on this issue.`,
      '',
      ...lines,
    ].join('\n'),
  })
  console.log(`commented on issue #${issue.number} (report ${priorReports + 1})`)
  return { action: 'commented', number: issue.number, report: priorReports + 1 }
}
