-- Reconstructed locally to match remote-applied migration. Original applied 2026-03-14.
-- Enriches existing decision_request submission_snapshot JSONB with requester details
-- and portfolio name for display purposes.

UPDATE decision_requests dr
SET submission_snapshot = dr.submission_snapshot
  || jsonb_build_object(
    'requester_name', COALESCE(u.full_name, u.email),
    'requester_email', u.email,
    'submitted_at', dr.created_at,
    'portfolio_name', p.name
  )
FROM users u, portfolios p
WHERE dr.requested_by = u.id
  AND dr.portfolio_id = p.id
  AND dr.submission_snapshot IS NOT NULL;
