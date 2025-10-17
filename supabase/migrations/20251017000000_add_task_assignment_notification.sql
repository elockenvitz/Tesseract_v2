/*
  # Add Task Assignment Notification Type

  Add a new notification type for when users are assigned to tasks or stages.
*/

-- Add new notification type for task/stage assignments
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_assigned';
