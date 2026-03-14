import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getThesesForIdea,
  getThesisCounts,
  createThesis,
  updateThesis,
  deleteThesis,
  type CreateThesisInput,
  type UpdateThesisInput,
} from '../lib/services/thesis-service'

export function useTheses(tradeIdeaId: string | undefined) {
  return useQuery({
    queryKey: ['theses', tradeIdeaId],
    queryFn: () => getThesesForIdea(tradeIdeaId!),
    enabled: !!tradeIdeaId,
    staleTime: 30_000,
  })
}

export function useThesisCounts(tradeIdeaId: string | undefined) {
  return useQuery({
    queryKey: ['thesis-counts', tradeIdeaId],
    queryFn: () => getThesisCounts(tradeIdeaId!),
    enabled: !!tradeIdeaId,
    staleTime: 60_000,
  })
}

export function useCreateThesis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateThesisInput) => createThesis(input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['theses', variables.tradeQueueItemId] })
      qc.invalidateQueries({ queryKey: ['thesis-counts', variables.tradeQueueItemId] })
    },
  })
}

export function useUpdateThesis(tradeQueueItemId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ thesisId, input }: { thesisId: string; input: UpdateThesisInput }) =>
      updateThesis(thesisId, input),
    onSuccess: () => {
      if (tradeQueueItemId) {
        qc.invalidateQueries({ queryKey: ['theses', tradeQueueItemId] })
      }
    },
  })
}

export function useDeleteThesis(tradeQueueItemId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (thesisId: string) => deleteThesis(thesisId),
    onSuccess: () => {
      if (tradeQueueItemId) {
        qc.invalidateQueries({ queryKey: ['theses', tradeQueueItemId] })
        qc.invalidateQueries({ queryKey: ['thesis-counts', tradeQueueItemId] })
      }
    },
  })
}
