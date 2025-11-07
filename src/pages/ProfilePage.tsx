import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { User, Edit2, Save, Edit3, Calendar, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { formatDistanceToNow } from 'date-fns'

export function ProfilePage() {
  const [isEditing, setIsEditing] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const { user, loading: isLoading } = useAuth()
  const queryClient = useQueryClient()

  // User details are already loaded in the user object from useAuth
  const userDetails = user as any

  // Update form fields when user data loads
  useState(() => {
    if (userDetails) {
      setFirstName(userDetails.first_name || '')
      setLastName(userDetails.last_name || '')
      setEmail(userDetails.email || '')
    }
  }, [userDetails])

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (updates: { first_name?: string; last_name?: string }) => {
      const { error } = await supabase
        .from('users')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', user?.id)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profile', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['user-details', user?.id] })
      setIsEditing(false)
    }
  })

  const handleSave = () => {
    updateProfileMutation.mutate({
      first_name: firstName.trim(),
      last_name: lastName.trim()
    })
  }

  const handleCancel = () => {
    setFirstName(userDetails?.first_name || '')
    setLastName(userDetails?.last_name || '')
    setIsEditing(false)
  }

  const getUserInitials = () => {
    if (userDetails?.first_name && userDetails?.last_name) {
      return (userDetails.first_name[0] + userDetails.last_name[0]).toUpperCase()
    }

    const userEmail = userDetails?.email || user?.email
    if (!userEmail) return ''

    const parts = userEmail.split('@')[0].split('.')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }

    const name = userEmail.split('@')[0]
    return name.length >= 2 ? name.substring(0, 2).toUpperCase() : name.toUpperCase()
  }

  const getDisplayName = () => {
    if (userDetails?.first_name && userDetails?.last_name) {
      return `${userDetails.first_name} ${userDetails.last_name}`
    }

    const userEmail = userDetails?.email || user?.email
    if (!userEmail) return ''

    const emailParts = userEmail.split('@')[0].split('.')
    if (emailParts.length >= 2) {
      return emailParts.map((part: string) =>
        part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      ).join(' ')
    }

    return userEmail.split('@')[0]
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <Card>
            <div className="space-y-4">
              <div className="w-20 h-20 bg-gray-200 rounded-full mx-auto"></div>
              <div className="h-6 bg-gray-200 rounded w-1/2 mx-auto"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3 mx-auto"></div>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-600 mt-1">Manage your personal information and account settings</p>
      </div>

      {/* Profile Card */}
      <Card>
        <div className="text-center mb-6">
          <div className="w-20 h-20 rounded-full bg-primary-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">
              {getUserInitials()}
            </span>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">{getDisplayName()}</h2>
          <p className="text-gray-600">{userDetails?.email}</p>
          <div className="flex items-center justify-center gap-2 mt-1">
            <p className="text-sm text-gray-500 capitalize">
              {userDetails?.user_role || 'Investor'}
            </p>
            {userDetails?.coverage_admin && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800">
                Admin
              </span>
            )}
          </div>
        </div>

        {/* Profile Form */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Personal Information</h3>
            {!isEditing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit3 className="h-4 w-4 mr-2" />
                Edit Profile
              </Button>
            ) : (
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  loading={updateProfileMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="First Name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={!isEditing}
            />
            <Input
              label="Last Name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={!isEditing}
            />
          </div>

          <Input
            label="Email Address"
            value={email}
            disabled={true}
            helperText="Email cannot be changed. Contact support if you need to update your email."
          />
        </div>
      </Card>

      {/* Account Information */}
      <Card>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Account Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <Calendar className="h-5 w-5 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Member Since</p>
              <p className="text-sm text-gray-900">
                {userDetails?.created_at 
                  ? formatDistanceToNow(new Date(userDetails.created_at), { addSuffix: true })
                  : 'Unknown'
                }
              </p>
            </div>
          </div>

          <div className="flex items-center">
            <div className="p-2 bg-success-100 rounded-lg">
              <User className="h-5 w-5 text-success-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Role</p>
              <p className="text-sm text-gray-900 capitalize">{userDetails?.user_role || 'Investor'}</p>
              <p className="text-xs text-gray-500 mt-0.5">Contact support to change</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}