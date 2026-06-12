import pkg from '../../package.json';
import {
  clearTrelloDiagnostics,
  loadTrelloDiagnostics,
  setTrelloAuthorized,
  trello,
  loading,
  loadingError,
  maybeAutoRefreshBoard,
  refreshBoard,
} from './actions';
import { state } from './state';
import * as trellolib from '@aultfarms/trello';
import debug from 'debug';

const info = debug('af/field-work#initialize:info');
const AUTO_REFRESH_POLL_MS = 60 * 1000;

let initialized = false;
let autoRefreshRegistered = false;

function registerAutoRefreshHandlers(): void {
  if (autoRefreshRegistered || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  autoRefreshRegistered = true;

  const checkForRefresh = () => {
    void maybeAutoRefreshBoard();
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForRefresh();
    }
  });
  window.addEventListener('focus', checkForRefresh);
  window.setInterval(checkForRefresh, AUTO_REFRESH_POLL_MS);
}

export const initialize = async () => {
  if (initialized) {
    return;
  }
  initialized = true;

  document.title = `AF/Field Work - v${pkg.version}`;
  registerAutoRefreshHandlers();

  info('Checking Trello authorization');
  const authorized = await trellolib.checkAuthorization();
  if (!authorized) {
    loading(false);
    setTrelloAuthorized(false);
    clearTrelloDiagnostics();
    return;
  }

  try {
    await trello();
    setTrelloAuthorized(true);
    clearTrelloDiagnostics();
    await refreshBoard('startup');
    if (!state.board) {
      setTrelloAuthorized(false);
      await loadTrelloDiagnostics();
      return;
    }
  } catch (error) {
    setTrelloAuthorized(false);
    loading(false);
    loadingError(`Unable to initialize Field Work: ${(error as Error).message}`);
    await loadTrelloDiagnostics();
  }

  if (!state.board) {
    loading(false);
  }
};
