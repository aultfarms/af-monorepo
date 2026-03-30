import { action, runInAction } from 'mobx';
import { getReportWindow } from '../lib/date';
import { buildReportZipBlob } from '../lib/pdf';
import {
  buildFuelReport,
  MissingGroupAssignmentError,
  MissingGroupError,
  MissingPersonError,
  MissingPumpError,
  MissingVehicleError,
} from '../lib/reporting';
import { loadFuelSettings } from '../lib/settings';
import type { FlashMessage, UserFacingError } from '../lib/types';
import { parseFuelExportsZipFile } from '../lib/csv';
import { state } from './state';

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.style.display = 'none';
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  window.requestAnimationFrame(() => {
    try {
      anchor.click();
    } catch {
      anchor.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    }
  });
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 60000);
}

function reportErrorFromException(error: unknown): UserFacingError {
  if (error instanceof MissingPersonError) {
    return {
      kind: 'missing-person',
      title: 'Missing person in settings',
      message: `The fuel export references person short code "${error.shortId}" but it is not present in the Google spreadsheet. Add a row to the "people" sheet with id=${error.shortId}, name=<display name>, and optional group=<group id>, then reload the app and try again.`,
      details: error.message,
    };
  }

  if (error instanceof MissingVehicleError) {
    return {
      kind: 'missing-vehicle',
      title: 'Missing vehicle in settings',
      message: `The fuel export references vehicle short code "${error.shortId}" but it is not present in the Google spreadsheet. Add a row to the "vehicles" sheet with id=${error.shortId}, name=<display name>, and group=<group id>, then reload the app and try again.`,
      details: error.message,
    };
  }

  if (error instanceof MissingGroupAssignmentError) {
    return {
      kind: 'missing-group',
      title: 'Missing group assignment',
      message: `The matching person and vehicle rows do not currently assign a group. Update either the "people" or "vehicles" sheet so this short code resolves to a valid group, reload the app, and try again.`,
      details: error.message,
    };
  }

  if (error instanceof MissingGroupError) {
    return {
      kind: 'missing-group',
      title: 'Missing group in settings',
      message: `The report needs group "${error.groupId}" but it is not defined in the "groups" sheet. Add the missing group row, reload the app, and try again.`,
      details: error.message,
    };
  }

  if (error instanceof MissingPumpError) {
    return {
      kind: 'missing-pump',
      title: 'Missing pump in settings',
      message: `The report encountered pump "${error.pumpId}" but it is not defined in the "pumps" sheet. Add the missing row, reload the app, and try again.`,
      details: error.message,
    };
  }

  return {
    kind: 'generic',
    title: 'Could not create report',
    message: error instanceof Error ? error.message : `${error}`,
  };
}

export const getCurrentReportWindow = action('getCurrentReportWindow', () => {
  return getReportWindow(state.reportMonth, state.reportYear);
});

export const setFlashMessage = action('setFlashMessage', (message: FlashMessage | null) => {
  state.flashMessage = message;
});

export const clearFlashMessage = action('clearFlashMessage', () => {
  state.flashMessage = null;
});

export const clearReportError = action('clearReportError', () => {
  state.reportError = null;
});

export const setReportMonth = action('setReportMonth', (reportMonth: number) => {
  state.reportMonth = reportMonth;
});

export const setReportYear = action('setReportYear', (reportYear: number) => {
  state.reportYear = reportYear;
});

export const resetLoadedExport = action('resetLoadedExport', () => {
  state.transactions = [];
  state.exportSummary = null;
  state.lastDownload = null;
  state.reportError = null;
  state.flashMessage = {
    type: 'info',
    text: 'Cleared the loaded export ZIP.',
  };
});

export const openSettingsSpreadsheet = action('openSettingsSpreadsheet', () => {
  if (!state.settings?.spreadsheetUrl) {
    return;
  }
  window.open(state.settings.spreadsheetUrl, '_blank', 'noopener,noreferrer');
});

export const initializeApp = action('initializeApp', async () => {
  runInAction(() => {
    state.isInitializing = true;
    state.initializationError = '';
    state.reportError = null;
  });

  try {
    const settings = await loadFuelSettings();
    runInAction(() => {
      state.settings = settings;
      state.isInitializing = false;
      state.flashMessage = {
        type: 'success',
        text: 'Google settings loaded successfully.',
      };
    });
  } catch (error) {
    runInAction(() => {
      state.isInitializing = false;
      state.initializationError = error instanceof Error ? error.message : `${error}`;
      state.flashMessage = {
        type: 'error',
        text: 'Could not load the Google settings spreadsheet.',
      };
    });
  }
});

export const loadExportZip = action('loadExportZip', async (file: File) => {
  try {
    const { transactions, summary } = await parseFuelExportsZipFile(file);
    runInAction(() => {
      state.transactions = transactions;
      state.exportSummary = summary;
      state.reportError = null;
      state.lastDownload = null;
      state.flashMessage = {
        type: 'success',
        text: `Loaded ${summary.transactionCount.toLocaleString()} transactions from ${summary.csvFileCount} CSV file(s).`,
      };
    });
  } catch (error) {
    runInAction(() => {
      state.flashMessage = {
        type: 'error',
        text: error instanceof Error ? error.message : `${error}`,
      };
    });
  }
});

export const createReport = action('createReport', async () => {
  if (!state.settings || state.transactions.length < 1) {
    return;
  }

  runInAction(() => {
    state.reportBusy = true;
    state.reportError = null;
  });

  try {
    const report = buildFuelReport({
      transactions: state.transactions,
      settings: state.settings,
      reportMonth: state.reportMonth,
      reportYear: state.reportYear,
    });

    const { blob, fileName, byteCount } = await buildReportZipBlob(report);
    triggerBrowserDownload(blob, fileName);

    runInAction(() => {
      state.reportBusy = false;
      state.lastDownload = {
        fileName,
        byteCount,
        createdAtText: new Date().toLocaleString(),
      };
      state.flashMessage = {
        type: 'success',
        text: `Downloaded ${fileName}.`,
      };
    });
  } catch (error) {
    console.error('Fuel report generation failed.', error);
    runInAction(() => {
      state.reportBusy = false;
      state.reportError = reportErrorFromException(error);
      state.flashMessage = {
        type: 'error',
        text: state.reportError.title,
      };
    });
  }
});
