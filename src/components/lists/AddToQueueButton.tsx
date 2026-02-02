import React, { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Button } from '../ui/Button'
import { AddTradeIdeaModal } from '../trading/AddTradeIdeaModal'

interface AddToQueueButtonProps {
  assetId: string
  portfolioId?: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}

export function AddToQueueButton({
  assetId,
  portfolioId,
  variant = 'outline',
  size = 'sm',
  className,
  label = 'New Trade Idea'
}: AddToQueueButtonProps) {
  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setShowModal(true)}
        className={className}
      >
        <ShoppingCart className="h-4 w-4 mr-2" />
        {label}
      </Button>

      <AddTradeIdeaModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        preselectedAssetId={assetId}
        preselectedPortfolioId={portfolioId}
        onSuccess={() => {
          setShowModal(false)
        }}
      />
    </>
  )
}
