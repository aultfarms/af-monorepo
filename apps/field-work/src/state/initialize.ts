import pkg from '../../package.json';
import { loadBoard, setTrelloAuthorized, trello, loading, loadingError } from './actions';
import { state } from './state';
import * as trellolib from '@aultfarms/trello';
import debug from 'debug';

const info = debug('af/field-work#initialize:info');

let initialized = false;

export const initialize = async () => {
  if (initialized) {
    return;
  }
  initialized = true;

  document.title = `AF/Field Work - v${pkg.version}`;

  info('Checking Trello authorization');
  const authorized = await trellolib.checkAuthorization();
  if (!authorized) {
    loading(false);
    setTrelloAuthorized(false);
    return;
  }

  try {
    await trello();
    setTrelloAuthorized(true);
    await loadBoard();
  } catch (error) {
    setTrelloAuthorized(false);
    loading(false);
    loadingError(`Unable to initialize Field Work: ${(error as Error).message}`);
  }

  if (!state.board) {
    loading(false);
  }
};
