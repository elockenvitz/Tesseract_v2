/**
 * OpsGuard — Gates access to the Operations Portal.
 * Only platform admins (Tesseract team) can access /ops routes.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Shield } from 'lucide-react'

export function OpsGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  const { data: isPlatformAdmin, isLoading } = useQuery({
    queryKey: ['is-platform-admin', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_platform_admin')
      if (error) return false
      return !!data
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isPlatformAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-800">Access Restricted</h1>
          <p className="text-sm text-gray-500 mt-1">The Operations Portal is available to Tesseract platform staff only.</p>
          <a href="/dashboard" className="inline-block mt-4 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            Back to Tesseract
          </a>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
