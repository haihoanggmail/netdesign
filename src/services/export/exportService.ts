import { ProjectState } from '../../types/infrastructure';
import { exportProjectToHtmlViewer } from '../../utils/htmlViewerExporter';
import { runExportPng } from './exportPng';
import { runExportSvg } from './exportSvg';
import { runExportDxf } from './exportDxf';
import { runExportPdf } from './exportPdf';
import { runExportBundle } from './exportBundle';
import {
  ExportBundleConfig,
  ExportContentScope,
  ExportPdfConfig,
  ExportPngConfig,
  sanitizeExportBaseName
} from './exportTypes';

export const ExportService = {
  exportPng(project: ProjectState, config: ExportPngConfig) {
    return runExportPng(project, config);
  },

  exportSvg(project: ProjectState, contentScope: ExportContentScope = '2d') {
    return runExportSvg(project, contentScope);
  },

  exportDxf(project: ProjectState, contentScope: ExportContentScope = '2d') {
    return runExportDxf(project, contentScope);
  },

  exportPdf(project: ProjectState, config: ExportPdfConfig) {
    return runExportPdf(project, config);
  },

  exportBundle(project: ProjectState, config: ExportBundleConfig) {
    return runExportBundle(project, config);
  },

  exportHtmlViewer(project: ProjectState) {
    exportProjectToHtmlViewer(project);
    const baseName = sanitizeExportBaseName(project.name);
    return { filename: `${baseName}_Viewer.html` };
  }
};

export * from './exportTypes';
