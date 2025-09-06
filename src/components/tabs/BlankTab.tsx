import { useEffect, useRef } from 'react'
import { Card } from '../ui/Card'
import { Search, TrendingUp, FileText, Tag, Briefcase, List, Lightbulb } from 'lucide-react'
import { GlobalSearch } from '../search/GlobalSearch'

interface BlankTabProps {
  onSearchResult: (result: any) => void
}

export function BlankTab({ onSearchResult }: BlankTabProps) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchRef.current) {
        searchRef.current.focus()
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="max-w-2xl w-full text-center">
        <div className="py-12 px-8">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Search className="h-8 w-8 text-primary-600" />
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            What would you like to explore?
          </h2>

          <p className="text-gray-600 mb-8">
            Search for assets, portfolios, themes, or notebooks to get started.
          </p>

          <div className="mb-8">
            <GlobalSearch 
              onSelectResult={onSearchResult}
              placeholder="Search for anything..."
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
            <div 
              className="flex flex-col items-center p-4 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => onSearchResult({
                id: 'idea-generator',
                title: 'Idea Generator',
                type: 'idea-generator',
                data: null
              })}
            >
              <div className="w-10 h-10 bg-gradient-to-r from-purple-100 to-pink-100 rounded-lg flex items-center justify-center mb-2">
                <Lightbulb className="h-5 w-5 text-purple-600" />
              </div>
              <span className="text-gray-700 font-medium">Idea Generator</span>
              <span className="text-gray-500 text-xs">Discover insights</span>
            </div>

            <div 
              className="flex flex-col items-center p-4 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => onSearchResult({
                id: 'assets-list',
                title: 'All Assets',
                type: 'assets-list',
                data: null
              })}
            >
              <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center mb-2">
                <TrendingUp className="h-5 w-5 text-primary-600" />
              </div>
              <span className="text-gray-700 font-medium">Assets</span>
              <span className="text-gray-500 text-xs">Investment ideas</span>
            </div>

            <div 
              className="flex flex-col items-center p-4 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => onSearchResult({
                id: 'portfolios-list',
                title: 'All Portfolios',
                type: 'portfolios-list',
                data: null
              })}
            >
              <div className="w-10 h-10 bg-success-100 rounded-lg flex items-center justify-center mb-2">
                <Briefcase className="h-5 w-5 text-success-600" />
              </div>
              <span className="text-gray-700 font-medium">Portfolios</span>
              <span className="text-gray-500 text-xs">Track performance</span>
            </div>

            <div 
              className="flex flex-col items-center p-4 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => onSearchResult({
                id: 'themes-list',
                title: 'All Themes',
                type: 'themes-list',
                data: null
              })}
            >
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center mb-2">
                <Tag className="h-5 w-5 text-indigo-600" />
              </div>
              <span className="text-gray-700 font-medium">Themes</span>
              <span className="text-gray-500 text-xs">Organize by topic</span>
            </div>

            <div 
              className="flex flex-col items-center p-4 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => onSearchResult({
                id: 'notes-list',
                title: 'All Notes',
                type: 'notes-list',
                data: null
              })}
            >
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center mb-2">
                <FileText className="h-5 w-5 text-slate-600" />
              </div>
              <span className="text-gray-700 font-medium">Notes</span>
              <span className="text-gray-500 text-xs">All your notes</span>
            </div>

            <div 
              className="flex flex-col items-center p-4 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => onSearchResult({
                id: 'lists',
                title: 'Asset Lists',
                type: 'lists',
                data: null
              })}
            >
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-2">
                <List className="h-5 w-5 text-purple-600" />
              </div>
              <span className="text-gray-700 font-medium">Lists</span>
              <span className="text-gray-500 text-xs">Organize assets</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
