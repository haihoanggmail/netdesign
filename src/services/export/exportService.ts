import { ProjectState } from '../../types/infrastructure';
import { exportProjectToHtmlViewer } from '../../utils/htmlViewerExporter';
import { runExportPng } from './exportPng';
import { runExportSvg } from './exportSvg';
import { runExportDxf } from './exportDxf';
import { runExportPdf } from './exportPdf';
import { runExportBundle } from './exportBundle';
import { runExportHtml3D, CaptureSceneFn } from './exportHtml3d';
import type { ViewerDataOptions } from '../../utils/htmlViewerExporter';
import {
  ExportBundleConfig,
  ExportContentScope,
  ExportPdfConfig,
  ExportPngConfig,
  sanitizeExportBaseName
} from './exportTypes';

import { trackAfter, trackEvent } from '../tracker';

export const ExportService = {
  exportPng(project: ProjectState, config: ExportPngConfig) {
    return trackAfter('export', 'png', runExportPng(project, config));
  },

  exportSvg(project: ProjectState, contentScope: ExportContentScope = '2d') {
    return trackAfter('export', 'svg', runExportSvg(project, contentScope));
  },

  exportDxf(project: ProjectState, contentScope: ExportContentScope = '2d') {
    return trackAfter('export', 'dxf', runExportDxf(project, contentScope));
  },

  exportPdf(project: ProjectState, config: ExportPdfConfig) {
    return trackAfter('export', 'pdf', runExportPdf(project, config));
  },

  exportBundle(project: ProjectState, config: ExportBundleConfig) {
    return trackAfter('export', 'handover_bundle', runExportBundle(project, config));
  },

  exportHtmlViewer3D(
    project: ProjectState,
    config: { contentScope: ExportContentScope; captureScene?: CaptureSceneFn; data?: ViewerDataOptions }
  ) {
    return trackAfter('export', 'html_viewer_3d', runExportHtml3D(project, config));
  },

  exportHtmlViewer(project: ProjectState) {
    exportProjectToHtmlViewer(project);
    trackEvent('export', 'html_viewer');
    const baseName = sanitizeExportBaseName(project.name);
    return { filename: `${baseName}_Viewer.html` };
  }
};

export * from './exportTypes';
