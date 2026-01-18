import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { ProjectDependency, ProjectDependencyWithDetails, DependencyType } from '../types/project'

interface UseProjectDependenciesOptions {
  projectId?: string
}

export function useProjectDependencies({ projectId }: UseProjectDependenciesOptions = {}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch dependencies where this project depends on others (blocked by)
  const { data: blockedBy, isLoading: loadingBlockedBy } = useQuery({
    queryKey: ['project-dependencies', 'blocked-by', projectId],
    queryFn: async () => {
      if (!projectId) return []

      const { data, error } = await supabase
        .from('project_dependencies')
        .select(`
          *,
          depends_on:depends_on_id(
            id,
            title,
            status,
            priority
          )
        `)
        .eq('project_id', projectId)
        .eq('dependency_type', 'blocks')

      if (error) throw error
      return (data || []) as ProjectDependencyWithDetails[]
    },
    enabled: !!projectId
  })

  // Fetch dependencies where other projects depend on this one (blocking)
  const { data: blocking, isLoading: loadingBlocking } = useQuery({
    queryKey: ['project-dependencies', 'blocking', projectId],
    queryFn: async () => {
      if (!projectId) return []

      const { data, error } = await supabase
        .from('project_dependencies')
        .select(`
          *,
          project:project_id(
            id,
            title,
            status,
            priority
          )
        `)
        .eq('depends_on_id', projectId)
        .eq('dependency_type', 'blocks')

      if (error) throw error
      return (data || []) as ProjectDependencyWithDetails[]
    },
    enabled: !!projectId
  })

  // Fetch related (non-blocking) dependencies
  const { data: related, isLoading: loadingRelated } = useQuery({
    queryKey: ['project-dependencies', 'related', projectId],
    queryFn: async () => {
      if (!projectId) return []

      const { data, error } = await supabase
        .from('project_dependencies')
        .select(`
          *,
          depends_on:depends_on_id(
            id,
            title,
            status,
            priority
          )
        `)
        .eq('project_id', projectId)
        .eq('dependency_type', 'related')

      if (error) throw error
      return (data || []) as ProjectDependencyWithDetails[]
    },
    enabled: !!projectId
  })

  // Check if project is blocked (has incomplete blocking dependencies)
  const isBlocked = blockedBy?.some(dep =>
    dep.depends_on?.status !== 'completed' && dep.depends_on?.status !== 'cancelled'
  ) ?? false

  // Add dependency mutation
  const addDependencyMutation = useMutation({
    mutationFn: async ({
      dependsOnId,
      dependencyType = 'blocks'
    }: {
      dependsOnId: string
      dependencyType?: DependencyType
    }) => {
      if (!projectId) throw new Error('Project ID is required')

      const { data, error } = await supabase
        .from('project_dependencies')
        .insert({
          project_id: projectId,
          depends_on_id: dependsOnId,
          dependency_type: dependencyType,
          created_by: user?.id
        })
        .select()
        .single()

      if (error) throw error
      return data as ProjectDependency
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-dependencies'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  // Remove dependency mutation
  const removeDependencyMutation = useMutation({
    mutationFn: async (dependencyId: string) => {
      const { error } = await supabase
        .from('project_dependencies')
        .delete()
        .eq('id', dependencyId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-dependencies'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  return {
    blockedBy: blockedBy || [],
    blocking: blocking || [],
    related: related || [],
    isBlocked,
    isLoading: loadingBlockedBy || loadingBlocking || loadingRelated,
    addDependency: addDependencyMutation.mutate,
    removeDependency: removeDependencyMutation.mutate,
    isAddingDependency: addDependencyMutation.isPending,
    isRemovingDependency: removeDependencyMutation.isPending
  }
}

// Hook to fetch all dependencies for multiple projects (for board view)
export function useAllProjectDependencies() {
  const { data: allDependencies, isLoading } = useQuery({
    queryKey: ['project-dependencies', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_dependencies')
        .select(`
          *,
          depends_on:depends_on_id(
            id,
            title,
            status,
            priority
          ),
          project:project_id(
            id,
            title,
            status,
            priority
          )
        `)
        .eq('dependency_type', 'blocks')

      if (error) throw error
      return (data || []) as ProjectDependencyWithDetails[]
    }
  })

  // Create a map of project IDs to their blocking status
  const blockingStatus = new Map<string, { isBlocked: boolean; blockedBy: string[]; blocking: string[] }>()

  allDependencies?.forEach(dep => {
    // Mark the project as blocked if dependency is not completed
    if (dep.depends_on?.status !== 'completed' && dep.depends_on?.status !== 'cancelled') {
      const current = blockingStatus.get(dep.project_id) || { isBlocked: false, blockedBy: [], blocking: [] }
      current.isBlocked = true
      current.blockedBy.push(dep.depends_on_id)
      blockingStatus.set(dep.project_id, current)
    }

    // Mark the dependency project as blocking others
    const depProject = blockingStatus.get(dep.depends_on_id) || { isBlocked: false, blockedBy: [], blocking: [] }
    depProject.blocking.push(dep.project_id)
    blockingStatus.set(dep.depends_on_id, depProject)
  })

  return {
    dependencies: allDependencies || [],
    blockingStatus,
    isLoading
  }
}
