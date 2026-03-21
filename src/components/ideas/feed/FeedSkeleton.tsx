/**
 * FeedSkeleton — Loading skeleton for the Ideas feed.
 */

import React from 'react'

function CardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 animate-pulse">
      <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-gray-200" />
        <div className="flex-1 flex items-center gap-2">
          <div className="h-3 w-24 bg-gray-200 rounded" />
          <div className="h-3 w-12 bg-gray-100 rounded" />
        </div>
        <div className="h-3 w-16 bg-gray-100 rounded" />
      </div>
      <div className="px-4 pb-1.5 flex gap-1.5">
        <div className="h-5 w-14 bg-gray-100 rounded" />
        <div className="h-5 w-20 bg-gray-100 rounded" />
      </div>
      <div className="px-4 pb-3 space-y-1.5">
        <div className="h-3.5 w-full bg-gray-100 rounded" />
        <div className="h-3.5 w-5/6 bg-gray-100 rounded" />
        <div className="h-3.5 w-2/3 bg-gray-100 rounded" />
      </div>
      <div className="px-4 py-2 border-t border-gray-100">
        <div className="h-4 w-24 bg-gray-100 rounded" />
      </div>
    </div>
  )
}

export function FeedSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading feed">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}
