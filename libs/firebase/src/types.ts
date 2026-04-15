import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  databaseURL?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
};

export type FirebaseEmulatorOptions = {
  auth?: {
    host: string;
    port: number;
  };
  firestore?: {
    host: string;
    port: number;
  };
};

export type FirebaseBrowserOptions = {
  emulators?: FirebaseEmulatorOptions;
};

export type FirebaseCacheMode = 'persistent' | 'memory';

export type FirebaseBrowserServices = {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  config: FirebaseWebConfig;
  cacheMode: FirebaseCacheMode;
};
