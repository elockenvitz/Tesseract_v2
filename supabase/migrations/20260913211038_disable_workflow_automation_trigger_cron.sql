-- Pause the workflow-automation-trigger cron job.
--
-- Its command calls extensions.http_post / extensions.http_header, which belong
-- to the pgsql-http extension. Only pg_net is installed, so every run since the
-- job was created (2025-12-12) has failed before sending a request: it has
-- never invoked the workflow-automation edge function. Pausing it removes the
-- failure every five minutes and changes no behaviour.
--
-- It is paused rather than repointed at net.http_post because the edge
-- function also calls execute_due_automation_rules, which the
-- execute-workflow-automation-rules job already runs every minute with no
-- lock, so a working trigger could create the same branch twice. The job
-- definition is kept so it can be reviewed before it is re-enabled.
--
-- Matched by name, not jobid, and skipped where pg_cron or the job is absent.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'workflow-automation-trigger';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_jobid, active := false);
  END IF;
END $$;
