/*
  # Add Rescinded Status to Coverage Requests

  Updates the status check constraint on coverage_requests table to allow 'rescinded' status,
  which is used when users cancel their own pending coverage change requests.
*/

-- Drop the existing check constraint
ALTER TABLE coverage_requests
  DROP CONSTRAINT coverage_requests_status_check;

-- Add the new check constraint with 'rescinded' included
ALTER TABLE coverage_requests
  ADD CONSTRAINT coverage_requests_status_check
  CHECK (status IN ('pending', 'approved', 'denied', 'rescinded'));
