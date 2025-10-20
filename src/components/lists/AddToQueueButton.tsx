import React, { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '../ui/Button'

interface AddToQueueButtonProps {
  assetId: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function AddToQueueButton({
  assetId,
  variant = 'outline',
  size = 'sm',
  className
}: AddToQueueButtonProps) {
  const [isInQueue, setIsInQueue] = useState(false)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsInQueue(!isInQueue)
  }

  const buttonVariant = isInQueue ? 'primary' : variant

  return (
    <Button
      variant={buttonVariant}
      size={size}
      onClick={handleClick}
      className={className}
    >
      {isInQueue ? (
        <>
          <Check className="h-4 w-4 mr-2" />
          In Queue
        </>
      ) : (
        <>
          <Plus className="h-4 w-4 mr-2" />
          Add to Queue
        </>
      )}
    </Button>
  )
}
