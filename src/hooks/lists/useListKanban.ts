import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getKanbanBoards, createKanbanBoard, deleteKanbanBoard, renameKanbanBoard,
  getKanbanLanes, createKanbanLane, deleteKanbanLane, renameKanbanLane,
  getKanbanLaneItems, assignToLane, removeFromLane,
  KanbanBoard
} from '../../services/list-kanban-service'

export function useListKanbanBoards(listId: string | undefined) {
  const queryClient = useQueryClient()

  const boardsQuery = useQuery({
    queryKey: ['kanban-boards', listId],
    queryFn: () => getKanbanBoards(listId!),
    enabled: !!listId
  })

  const createBoardM = useMutation({
    mutationFn: (name: string) => createKanbanBoard(listId!, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kanban-boards', listId] })
  })

  const deleteBoardM = useMutation({
    mutationFn: (boardId: string) => deleteKanbanBoard(boardId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kanban-boards', listId] })
  })

  const renameBoardM = useMutation({
    mutationFn: ({ boardId, name }: { boardId: string; name: string }) => renameKanbanBoard(boardId, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kanban-boards', listId] })
  })

  return {
    boards: boardsQuery.data || [],
    isLoading: boardsQuery.isLoading,
    createBoard: (name: string) => createBoardM.mutateAsync(name),
    deleteBoard: deleteBoardM.mutate,
    renameBoard: (boardId: string, name: string) => renameBoardM.mutate({ boardId, name })
  }
}

export function useKanbanBoard(boardId: string | null) {
  const queryClient = useQueryClient()

  const lanesQuery = useQuery({
    queryKey: ['kanban-lanes', boardId],
    queryFn: () => getKanbanLanes(boardId!),
    enabled: !!boardId
  })

  const itemsQuery = useQuery({
    queryKey: ['kanban-lane-items', boardId],
    queryFn: () => getKanbanLaneItems(boardId!),
    enabled: !!boardId
  })

  const createLaneM = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => createKanbanLane(boardId!, name, color),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kanban-lanes', boardId] })
  })

  const deleteLaneM = useMutation({
    mutationFn: (laneId: string) => deleteKanbanLane(laneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kanban-lanes', boardId] })
      queryClient.invalidateQueries({ queryKey: ['kanban-lane-items', boardId] })
    }
  })

  const renameLaneM = useMutation({
    mutationFn: ({ laneId, name }: { laneId: string; name: string }) => renameKanbanLane(laneId, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kanban-lanes', boardId] })
  })

  const assignM = useMutation({
    mutationFn: ({ laneId, assetListItemId }: { laneId: string; assetListItemId: string }) =>
      assignToLane(boardId!, laneId, assetListItemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kanban-lane-items', boardId] })
  })

  const removeM = useMutation({
    mutationFn: (assetListItemId: string) => removeFromLane(boardId!, assetListItemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kanban-lane-items', boardId] })
  })

  return {
    lanes: lanesQuery.data || [],
    laneItems: itemsQuery.data || [],
    isLoading: lanesQuery.isLoading || itemsQuery.isLoading,
    createLane: (name: string, color: string) => createLaneM.mutate({ name, color }),
    deleteLane: deleteLaneM.mutate,
    renameLane: (laneId: string, name: string) => renameLaneM.mutate({ laneId, name }),
    assignToLane: (laneId: string, assetListItemId: string) => assignM.mutate({ laneId, assetListItemId }),
    removeFromLane: removeM.mutate
  }
}
