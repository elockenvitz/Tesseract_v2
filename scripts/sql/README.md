# scripts/sql

Ad-hoc SQL scripts used for one-off operational tasks (debugging,
spot-fixes, data inspection). **Not** part of the versioned migration
chain — see `supabase/migrations/` for schema changes that ship.

Convention: anything that mutates production data should be reviewed
the same way a migration is, and ideally rewritten as a proper
migration with a timestamp.
