// src/export/runExport.ts
import { exportProject } from './exportProject.ts'
import { exportSelective } from './exportSelective.ts'
import type { ExportOptions, ExportProject, ExportResult, ExportSettings } from './types.ts'

export function runExport(
  project: ExportProject,
  settings: ExportSettings,
  options: ExportOptions = {},
): Promise<ExportResult> {
  return settings.mode === 'selective'
    ? exportSelective(project, settings, options)
    : exportProject(project, settings, options)
}
