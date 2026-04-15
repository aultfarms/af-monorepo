import { getApp, getApps, initializeApp } from 'firebase/app';
import debug from 'debug';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  setLogLevel,
} from 'firebase/firestore';
import type { FirebaseBrowserOptions, FirebaseBrowserServices, FirebaseWebConfig } from './types.js';
const info = debug('af/firebase:info');
const warn = debug('af/firebase:warn');

let browserServices: FirebaseBrowserServices | null = null;
let browserServicesPromise: Promise<FirebaseBrowserServices> | null = null;
let emulatorsConnected = false;

function browserDebugNamespaces(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem('debug') || '';
  } catch (_error) {
    return '';
  }
}

function shouldEnableFirestoreSdkDebugLogging(): boolean {
  const namespaces = browserDebugNamespaces();
  return namespaces.includes('af/firebase') || namespaces.includes('af/*') || namespaces === '*';
}

function connectEmulators(services: FirebaseBrowserServices, options?: FirebaseBrowserOptions): void {
  if (emulatorsConnected || !options?.emulators) {
    return;
  }

  if (options.emulators.auth) {
    info(
      'Connecting Firebase Auth emulator at %s:%d',
      options.emulators.auth.host,
      options.emulators.auth.port,
    );
    connectAuthEmulator(
      services.auth,
      `http://${options.emulators.auth.host}:${options.emulators.auth.port}`,
      { disableWarnings: true },
    );
  }

  if (options.emulators.firestore) {
    info(
      'Connecting Firestore emulator at %s:%d',
      options.emulators.firestore.host,
      options.emulators.firestore.port,
    );
    connectFirestoreEmulator(
      services.firestore,
      options.emulators.firestore.host,
      options.emulators.firestore.port,
    );
  }

  emulatorsConnected = true;
}

export async function initializeBrowserFirebase(
  config: FirebaseWebConfig,
  options?: FirebaseBrowserOptions,
): Promise<FirebaseBrowserServices> {
  info(
    'initializeBrowserFirebase called for project=%s authDomain=%s',
    config.projectId,
    config.authDomain,
  );
  if (browserServices) {
    info('Returning previously initialized Firebase browser services for project=%s', browserServices.config.projectId);
    return browserServices;
  }

  if (browserServicesPromise) {
    info('Firebase browser initialization is already in progress for project=%s', config.projectId);
    return browserServicesPromise;
  }

  browserServicesPromise = (async () => {
    const reusingExistingApp = getApps().length > 0;
    const app = reusingExistingApp ? getApp() : initializeApp(config);
    info(
      '%s Firebase app instance name=%s project=%s',
      reusingExistingApp ? 'Reusing' : 'Created',
      app.name,
      config.projectId,
    );

    if (shouldEnableFirestoreSdkDebugLogging()) {
      setLogLevel('debug');
      info('Enabled Firestore SDK internal debug logging because debug namespaces are enabled (%s)', browserDebugNamespaces());
    } else {
      setLogLevel('error');
    }

    let firestore;
    let cacheMode: FirebaseBrowserServices['cacheMode'] = 'persistent';
    try {
      // Persistent cache is the default path for manure so offline reloads work.
      firestore = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
      info('Initialized Firestore with persistent local cache for project=%s', config.projectId);
    } catch (_error) {
      cacheMode = 'memory';
      warn('Persistent Firestore cache initialization failed. Falling back to memory cache. Error=%O', _error);
      firestore = initializeFirestore(app, {
        localCache: memoryLocalCache(),
      });
      info('Initialized Firestore with in-memory cache for project=%s', config.projectId);
    }

    const auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    info('Configured Firebase Auth browserLocalPersistence for project=%s', config.projectId);

    const services: FirebaseBrowserServices = {
      app,
      auth,
      firestore,
      config,
      cacheMode,
    };

    connectEmulators(services, options);
    browserServices = services;
    info('Firebase browser services ready for project=%s cacheMode=%s', config.projectId, cacheMode);
    return services;
  })().catch((error) => {
    warn('Firebase browser initialization failed for project=%s. Error=%O', config.projectId, error);
    browserServicesPromise = null;
    throw error;
  });

  return browserServicesPromise;
}

export function getBrowserFirebase(): FirebaseBrowserServices {
  if (!browserServices) {
    throw new Error('Firebase has not been initialized. Call initializeBrowserFirebase() first.');
  }

  return browserServices;
}

export async function signInWithGoogle(): Promise<User> {
  info('Starting Google sign-in popup flow');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const { auth } = getBrowserFirebase();
  try {
    const result = await signInWithPopup(auth, provider);
    info(
      'Google sign-in completed for email=%s verified=%s',
      result.user.email || '',
      result.user.emailVerified,
    );
    return result.user;
  } catch (error) {
    warn('Google sign-in popup flow failed. Error=%O', error);
    throw error;
  }
}

export async function signOutBrowserUser(): Promise<void> {
  const { auth } = getBrowserFirebase();
  info('Signing out Firebase user email=%s', auth.currentUser?.email || '');
  try {
    await signOut(auth);
    info('Firebase sign-out completed');
  } catch (error) {
    warn('Firebase sign-out failed. Error=%O', error);
    throw error;
  }
}

export function observeAuthState(listener: (user: User | null) => void): () => void {
  const { auth } = getBrowserFirebase();
  info('Registering Firebase auth state observer');
  return onAuthStateChanged(
    auth,
    (user) => {
      info(
        'Firebase auth state changed: email=%s verified=%s anonymous=%s',
        user?.email || '',
        user?.emailVerified || false,
        user?.isAnonymous || false,
      );
      listener(user);
    },
    (error) => {
      warn('Firebase auth state observer received an error. Error=%O', error);
    },
  );
}

export function getCurrentUser(): User | null {
  const { auth } = getBrowserFirebase();
  return auth.currentUser;
}
