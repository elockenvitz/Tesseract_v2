/*
  # Set Coverage Admins

  Sets eric lockenvitz and john homler as coverage admins
*/

-- Update users to set coverage_admin flag
UPDATE users
SET coverage_admin = true
WHERE email IN ('elockenvitz@gmail.com', 'jlhomler@gmail.com');

-- Also set coverage_admin to false for all other users to be explicit
UPDATE users
SET coverage_admin = false
WHERE email NOT IN ('elockenvitz@gmail.com', 'jlhomler@gmail.com');
