import React, { useState } from 'react'
import { List, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { AssetListManager } from './AssetListManager'

interface AddToListButtonProps {
  assetId: string
  assetSymbol: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function AddToListButton({ 
  assetId, 
  assetSymbol, 
  variant = 'outline', 
  size = 'sm',
  className 
}: AddToListButtonProps) {
  const [showListManager, setShowListManager] = useState(false)

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setShowListManager(true)}
        className={className}
      >
        <List className="h-4 w-4 mr-2" />
        Add to List
      </Button>

      <AssetListManager
        isOpen={showListManager}
        onClose={() => setShowListManager(false)}
        selectedAssetId={assetId}
      />
    </>
  )
}