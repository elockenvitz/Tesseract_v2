import { supabase } from '../lib/supabase'

export interface KanbanBoard {
  id: string
  list_id: string
  name: string
  sort_order: number
  created_at: string
}

export interface KanbanLane {
  id: string
  board_id: string
  name: string
  color: string
  sort_order: number
}

export interface KanbanLaneItem {
  id: string
  board_id: string
  lane_id: string
  asset_list_item_id: string
}

// ── Boards ──

export async function getKanbanBoards(listId: string): Promise<KanbanBoard[]> {
  const { data, error } = await supabase
    .from('list_kanban_boards')
    .select('*')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createKanbanBoard(listId: string, name: string): Promise<KanbanBoard> {
  const { data: existing } = await supabase
    .from('list_kanban_boards')
    .select('sort_order')
    .eq('list_id', listId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const sortOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from('list_kanban_boards')
    .insert({ list_id: listId, name, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteKanbanBoard(boardId: string): Promise<void> {
  const { error } = await supabase
    .from('list_kanban_boards')
    .delete()
    .eq('id', boardId)
  if (error) throw error
}

export async function renameKanbanBoard(boardId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('list_kanban_boards')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', boardId)
  if (error) throw error
}

// ── Lanes ──

export async function getKanbanLanes(boardId: string): Promise<KanbanLane[]> {
  const { data, error } = await supabase
    .from('list_kanban_lanes')
    .select('*')
    .eq('board_id', boardId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createKanbanLane(boardId: string, name: string, color: string): Promise<KanbanLane> {
  const { data: existing } = await supabase
    .from('list_kanban_lanes')
    .select('sort_order')
    .eq('board_id', boardId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const sortOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from('list_kanban_lanes')
    .insert({ board_id: boardId, name, color, sort_order: sortOrder })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteKanbanLane(laneId: string): Promise<void> {
  const { error } = await supabase
    .from('list_kanban_lanes')
    .delete()
    .eq('id', laneId)
  if (error) throw error
}

export async function renameKanbanLane(laneId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('list_kanban_lanes')
    .update({ name })
    .eq('id', laneId)
  if (error) throw error
}

// ── Lane Items ──

export async function getKanbanLaneItems(boardId: string): Promise<KanbanLaneItem[]> {
  const { data, error } = await supabase
    .from('list_kanban_lane_items')
    .select('*')
    .eq('board_id', boardId)
  if (error) throw error
  return data || []
}

export async function assignToLane(boardId: string, laneId: string, assetListItemId: string): Promise<void> {
  const { error } = await supabase
    .from('list_kanban_lane_items')
    .upsert(
      { board_id: boardId, lane_id: laneId, asset_list_item_id: assetListItemId },
      { onConflict: 'board_id,asset_list_item_id' }
    )
  if (error) throw error
}

export async function removeFromLane(boardId: string, assetListItemId: string): Promise<void> {
  const { error } = await supabase
    .from('list_kanban_lane_items')
    .delete()
    .eq('board_id', boardId)
    .eq('asset_list_item_id', assetListItemId)
  if (error) throw error
}
