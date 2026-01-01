import { useState, useCallback } from 'react'

export interface ScreenCaptureResult {
  blob: Blob
  dataUrl: string
  width: number
  height: number
}

export interface UseScreenCaptureReturn {
  capture: () => Promise<ScreenCaptureResult | null>
  isCapturing: boolean
  error: string | null
  isSupported: boolean
}

export function useScreenCapture(): UseScreenCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check if getDisplayMedia is supported
  const isSupported = typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'

  const capture = useCallback(async (): Promise<ScreenCaptureResult | null> => {
    if (!isSupported) {
      setError('Screen capture is not supported in this browser')
      return null
    }

    setIsCapturing(true)
    setError(null)

    try {
      // Request screen capture
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser', // Prefer browser tab
        },
        audio: false
      })

      // Get the video track
      const track = stream.getVideoTracks()[0]

      // Create a video element to capture from
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true

      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play()
          resolve()
        }
      })

      // Small delay to ensure frame is rendered
      await new Promise(resolve => setTimeout(resolve, 100))

      // Create canvas and draw video frame
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Could not get canvas context')
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      // Stop all tracks
      stream.getTracks().forEach(track => track.stop())

      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) {
              resolve(b)
            } else {
              reject(new Error('Failed to create blob'))
            }
          },
          'image/png',
          1.0
        )
      })

      // Create data URL for preview
      const dataUrl = canvas.toDataURL('image/png')

      setIsCapturing(false)

      return {
        blob,
        dataUrl,
        width: canvas.width,
        height: canvas.height
      }
    } catch (err: any) {
      // User cancelled or error occurred
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
        // User cancelled - not an error
        setIsCapturing(false)
        return null
      }

      const message = err.message || 'Failed to capture screen'
      setError(message)
      setIsCapturing(false)
      return null
    }
  }, [isSupported])

  return {
    capture,
    isCapturing,
    error,
    isSupported
  }
}

export default useScreenCapture
