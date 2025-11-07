/*
  # Remove Default Workflow Concept

  Remove the concept of "default" workflows by setting all is_default flags to false.
  This migration maintains the field for backward compatibility but removes its functional use.
*/

-- Set all workflows to non-default
UPDATE workflows SET is_default = false WHERE is_default = true;
