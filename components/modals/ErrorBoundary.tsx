import React from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { RECOVERY_STORAGE_KEY } from '../../utils/projectStorage';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Lỗi không xác định trong giao diện.'
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('HACHIHI ErrorBoundary caught error:', error, info);
  }

  handleDownloadRecoveryBackup = () => {
    try {
      const raw = localStorage.getItem(RECOVERY_STORAGE_KEY) || '{}';
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `HACHIHI_Emergency_Recovery_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // ignore storage access failure
    }
  };

  handleRecoverWorkspace = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-6 text-slate-800 dark:text-slate-100">
          <div className="max-w-lg w-full bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold">Đã xảy ra sự cố hiển thị đột xuất</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Dữ liệu dự án của bạn vẫn được bảo toàn tự động trong bộ nhớ phục hồi.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-rose-700 dark:text-rose-300 break-words">
              {this.state.errorMessage}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                onClick={this.handleDownloadRecoveryBackup}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-4 h-4 text-blue-600" />
                <span>Tải bản sao lưu khẩn cấp (.json)</span>
              </button>
              <button
                onClick={this.handleRecoverWorkspace}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Khởi động lại không gian làm việc</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
