import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { useDropzone } from 'react-dropzone';
import { context } from './state';
import {
  formatGallons,
  formatMonthYearLabel,
  formatReportBoundary,
  formatRowDateTime,
  MONTH_NAMES,
  toFileStem,
} from './lib/date';
import { countTransactionsForReportPeriod, getAvailableReportYears } from './lib/reporting';
import type { FuelSettings, FuelTransaction } from './lib/types';
import './App.css';

function MessageBanner({
  type,
  children,
  onDismiss,
}: {
  type: 'success' | 'error' | 'info';
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`message-banner ${type}`}>
      <div>{children}</div>
      {onDismiss ? (
        <button className="secondary-button small-button" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

function getMappedLabel(id: string, name?: string) {
  if (!id) {
    return '—';
  }
  if (!name) {
    return id;
  }
  return `${id} — ${name}`;
}

function formatMonthKeyLabel(monthKey?: string) {
  if (!monthKey) {
    return '';
  }

  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return monthKey;
  }

  return formatMonthYearLabel(month, year);
}

function getTransactionStatus(
  transaction: FuelTransaction,
  settings: FuelSettings | null,
): { tone: 'success' | 'error'; text: string } {
  if (!settings) {
    return { tone: 'error', text: 'Settings not loaded' };
  }

  const person = settings.peopleById[transaction.personShortname];
  if (!person) {
    return { tone: 'error', text: `Missing person ${transaction.personShortname}` };
  }

  const vehicle = settings.vehiclesById[transaction.vehicleShortname];
  if (!vehicle) {
    return { tone: 'error', text: `Missing vehicle ${transaction.vehicleShortname}` };
  }

  const groupId = person.group || vehicle.group;
  if (!groupId) {
    return { tone: 'error', text: 'Missing group assignment' };
  }

  if (!settings.groupsById[groupId]) {
    return { tone: 'error', text: `Missing group ${groupId}` };
  }

  if (!settings.pumpsById[transaction.pumpNumber]) {
    return { tone: 'error', text: `Missing pump ${transaction.pumpNumber}` };
  }

  const pumpGroupId = `pump-${transaction.pumpNumber}`;
  if (!settings.groupsById[pumpGroupId]) {
    return { tone: 'error', text: `Missing group ${pumpGroupId}` };
  }

  return { tone: 'success', text: 'Ready' };
}

function LoadedTransactionsTable({
  transactions,
  settings,
}: {
  transactions: FuelTransaction[];
  settings: FuelSettings | null;
}) {
  return (
    <details className="transactions-details">
      <summary className="transactions-summary">
        <span>View loaded transactions</span>
        <span>{transactions.length.toLocaleString()} rows</span>
      </summary>
      <div className="transactions-table-wrap">
        <table className="transactions-table">
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Person</th>
              <th>Vehicle</th>
              <th>Pump</th>
              <th>Gallons</th>
              <th>Price/Gal</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction, index) => {
              const personName = settings?.peopleById[transaction.personShortname]?.name;
              const vehicleName = settings?.vehiclesById[transaction.vehicleShortname]?.name;
              const status = getTransactionStatus(transaction, settings);

              return (
                <tr
                  key={`${transaction.sourceFile}:${transaction.rawLineNumber}:${transaction.transactionNumber || index}`}
                >
                  <td>{formatRowDateTime(transaction.date)}</td>
                  <td>{getMappedLabel(transaction.personShortname, personName)}</td>
                  <td>{getMappedLabel(transaction.vehicleShortname, vehicleName)}</td>
                  <td>{transaction.pumpNumber || '—'}</td>
                  <td>{formatGallons(transaction.gallons)}</td>
                  <td>{formatGallons(transaction.pricePerGallon)}</td>
                  <td>
                    <span className={`status-pill ${status.tone}`}>{status.text}</span>
                  </td>
                  <td>{`${transaction.sourceFile}:${transaction.rawLineNumber}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ExportFileNameList({
  fileNames,
  targetFileName,
  compact = false,
}: {
  fileNames: string[];
  targetFileName?: string | null;
  compact?: boolean;
}) {
  return (
    <ul className={`export-file-list ${compact ? 'compact' : ''}`}>
      {fileNames.map((fileName, index) => {
        const isTarget = fileName === targetFileName;
        return (
          <li key={`${fileName}:${index}`} className={isTarget ? 'target' : ''}>
            <span className="export-file-name">{fileName}</span>
            {isTarget ? <span className="export-file-badge">Selected month</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export const App = observer(function App() {
  const { state, actions } = React.useContext(context);
  const reportFeedbackRef = React.useRef<HTMLDivElement | null>(null);
  const loadedDataRef = React.useRef<HTMLElement | null>(null);
  const previousDriveLoadBusyRef = React.useRef(state.driveLoadBusy);
  const previousExportSummaryRef = React.useRef(state.exportSummary);

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    accept: { 'application/zip': ['.zip'] },
    multiple: false,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: files => {
      const file = files[0];
      if (file) {
        void actions.loadExportZip(file);
      }
    },
    onDropRejected: () => {
      actions.setFlashMessage({
        type: 'error',
        text: 'Please choose a ZIP file containing the fuel export CSVs.',
      });
    },
  });

  const { start: reportWindowStart, end: reportWindowEnd } = actions.getCurrentReportWindow();
  const reportWindow = `${formatReportBoundary(reportWindowStart)} - ${formatReportBoundary(reportWindowEnd)}`;

  const selectedWindowTransactionCount = React.useMemo(
    () => countTransactionsForReportPeriod(state.transactions, state.reportMonth, state.reportYear),
    [state.transactions, state.reportMonth, state.reportYear],
  );

  const availableYears = React.useMemo(
    () => {
      const years = new Set(getAvailableReportYears(state.transactions, state.reportYear));
      state.availableDriveExports.forEach(file => years.add(file.year));
      return Array.from(years).sort((left, right) => left - right);
    },
    [state.availableDriveExports, state.transactions, state.reportYear],
  );

  const selectedMonthKey = toFileStem(state.reportMonth, state.reportYear);
  const driveExportsError = state.driveExportsListingError || state.driveExportsSelectionError;
  const driveLoadedDataNeedsRefresh = Boolean(
    state.exportSummary?.source === 'google-drive' &&
      state.exportSummary.requestedMonthKey &&
      state.exportSummary.requestedMonthKey !== selectedMonthKey,
  );
  const loadedDriveMonthLabel = formatMonthKeyLabel(state.exportSummary?.requestedMonthKey);

  React.useEffect(() => {
    if (state.reportError || state.lastDownload) {
      reportFeedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [state.reportError, state.lastDownload]);

  React.useEffect(() => {
    const justFinishedSuccessfulDriveLoad =
      previousDriveLoadBusyRef.current &&
      !state.driveLoadBusy &&
      state.exportSummary?.source === 'google-drive' &&
      previousExportSummaryRef.current !== state.exportSummary;

    if (justFinishedSuccessfulDriveLoad) {
      loadedDataRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    previousDriveLoadBusyRef.current = state.driveLoadBusy;
    previousExportSummaryRef.current = state.exportSummary;
  }, [state.driveLoadBusy, state.exportSummary]);

  return (
    <div className="app-shell">
      <div className="page-column">
        <header className="hero">
          <div>
            <div className="eyebrow">Ault Farms</div>
            <h1>Fuel Reports</h1>
            <p>
                Load fuel export CSVs from Google Drive for the selected report month, or fall
                back to a manual ZIP upload, then download the full and print-version PDFs as a
                ZIP.
            </p>
          </div>
        </header>

        {state.flashMessage ? (
          <MessageBanner type={state.flashMessage.type} onDismiss={actions.clearFlashMessage}>
            {state.flashMessage.text}
          </MessageBanner>
        ) : null}


        {state.isInitializing ? (
          <section className="panel">
            <h2>Loading Google settings…</h2>
            <p>
              The app is authorizing Google and ensuring the settings spreadsheet exists at{' '}
              <code>{state.settingsPath}</code>.
            </p>
            <div className="spinner" aria-hidden="true" />
          </section>
        ) : state.initializationError ? (
          <section className="panel error-panel">
            <h2>Could not load Google settings</h2>
            <p>{state.initializationError}</p>
            <div className="button-row">
              <button className="primary-button" onClick={() => void actions.initializeApp()}>
                Retry Google Login
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Settings Spreadsheet</h2>
                  <p className="muted">
                    Source of truth for groups, people, vehicles, and pumps.
                  </p>
                </div>
                <div className="button-row">
                  <button className="secondary-button" onClick={actions.openSettingsSpreadsheet}>
                    Open Spreadsheet
                  </button>
                  <button className="secondary-button" onClick={() => void actions.initializeApp()}>
                    Reload Settings
                  </button>
                </div>
              </div>
              <div className="info-grid">
                <div className="wide-info-card">
                  <div className="info-label">Drive path</div>
                  <code className="path-code">{state.settingsPath}</code>
                </div>
                <div>
                  <div className="info-label">Groups</div>
                  <strong>{state.settings?.groups.length || 0}</strong>
                </div>
                <div>
                  <div className="info-label">People</div>
                  <strong>{state.settings?.people.length || 0}</strong>
                </div>
                <div>
                  <div className="info-label">Vehicles</div>
                  <strong>{state.settings?.vehicles.length || 0}</strong>
                </div>
                <div>
                  <div className="info-label">Pumps</div>
                  <strong>{state.settings?.pumps.length || 0}</strong>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Load fuel exports</h2>
                  <p className="muted">
                    Google Drive is the default source. Select the report month to choose the
                    matching CSV plus up to two earlier and two later exports.
                  </p>
                </div>
                <div className="button-row">
                  <button
                    className="secondary-button"
                    disabled={state.driveExportsBusy || state.driveLoadBusy}
                    onClick={() => void actions.refreshDriveExports()}
                  >
                    {state.driveExportsBusy ? 'Refreshing…' : 'Refresh Exports Folder'}
                  </button>
                </div>
              </div>
              <div className="controls-row">
                <label className="control-group">
                  <span>Month</span>
                  <select
                    value={state.reportMonth}
                    onChange={event => actions.setReportMonth(Number(event.target.value))}
                  >
                    {MONTH_NAMES.map((monthName, index) => (
                      <option key={monthName} value={index + 1}>
                        {monthName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control-group">
                  <span>Year</span>
                  <select
                    value={state.reportYear}
                    onChange={event => actions.setReportYear(Number(event.target.value))}
                  >
                    {availableYears.map(year => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="control-group grow">
                  <span>Report window</span>
                  <div className="report-window">{reportWindow}</div>
                </div>
              </div>
              <div className="summary-strip">
                <div>
                  <div className="info-label">Selected period</div>
                  <strong>{formatMonthYearLabel(state.reportMonth, state.reportYear)}</strong>
                </div>
                <div>
                  <div className="info-label">Drive CSVs in folder</div>
                  <strong>{state.availableDriveExports.length}</strong>
                </div>
                <div>
                  <div className="info-label">Files queued to load</div>
                  <strong>{state.selectedDriveExports.length}</strong>
                </div>
              </div>
              <div className="drive-export-card">
                <div className="info-label">Google Drive Exports folder</div>
                <code className="path-code">{state.driveExportsPath}</code>
                {state.driveExportsBusy ? (
                  <div className="report-feedback info export-status-box">
                    <div className="loading-row">
                      <div className="spinner small-spinner" aria-hidden="true" />
                      <div>Refreshing the Google Drive export file list…</div>
                    </div>
                  </div>
                ) : driveExportsError ? (
                  <div className="report-feedback error export-status-box">
                    <h3>Could not select Drive exports</h3>
                    <p>{driveExportsError}</p>
                  </div>
                ) : (
                  <div className="export-selection-stack">
                    <p className="muted">
                      The selected month matches{' '}
                      <code>{state.selectedDriveExportTarget?.name || `${selectedMonthKey}.csv`}</code>.
                      Loading from Drive will use that file plus the nearby exports shown below.
                    </p>
                    <ExportFileNameList
                      fileNames={state.selectedDriveExports.map(file => file.name)}
                      targetFileName={state.selectedDriveExportTarget?.name}
                    />
                  </div>
                )}
                <div className="button-row">
                  <button
                    className="primary-button"
                    disabled={
                      state.driveExportsBusy ||
                      state.driveLoadBusy ||
                      state.selectedDriveExports.length < 1
                    }
                    onClick={() => void actions.loadSelectedDriveExports()}
                  >
                    {state.driveLoadBusy ? 'Loading exports…' : 'Load exports from Google Drive'}
                  </button>
                </div>
              </div>
              <div className="manual-upload-divider">Or load a ZIP manually</div>
              <div
                {...getRootProps()}
                className={`dropzone ${isDragActive ? 'active' : ''} ${isDragReject ? 'reject' : ''}`}
                onClick={open}
              >
                <input {...getInputProps()} />
                <h3>{isDragActive ? 'Drop the ZIP here' : 'Drop export ZIP here'}</h3>
                <p>
                  {isDragReject
                    ? 'Only ZIP files are accepted.'
                    : 'Use this if you want to override the Google Drive exports with a manual archive.'}
                </p>
                <button className="secondary-button" type="button">
                  Choose ZIP File
                </button>
              </div>
            </section>

            {state.exportSummary ? (
              <>
                <section ref={loadedDataRef} className="panel success-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Source data loaded</h2>
                      <p className="muted">
                        {state.exportSummary.source === 'google-drive' &&
                        state.exportSummary.requestedMonthKey
                          ? `${state.exportSummary.sourceLabel} for ${loadedDriveMonthLabel || state.exportSummary.requestedMonthKey} is ready for reporting.`
                          : `${state.exportSummary.fileName} is ready for reporting.`}
                      </p>
                    </div>
                  </div>
                  <div className="info-grid">
                    <div>
                      <div className="info-label">Source</div>
                      <strong>{state.exportSummary.sourceLabel}</strong>
                    </div>
                    <div>
                      <div className="info-label">Loaded archive</div>
                      <strong>{state.exportSummary.fileName}</strong>
                    </div>
                    <div>
                      <div className="info-label">CSV files</div>
                      <strong>{state.exportSummary.csvFileCount}</strong>
                    </div>
                    <div>
                      <div className="info-label">Transactions</div>
                      <strong>{state.exportSummary.transactionCount}</strong>
                    </div>
                    <div>
                      <div className="info-label">First transaction</div>
                      <strong>{state.exportSummary.minDateText}</strong>
                    </div>
                    <div>
                      <div className="info-label">Last transaction</div>
                      <strong>{state.exportSummary.maxDateText}</strong>
                    </div>
                  </div>
                  {state.exportSummary.sourceFiles.length > 0 ? (
                    <div className="loaded-source-files">
                      <div className="info-label">CSV files used</div>
                      <ExportFileNameList
                        fileNames={state.exportSummary.sourceFiles}
                        targetFileName={
                          state.exportSummary.source === 'google-drive' &&
                          state.exportSummary.requestedMonthKey
                            ? `${state.exportSummary.requestedMonthKey}.csv`
                            : null
                        }
                        compact
                      />
                    </div>
                  ) : null}
                  <LoadedTransactionsTable
                    transactions={state.transactions}
                    settings={state.settings}
                  />
                </section>

                <section className="panel">
                  <h2>Create report</h2>
                  <div className="summary-strip">
                    <div>
                      <div className="info-label">Selected period</div>
                      <strong>{formatMonthYearLabel(state.reportMonth, state.reportYear)}</strong>
                    </div>
                    <div>
                      <div className="info-label">Report window</div>
                      <strong>{reportWindow}</strong>
                    </div>
                    <div>
                      <div className="info-label">Transactions in window</div>
                      <strong>{selectedWindowTransactionCount}</strong>
                    </div>
                  </div>
                  {driveLoadedDataNeedsRefresh ? (
                    <div className="report-feedback info">
                      <h3>Reload Google Drive exports</h3>
                      <p>
                        The loaded Drive data is for{' '}
                        <strong>
                          {loadedDriveMonthLabel || state.exportSummary.requestedMonthKey}
                        </strong>
                        . Load the Drive exports for{' '}
                        <strong>{formatMonthYearLabel(state.reportMonth, state.reportYear)}</strong>{' '}
                        before creating this report.
                      </p>
                    </div>
                  ) : null}
                  <div className="button-row">
                    <button
                      className="primary-button"
                      disabled={state.reportBusy || state.driveLoadBusy || driveLoadedDataNeedsRefresh}
                      onClick={() => void actions.createReport()}
                    >
                      {state.reportBusy ? 'Creating report…' : 'Create Report'}
                    </button>
                    <button className="secondary-button" onClick={actions.resetLoadedExport}>
                      Clear Loaded Data
                    </button>
                  </div>
                  <div ref={reportFeedbackRef} className="report-feedback-stack">
                    {state.reportBusy ? (
                      <div className="report-feedback info">
                        Building the PDFs and preparing the ZIP download…
                      </div>
                    ) : null}
                    {state.reportError ? (
                      <div className="report-feedback error">
                        <h3>{state.reportError.title}</h3>
                        <p>{state.reportError.message}</p>
                        {state.reportError.details ? (
                          <pre className="details-box">{state.reportError.details}</pre>
                        ) : null}
                      </div>
                    ) : null}
                    {state.lastDownload ? (
                      <div className="report-feedback success">
                        <h3>Last generated download</h3>
                        <div className="info-grid compact-info-grid">
                          <div>
                            <div className="info-label">Filename</div>
                            <strong>{state.lastDownload.fileName}</strong>
                          </div>
                          <div>
                            <div className="info-label">Size</div>
                            <strong>{state.lastDownload.byteCount.toLocaleString()} bytes</strong>
                          </div>
                          <div>
                            <div className="info-label">Created</div>
                            <strong>{state.lastDownload.createdAtText}</strong>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
});
