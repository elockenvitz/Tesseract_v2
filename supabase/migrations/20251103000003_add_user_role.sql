/*
  # Add User Role

  Add user_role field to users table to distinguish between different user types.
  Roles: investor, operations, support, compliance
  Default to 'investor' for existing users.
*/

-- Add user_role column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_role TEXT DEFAULT 'investor' CHECK (user_role IN ('investor', 'operations', 'support', 'compliance'));

-- Set default role for existing users
UPDATE users SET user_role = 'investor' WHERE user_role IS NULL;
