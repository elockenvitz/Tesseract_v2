export type ProjectStatus = 'planning' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ProjectAssignmentRole = 'owner' | 'contributor' | 'reviewer'
export type ProjectContextType = 'asset' | 'portfolio' | 'theme' | 'workflow' | 'general'

export interface Project {
  id: string
  title: string
  description: string | null
  created_by: string | null
  status: ProjectStatus
  priority: ProjectPriority
  due_date: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  context_type: ProjectContextType | null
  context_id: string | null
}

export interface ProjectAssignment {
  id: string
  project_id: string
  assigned_to: string
  assigned_by: string | null
  role: ProjectAssignmentRole
  assigned_at: string
}

export interface ProjectDeliverable {
  id: string
  project_id: string
  title: string
  description: string | null
  completed: boolean
  completed_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  display_order: number
}

export interface ProjectComment {
  id: string
  project_id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
}

export interface ProjectAttachment {
  id: string
  project_id: string
  file_name: string
  file_path: string
  file_size: number | null
  content_type: string | null
  uploaded_by: string | null
  uploaded_at: string
}

// Extended types with relationships
export interface ProjectWithAssignments extends Project {
  project_assignments: ProjectAssignment[]
  project_deliverables: ProjectDeliverable[]
}

export interface ProjectWithDetails extends Project {
  project_assignments: (ProjectAssignment & {
    users: {
      id: string
      email: string
      first_name: string | null
      last_name: string | null
    }
  })[]
  project_deliverables: ProjectDeliverable[]
  project_comments: (ProjectComment & {
    users: {
      id: string
      email: string
      first_name: string | null
      last_name: string | null
    }
  })[]
  project_attachments: ProjectAttachment[]
  creator: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  } | null
}
