import pkg from '../../package.json';
import debug from 'debug';
import { initializeBrowserFirebase, observeAuthState } from '@aultfarms/firebase';
import { actions } from '.';
import { firebaseConfig } from '../firebaseConfig';

const info = debug('af/manure#initialize:info');
const warn = debug('af/manure#initialize:warn');

let initialized = false;

export const initialize = async () => {
  if (initialized) {
    info('initialize() called again after startup; skipping duplicate initialization');
    return;
  }
  initialized = true;
  info('Starting manure app initialization');

  document.title = `AF/Manure - v${pkg.version}`;

  navigator.geolocation.watchPosition((position) => {
    actions.currentGPS({ lat: position.coords.latitude, lon: position.coords.longitude });
  });
  info('Started watchPosition to update GPS coordinates as they change');

  actions.online(navigator.onLine);
  info('Initial browser network state online=%s', navigator.onLine);
  window.addEventListener('online', () => {
    info('Browser reported network transition to online');
    actions.online(true);
  });
  window.addEventListener('offline', () => {
    warn('Browser reported network transition to offline');
    actions.online(false);
  });

  try {
    const services = await initializeBrowserFirebase(firebaseConfig);
    info(
      'Firebase initialized for project=%s authDomain=%s cacheMode=%s',
      services.config.projectId,
      services.config.authDomain,
      services.cacheMode,
    );
    actions.authState({
      cacheMode: services.cacheMode,
      error: '',
    });

    // Auth changes are the boundary between signed-out, denied, and hydrated app state.
    observeAuthState(async (user) => {
      info(
        'Observed auth state change in manure app email=%s verified=%s',
        user?.email || '',
        user?.emailVerified || false,
      );
      await actions.retrySessionLoad(user);
    });
  } catch (error) {
    warn('Manure app initialization failed. Error=%O', error);
    actions.loading(false);
    actions.authState({
      status: 'signed_out',
      error: `Failed to initialize Firebase: ${(error as Error).message}`,
    });
    actions.loadingError(`Failed to initialize Firebase: ${(error as Error).message}`);
  }
};
