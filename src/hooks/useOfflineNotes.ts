import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface PendingNote {
  id: string
  entityType: 'asset' | 'portfolio' | 'theme'
  entityId: string
  tableName: string
  title: string
  content: string
  updatedAt: string
  userId: string
}

interface UseOfflineNotesReturn {
  isOnline: boolean
  pendingCount: number
  isSyncing: boolean
  lastSyncAttempt: Date | null
  saveOffline: (note: Omit<PendingNote, 'updatedAt'>) => void
  syncPendingNotes: () => Promise<void>
  getPendingNote: (noteId: string) => PendingNote | undefined
  hasPendingChanges: (noteId: string) => boolean
}

const STORAGE_KEY = 'tesseract_offline_notes'

// Get pending notes from localStorage
function getPendingNotes(): PendingNote[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

// Save pending notes to localStorage
function savePendingNotes(notes: PendingNote[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
  } catch (e) {
    console.error('Failed to save offline notes:', e)
  }
}

export function useOfflineNotes(): UseOfflineNotesReturn {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingNotes, setPendingNotes] = useState<PendingNote[]>([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncAttempt, setLastSyncAttempt] = useState<Date | null>(null)
  const syncInProgress = useRef(false)

  // Load pending notes from localStorage on mount
  useEffect(() => {
    setPendingNotes(getPendingNotes())
  }, [])

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      console.log('Network: Online')
      setIsOnline(true)
    }

    const handleOffline = () => {
      console.log('Network: Offline')
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && pendingNotes.length > 0 && !syncInProgress.current) {
      syncPendingNotes()
    }
  }, [isOnline])

  // Save note offline
  const saveOffline = useCallback((note: Omit<PendingNote, 'updatedAt'>) => {
    const updatedNote: PendingNote = {
      ...note,
      updatedAt: new Date().toISOString()
    }

    setPendingNotes(prev => {
      // Update existing or add new
      const existing = prev.findIndex(n => n.id === note.id)
      let updated: PendingNote[]
      if (existing >= 0) {
        updated = [...prev]
        updated[existing] = updatedNote
      } else {
        updated = [...prev, updatedNote]
      }
      savePendingNotes(updated)
      return updated
    })

    console.log('Saved offline:', note.id)
  }, [])

  // Sync pending notes to server
  const syncPendingNotes = useCallback(async () => {
    if (syncInProgress.current || !isOnline || pendingNotes.length === 0) {
      return
    }

    syncInProgress.current = true
    setIsSyncing(true)
    setLastSyncAttempt(new Date())

    console.log(`Syncing ${pendingNotes.length} offline notes...`)

    const successfulIds: string[] = []
    const failedNotes: PendingNote[] = []

    for (const note of pendingNotes) {
      try {
        const { error } = await supabase
          .from(note.tableName)
          .update({
            title: note.title,
            content: note.content,
            updated_at: note.updatedAt,
            updated_by: note.userId
          })
          .eq('id', note.id)

        if (error) {
          console.error(`Failed to sync note ${note.id}:`, error)
          failedNotes.push(note)
        } else {
          console.log(`Synced note ${note.id}`)
          successfulIds.push(note.id)
        }
      } catch (e) {
        console.error(`Error syncing note ${note.id}:`, e)
        failedNotes.push(note)
      }
    }

    // Update pending notes with only failed ones
    setPendingNotes(failedNotes)
    savePendingNotes(failedNotes)

    setIsSyncing(false)
    syncInProgress.current = false

    if (successfulIds.length > 0) {
      console.log(`Successfully synced ${successfulIds.length} notes`)
    }
    if (failedNotes.length > 0) {
      console.warn(`Failed to sync ${failedNotes.length} notes, will retry later`)
    }
  }, [isOnline, pendingNotes])

  // Get a specific pending note
  const getPendingNote = useCallback((noteId: string): PendingNote | undefined => {
    return pendingNotes.find(n => n.id === noteId)
  }, [pendingNotes])

  // Check if a note has pending changes
  const hasPendingChanges = useCallback((noteId: string): boolean => {
    return pendingNotes.some(n => n.id === noteId)
  }, [pendingNotes])

  return {
    isOnline,
    pendingCount: pendingNotes.length,
    isSyncing,
    lastSyncAttempt,
    saveOffline,
    syncPendingNotes,
    getPendingNote,
    hasPendingChanges
  }
}
