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

export type FirebaseMigrationSummary = {
  version: string;
  description: string;
};

export type FirebaseMigrationStatus = {
  currentVersion: string | null;
  pendingMigrations: FirebaseMigrationSummary[];
  targetVersion: string | null;
};

export type FirebaseMigrationRunResult = FirebaseMigrationStatus & {
  appliedVersions: string[];
};

export type FirebaseMigrationLog = (message: string) => void;

export type FirebaseJsonPrimitive = string | number | boolean | null;
export type FirebaseJsonValue = FirebaseJsonPrimitive | FirebaseJsonValue[] | {
  [key: string]: FirebaseJsonValue;
};
export type FirebaseJsonObject = {
  [key: string]: FirebaseJsonValue;
};

export type FirebaseManureBackupDocument = {
  id: string;
  path: string;
  data: FirebaseJsonObject;
};

export type FirebaseManureBackupDocumentFile = {
  path: string;
  exists: boolean;
  document: FirebaseManureBackupDocument | null;
};

export type FirebaseManureBackupCollectionFile = {
  path: string;
  documents: FirebaseManureBackupDocument[];
};

export type FirebaseManureBackupFile = {
  path: string;
  content: FirebaseJsonObject;
};

export type FirebaseManureBackupManifest = {
  format: 'aultfarms.manure.backup';
  formatVersion: 1;
  createdAt: string;
  projectId: string;
  appVersion: string;
  adminEmail: string;
  currentVersion: string | null;
  targetVersion: string | null;
  pendingVersions: string[];
  filePaths: string[];
  collectionPaths: string[];
  yearIds: string[];
};

export type FirebaseManureBackupPayload = {
  manifest: FirebaseManureBackupManifest;
  files: FirebaseManureBackupFile[];
};

export type FirebaseManureBackupOptions = {
  appVersion: string;
  adminEmail: string;
  targetVersion?: string;
  log?: FirebaseMigrationLog;
};

export type FirebaseManureRestoreOptions = {
  allowProjectMismatch?: boolean;
  log?: FirebaseMigrationLog;
};

export type FirebaseManureRestoreResult = {
  restoredCollections: number;
  restoredDocuments: number;
  deletedDocuments: number;
  restoredYearIds: string[];
  restoredModelVersion: string | null;
};
