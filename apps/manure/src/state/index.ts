import { createContext } from 'react';
import createDebug from 'debug';
import { state } from './state';
import * as actions from './actions';
import { initialize } from './initialize';

export type State = typeof state;
export type Actions = typeof actions;
export { state, actions };

export type Context = {
  state: State,
  actions: Actions,
};
export const initialContext = { state, actions };
export const context = createContext<Context>(initialContext);
const urlDebugNamespaces = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('debug')
  : null;
if (urlDebugNamespaces) {
  createDebug.enable(urlDebugNamespaces);
}

if (initialize) initialize(); // returns a promise, but we won't wait for it