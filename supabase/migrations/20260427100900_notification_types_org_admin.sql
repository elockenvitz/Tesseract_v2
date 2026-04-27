-- Notification types for org admin actions affecting users.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'org_membership_added';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'org_membership_status';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'org_role_changed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coverage_admin_changed';
