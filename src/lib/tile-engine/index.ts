/**
 * The tile engine, in the order the pipeline runs.
 *
 *     facts / events
 *       → semantic findings          finding.ts, builders.ts
 *       → situations                 situation.ts
 *       → importance                 importance.ts  (delegates to feed-priority)
 *       → presentation plan          presentation.ts, resolver.ts
 *       → shared visual primitives   PRIMITIVE_COMPONENTS
 *       → actions                    ActionIntent, PlanActions
 *
 * Nothing in this directory imports React, Supabase or a clock. That is what
 * lets the gallery, the tests and both shells consume it directly — the lesson
 * the priority module records in its own header, applied up front.
 */

export * from './facts'
export * from './finding'
export * from './situation'
export * from './situations'
export * from './builders'
export * from './importance'
export * from './presentation'
export * from './resolver'
