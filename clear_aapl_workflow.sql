-- Clear AAPL's workflow_id
UPDATE assets 
SET workflow_id = NULL 
WHERE symbol = 'AAPL';

-- Also check and archive the Old Research workflow if it's not already
UPDATE workflows 
SET archived = true 
WHERE id = '6a443d52-919c-40a5-87ca-2e4e146c6e67' 
AND archived = false;

-- Show the results
SELECT symbol, workflow_id FROM assets WHERE symbol = 'AAPL';
SELECT id, name, status, archived FROM workflows WHERE id = '6a443d52-919c-40a5-87ca-2e4e146c6e67';
