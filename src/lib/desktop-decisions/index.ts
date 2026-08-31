/**
 * Desktop Decisions — the memory layer.
 *
 * A decision is (idea, portfolio, human outcome). Everything here is read from
 * `decision_requests`, which is the only place the actor, the timestamp and the
 * outcome are actually durable.
 */

export type { DecisionRecord, DecisionStatus, OutcomeKind, Provenance, Provable } from './model'
export {
  RESOLVED, OUTCOME_LABEL, NOT_RECORDED_AT_DECISION,
  outcomeOf, statusDetail, provenanceOf, reasonLabel, provable,
  headline, summaryOf, compareDecisions, daysSince,
  issueFor, seedPromptFor, targetFor,
} from './model'
