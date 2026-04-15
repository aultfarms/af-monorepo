import { createContext } from 'react';
import * as actions from './actions';
import { initialize } from './initialize';
import { state } from './state';

export type State = typeof state;
export type Actions = typeof actions;
export { state, actions };

export type Context = {
  state: State;
  actions: Actions;
};

export const initialContext = { state, actions };
export const context = createContext<Context>(initialContext);

if (initialize) initialize();
