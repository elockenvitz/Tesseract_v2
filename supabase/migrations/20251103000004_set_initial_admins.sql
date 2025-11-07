/*
  # Set Initial Coverage Admins

  Set Eric Lockenvitz and John Homler as coverage admins.
*/

-- Set coverage_admin for Eric Lockenvitz and John Homler
UPDATE users
SET coverage_admin = true
WHERE email IN ('elockenvitz@gmail.com', 'john.homler@gmail.com');
