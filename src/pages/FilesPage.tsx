import { FolderOpen, HardDrive } from 'lucide-react'

interface FilesPageProps {
  onItemSelect?: (item: any) => void
}

/**
 * Files — the shared repository, which does not exist yet.
 *
 * ── Why this page is a statement rather than a list ────────────────────────
 *
 * This surface used to render a full file manager: a category chip row with
 * counts, a search field, a grid/list toggle, a five-column table with
 * per-row Download, Share and More buttons, a star toggle, and Upload and
 * New Folder buttons opening a drop-zone modal.
 *
 * None of it was connected to anything. The query was:
 *
 *     queryFn: async () => {
 *       // TODO: Implement once files table is created
 *       return [] as FileItem[]
 *     }
 *
 * There is no `files` table — no migration creates one and nothing in the
 * app queries one — so the array was always empty, which made the grid and
 * the table unreachable code and the empty state the only branch that had
 * ever rendered. The row actions had empty bodies (`// Download file`,
 * `// Share file`, `// Toggle star`). The upload modal's own text admitted
 * "This feature is coming soon", but only after a user had found Upload,
 * tapped it and waited for a dialog.
 *
 * Three commits of mobile layout work had gone into that table — collapsing
 * Category, Size and Modified below `sm` and refolding them under the
 * filename — on markup that cannot render a row.
 *
 * So the page says what is true. The nav entry stays, because Files is
 * staying in the product; what goes is every control that implied a working
 * repository. When the repository is built, this file is where it lands.
 *
 * ── What "available from those workspaces" means ───────────────────────────
 *
 * Real file storage does exist, and it is not reachable from here. Bytes go
 * to the `assets` Storage bucket under an org-scoped path (see
 * `lib/storage/asset-paths.ts`), and the metadata lives in per-feature
 * tables — `model_files` and `asset_models` on an asset, note attachments,
 * checklist evidence, `project_attachments`, `workflow_templates`. Each is
 * read through its own workspace, with its own permissions. A Files landing
 * would have to union six tables with six different postures, which is the
 * repository this page is honest about not having.
 */
export function FilesPage({ onItemSelect: _onItemSelect }: FilesPageProps) {
  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header — identity only. Every action that used to sit here (Upload,
          New Folder) opened something that could not do anything. */}
      <div className="bg-white border-b border-gray-200 px-3 sm:px-6 py-2.5 sm:py-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="p-2 bg-violet-100 rounded-lg shrink-0 dark:bg-violet-900/30">
            <FolderOpen className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Files</h1>
            <p className="hidden sm:block text-sm text-gray-500 dark:text-gray-400">
              Shared repository for models, documents and resources
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto overscroll-contain p-4 sm:p-6">
        <div className="mx-auto max-w-md py-10 sm:py-16 text-center">
          <div className="inline-flex p-4 bg-gray-100 rounded-full mb-4 dark:bg-gray-800">
            <HardDrive className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-base sm:text-lg font-medium text-gray-900 mb-2 dark:text-white">
            The shared file repository is not connected yet
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Files and attachments that belong to existing workflows remain
            available from those workspaces — models and documents on an
            asset, attachments on a note, evidence on a checklist item, and
            files on a project.
          </p>
        </div>
      </div>
    </div>
  )
}
