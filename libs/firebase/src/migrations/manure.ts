import debug from 'debug';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getBrowserFirebase } from '../browser.js';
import type {
  FirebaseMigrationLog,
  FirebaseMigrationRunResult,
  FirebaseMigrationStatus,
  FirebaseMigrationSummary,
  FirebaseJsonObject,
  FirebaseJsonValue,
  FirebaseManureBackupCollectionFile,
  FirebaseManureBackupDocument,
  FirebaseManureBackupDocumentFile,
  FirebaseManureBackupFile,
  FirebaseManureBackupManifest,
  FirebaseManureBackupOptions,
  FirebaseManureBackupPayload,
  FirebaseManureRestoreOptions,
  FirebaseManureRestoreResult,
} from '../types.js';

const info = debug('af/firebase:migrations:manure:info');
const warn = debug('af/firebase:migrations:manure:warn');

const MANURE_METADATA_COLLECTION = 'manureMeta';
const MANURE_METADATA_DOC = 'model';
const MANURE_MODEL_VERSION_FIELD = 'model_version';
const MANURE_YEARS_COLLECTION = 'manureYears';
const LEGACY_LOADS_COLLECTION = 'loads';
const LOAD_EVENTS_COLLECTION = 'loadEvents';
const REGIONS_COLLECTION = 'regions';
const REGION_ASSIGNMENTS_COLLECTION = 'regionAssignments';
const WRITE_BATCH_LIMIT = 400;
const MANURE_BACKUP_FORMAT = 'aultfarms.manure.backup';
const MANURE_BACKUP_FORMAT_VERSION = 1;
const YEAR_BACKUP_COLLECTIONS = [
  'fields',
  'sources',
  'drivers',
  LEGACY_LOADS_COLLECTION,
  LOAD_EVENTS_COLLECTION,
  REGIONS_COLLECTION,
  REGION_ASSIGNMENTS_COLLECTION,
] as const;

type RegisteredManureMigration = FirebaseMigrationSummary & {
  run: (context: ManureMigrationContext) => Promise<void>;
};

type ManureMigrationContext = {
  firestore: Firestore;
  log: FirebaseMigrationLog;
};

type LegacyLoadDocument = {
  date?: unknown;
  field?: unknown;
  source?: unknown;
  driver?: unknown;
  loads?: unknown;
  geojson?: {
    type?: unknown;
    features?: unknown;
  };
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: unknown;
};

type LegacyRegionAssignmentDocument = {
  regionId?: unknown;
  loadGroupKey?: unknown;
  loadCount?: unknown;
};

type ExpandedLoadEvent = {
  id: string;
  groupKey: string;
  timestamp: string;
  driver: string;
  data: DocumentData;
};

type ExistingLoadEvent = {
  id: string;
  groupKey: string;
  timestamp: string;
  driver: string;
};

type RegionMigrationState = {
  id: string;
  loadIds: string[];
};

type SnapshotLike = {
  id: string;
  ref: {
    path: string;
  };
  data: () => DocumentData | undefined;
};

function firestore() {
  return getBrowserFirebase().firestore;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => typeof entryValue !== 'undefined'),
  ) as T;
}

function manureMetadataDocRef(firestoreInstance: Firestore) {
  return doc(firestoreInstance, MANURE_METADATA_COLLECTION, MANURE_METADATA_DOC);
}

function manureYearDocRef(firestoreInstance: Firestore, yearId: string) {
  return doc(firestoreInstance, MANURE_YEARS_COLLECTION, yearId);
}

function manureYearCollectionRef(firestoreInstance: Firestore, yearId: string, name: string) {
  return collection(manureYearDocRef(firestoreInstance, yearId), name);
}

function manureYearCollectionPath(yearId: string, name: string): string {
  return `${MANURE_YEARS_COLLECTION}/${yearId}/${name}`;
}

function backupLog(options: { log?: FirebaseMigrationLog } | undefined, message: string): void {
  options?.log?.(message);
}

function backupFileNameForCollectionPath(collectionPath: string): string {
  if (collectionPath === MANURE_YEARS_COLLECTION) {
    return `${MANURE_YEARS_COLLECTION}/index.json`;
  }

  return `${collectionPath}.json`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toJsonSafeValue(value: unknown, path: string): FirebaseJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot back up non-finite number at ${path}.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => toJsonSafeValue(entry, `${path}[${index}]`));
  }
  if (typeof value === 'undefined') {
    throw new Error(`Cannot back up undefined value at ${path}.`);
  }
  if (typeof value !== 'object') {
    throw new Error(`Cannot back up unsupported ${typeof value} value at ${path}.`);
  }

  const maybeTimestamp = value as {
    seconds?: unknown;
    nanoseconds?: unknown;
    toDate?: unknown;
  };
  if (
    typeof maybeTimestamp.seconds === 'number'
    && typeof maybeTimestamp.nanoseconds === 'number'
    && typeof maybeTimestamp.toDate === 'function'
  ) {
    return {
      __firestoreType: 'Timestamp',
      seconds: maybeTimestamp.seconds,
      nanoseconds: maybeTimestamp.nanoseconds,
    };
  }

  if (!isPlainObject(value)) {
    throw new Error(`Cannot back up unsupported object at ${path}.`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      toJsonSafeValue(entryValue, `${path}.${key}`),
    ]),
  );
}

function toJsonSafeObject(value: DocumentData, path: string): FirebaseJsonObject {
  const jsonValue = toJsonSafeValue(value, path);
  if (!isPlainObject(jsonValue)) {
    throw new Error(`Expected backed-up document data at ${path} to be an object.`);
  }
  return jsonValue as FirebaseJsonObject;
}

function fromJsonSafeValue(value: FirebaseJsonValue): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(fromJsonSafeValue);
  }

  if (
    value.__firestoreType === 'Timestamp'
    && typeof value.seconds === 'number'
    && typeof value.nanoseconds === 'number'
  ) {
    return new Timestamp(value.seconds, value.nanoseconds);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [ key, fromJsonSafeValue(entryValue) ]),
  );
}

function fromJsonSafeObject(value: FirebaseJsonObject): DocumentData {
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [ key, fromJsonSafeValue(entryValue) ]),
  );
}

function backupDocument(snapshot: SnapshotLike): FirebaseManureBackupDocument {
  return {
    id: snapshot.id,
    path: snapshot.ref.path,
    data: toJsonSafeObject(snapshot.data() || {}, snapshot.ref.path),
  };
}

async function backupDocumentFile(
  firestoreInstance: Firestore,
  documentPath: string,
): Promise<FirebaseManureBackupDocumentFile> {
  const snapshot = await getDoc(doc(firestoreInstance, documentPath));
  return {
    path: documentPath,
    exists: snapshot.exists(),
    document: snapshot.exists()
      ? backupDocument(snapshot as SnapshotLike)
      : null,
  };
}

async function backupCollectionFile(
  firestoreInstance: Firestore,
  collectionPath: string,
): Promise<FirebaseManureBackupCollectionFile> {
  const snapshot = await getDocs(collection(firestoreInstance, collectionPath));
  return {
    path: collectionPath,
    documents: snapshot.docs
      .map(backupDocument)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function isFirebaseJsonObject(value: unknown): value is FirebaseJsonObject {
  return isPlainObject(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
    ? value
    : null;
}

function validateBackupManifest(value: unknown): FirebaseManureBackupManifest {
  if (!isFirebaseJsonObject(value)) {
    throw new Error('Backup manifest must be an object.');
  }
  if (value.format !== MANURE_BACKUP_FORMAT) {
    throw new Error('Backup manifest is not a manure backup.');
  }
  if (value.formatVersion !== MANURE_BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported manure backup format version: ${String(value.formatVersion)}.`);
  }

  const filePaths = stringArray(value.filePaths);
  const collectionPaths = stringArray(value.collectionPaths);
  const yearIds = stringArray(value.yearIds);
  const pendingVersions = stringArray(value.pendingVersions);
  if (!filePaths || !collectionPaths || !yearIds || !pendingVersions) {
    throw new Error('Backup manifest contains invalid path or version arrays.');
  }
  if (
    typeof value.createdAt !== 'string'
    || typeof value.projectId !== 'string'
    || typeof value.appVersion !== 'string'
    || typeof value.adminEmail !== 'string'
    || !(typeof value.currentVersion === 'string' || value.currentVersion === null)
    || !(typeof value.targetVersion === 'string' || value.targetVersion === null)
  ) {
    throw new Error('Backup manifest contains invalid metadata fields.');
  }

  return {
    format: MANURE_BACKUP_FORMAT,
    formatVersion: MANURE_BACKUP_FORMAT_VERSION,
    createdAt: value.createdAt,
    projectId: value.projectId,
    appVersion: value.appVersion,
    adminEmail: value.adminEmail,
    currentVersion: value.currentVersion,
    targetVersion: value.targetVersion,
    pendingVersions,
    filePaths,
    collectionPaths,
    yearIds,
  };
}

function validateBackupDocument(value: unknown, collectionPath: string): FirebaseManureBackupDocument {
  if (!isFirebaseJsonObject(value)) {
    throw new Error(`Backup document in ${collectionPath} must be an object.`);
  }
  if (typeof value.id !== 'string' || typeof value.path !== 'string' || !isFirebaseJsonObject(value.data)) {
    throw new Error(`Backup document in ${collectionPath} is malformed.`);
  }
  const expectedPathPrefix = `${collectionPath}/`;
  if (!value.path.startsWith(expectedPathPrefix)) {
    throw new Error(`Backup document path ${value.path} is outside expected collection ${collectionPath}.`);
  }
  if (value.id.includes('/')) {
    throw new Error(`Backup document id ${value.id} is invalid.`);
  }

  return {
    id: value.id,
    path: value.path,
    data: value.data,
  };
}

function validateCollectionFile(value: unknown, expectedPath: string): FirebaseManureBackupCollectionFile {
  if (!isFirebaseJsonObject(value)) {
    throw new Error(`Backup file for ${expectedPath} must be an object.`);
  }
  if (value.path !== expectedPath || !Array.isArray(value.documents)) {
    throw new Error(`Backup file for ${expectedPath} is malformed.`);
  }

  return {
    path: expectedPath,
    documents: value.documents.map(documentValue => validateBackupDocument(documentValue, expectedPath)),
  };
}

function validateDocumentFile(value: unknown, expectedPath: string): FirebaseManureBackupDocumentFile {
  if (!isFirebaseJsonObject(value)) {
    throw new Error(`Backup file for ${expectedPath} must be an object.`);
  }
  if (value.path !== expectedPath || typeof value.exists !== 'boolean') {
    throw new Error(`Backup file for ${expectedPath} is malformed.`);
  }
  if (!value.exists) {
    return {
      path: expectedPath,
      exists: false,
      document: null,
    };
  }
  if (!value.document) {
    throw new Error(`Backup file for ${expectedPath} is missing document data.`);
  }

  return {
    path: expectedPath,
    exists: true,
    document: validateBackupDocument(value.document, MANURE_METADATA_COLLECTION),
  };
}

function filesByPath(payload: FirebaseManureBackupPayload): Map<string, FirebaseManureBackupFile> {
  return new Map(payload.files.map(file => [ file.path, file ]));
}

function requiredBackupFile(
  payloadFilesByPath: Map<string, FirebaseManureBackupFile>,
  path: string,
): FirebaseManureBackupFile {
  const file = payloadFilesByPath.get(path);
  if (!file) {
    throw new Error(`Backup is missing ${path}.`);
  }
  return file;
}

async function deleteCollectionDocuments(
  firestoreInstance: Firestore,
  collectionPath: string,
): Promise<number> {
  const snapshot = await getDocs(collection(firestoreInstance, collectionPath));
  if (snapshot.empty) {
    return 0;
  }

  let deleted = 0;
  for (let index = 0; index < snapshot.docs.length; index += WRITE_BATCH_LIMIT) {
    const batch = writeBatch(firestoreInstance);
    for (const documentSnapshot of snapshot.docs.slice(index, index + WRITE_BATCH_LIMIT)) {
      batch.delete(documentSnapshot.ref);
      deleted += 1;
    }
    await batch.commit();
  }

  return deleted;
}

async function setCollectionDocuments(
  firestoreInstance: Firestore,
  collectionPath: string,
  documents: FirebaseManureBackupDocument[],
): Promise<number> {
  if (documents.length < 1) {
    return 0;
  }

  let restored = 0;
  for (let index = 0; index < documents.length; index += WRITE_BATCH_LIMIT) {
    const batch = writeBatch(firestoreInstance);
    for (const backup of documents.slice(index, index + WRITE_BATCH_LIMIT)) {
      batch.set(doc(firestoreInstance, `${collectionPath}/${backup.id}`), fromJsonSafeObject(backup.data));
      restored += 1;
    }
    await batch.commit();
  }

  return restored;
}

function currentProjectId(): string {
  return getBrowserFirebase().config.projectId;
}

function normalizeGroupKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'blank';
}

function createLoadGroupKey(load: { date: string; field: string; source: string }): string {
  return [
    load.date,
    normalizeGroupKeyPart(load.field),
    normalizeGroupKeyPart(load.source),
  ].join('__');
}

function uniqueStrings(values: string[]): string[] {
  return [ ...new Set(values.filter(Boolean)) ];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function toNumericVersionPart(value: string): number | string {
  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : value;
}

export function compareSemverVersions(left: string, right: string): number {
  const normalize = (value: string) => {
    const [coreWithOptionalBuild] = value.split('+');
    const [core, prerelease = ''] = (coreWithOptionalBuild || '').split('-');
    return {
      core: (core || '0').split('.').map(part => Number.parseInt(part || '0', 10)),
      prerelease: prerelease
        ? prerelease.split('.').map(toNumericVersionPart)
        : [],
    };
  };

  const leftVersion = normalize(left);
  const rightVersion = normalize(right);
  const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const leftPart = leftVersion.core[index] || 0;
    const rightPart = rightVersion.core[index] || 0;
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }

  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) {
    return 0;
  }
  if (leftVersion.prerelease.length === 0) {
    return 1;
  }
  if (rightVersion.prerelease.length === 0) {
    return -1;
  }

  const prereleaseLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (typeof leftPart === 'undefined') {
      return -1;
    }
    if (typeof rightPart === 'undefined') {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart < rightPart ? -1 : 1;
    }
    if (typeof leftPart === 'number') {
      return -1;
    }
    if (typeof rightPart === 'number') {
      return 1;
    }
    return leftPart.localeCompare(rightPart);
  }

  return 0;
}

function compareWithNullableCurrentVersion(version: string, currentVersion: string | null): number {
  if (!currentVersion) {
    return 1;
  }

  return compareSemverVersions(version, currentVersion);
}

function relevantManureMigrations(targetVersion?: string): RegisteredManureMigration[] {
  return MANURE_MIGRATIONS
    .filter(migration => !targetVersion || compareSemverVersions(migration.version, targetVersion) <= 0)
    .sort((left, right) => compareSemverVersions(left.version, right.version));
}

function pendingManureMigrations(currentVersion: string | null, targetVersion?: string): RegisteredManureMigration[] {
  return relevantManureMigrations(targetVersion)
    .filter(migration => compareWithNullableCurrentVersion(migration.version, currentVersion) > 0);
}

function sortYears(
  snapshots: QueryDocumentSnapshot<DocumentData>[],
): QueryDocumentSnapshot<DocumentData>[] {
  return [ ...snapshots ].sort((left, right) => left.id.localeCompare(right.id));
}

function sortExpandedLoadEvents(loads: Array<ExpandedLoadEvent | ExistingLoadEvent>): Array<ExpandedLoadEvent | ExistingLoadEvent> {
  return [ ...loads ].sort((left, right) => {
    const byGroup = left.groupKey.localeCompare(right.groupKey);
    if (byGroup !== 0) return byGroup;
    const byTimestamp = left.timestamp.localeCompare(right.timestamp);
    if (byTimestamp !== 0) return byTimestamp;
    const byDriver = left.driver.localeCompare(right.driver);
    if (byDriver !== 0) return byDriver;
    return left.id.localeCompare(right.id);
  });
}

function asPointFeature(value: unknown): DocumentData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const feature = value as {
    type?: unknown;
    geometry?: {
      type?: unknown;
      coordinates?: unknown;
    };
  };
  if (feature.type !== 'Feature' || !feature.geometry || feature.geometry.type !== 'Point') {
    return null;
  }
  if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length !== 2) {
    return null;
  }

  const [longitude, latitude] = feature.geometry.coordinates;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }

  return {
    type: 'Feature',
    properties: null,
    geometry: {
      type: 'Point',
      coordinates: [ longitude, latitude ],
    },
  };
}

function expandLegacyLoadSnapshot(
  snapshot: QueryDocumentSnapshot<DocumentData>,
  log: FirebaseMigrationLog,
): ExpandedLoadEvent[] {
  const data = snapshot.data() as LegacyLoadDocument;
  const date = typeof data.date === 'string' ? data.date : '';
  const field = typeof data.field === 'string' ? data.field : '';
  const source = typeof data.source === 'string' ? data.source : '';
  const driver = typeof data.driver === 'string' ? data.driver : '';
  if (!date || !field || !source || !driver) {
    log(`Skipping malformed legacy load ${snapshot.ref.path}; missing date, field, source, or driver.`);
    return [];
  }

  const rawFeatures = Array.isArray(data.geojson?.features) ? data.geojson?.features : [];
  const pointFeatures = (rawFeatures || [])
    .map(asPointFeature)
    .filter((feature): feature is DocumentData => !!feature);
  const loadCountValue = typeof data.loads === 'number' && Number.isFinite(data.loads)
    ? Math.max(1, Math.round(data.loads))
    : Math.max(pointFeatures.length, 1);
  if (pointFeatures.length > 0 && pointFeatures.length !== loadCountValue) {
    log(
      `Legacy load ${snapshot.id} has ${pointFeatures.length} recorded point${pointFeatures.length === 1 ? '' : 's'} for ${loadCountValue} load${loadCountValue === 1 ? '' : 's'}; migration will reuse the closest available point for missing entries.`,
    );
  }
  if (pointFeatures.length < 1) {
    log(`Legacy load ${snapshot.id} has no usable GPS points; migrated load events will keep empty point collections.`);
  }

  const timestamp = firstString(data.updatedAt, data.createdAt, `${date}T12:00:00.000Z`) || nowIso();
  const actor = firstString(data.updatedBy, 'migration') || 'migration';
  const groupKey = createLoadGroupKey({ date, field, source });
  const createdAt = firstString(data.createdAt, timestamp) || timestamp;
  const updatedAt = firstString(data.updatedAt, timestamp) || timestamp;

  return Array.from({ length: loadCountValue }, (_unused, index) => {
    const feature = pointFeatures[index] || pointFeatures[pointFeatures.length - 1];
    return {
      id: `${snapshot.id}__${String(index + 1).padStart(4, '0')}`,
      groupKey,
      timestamp,
      driver,
      data: stripUndefined({
        timestamp,
        loggedBy: actor,
        legacyLoadRecordId: snapshot.id,
        date,
        field,
        source,
        loads: 1,
        driver,
        geojson: {
          type: 'FeatureCollection',
          features: feature ? [ feature ] : [],
        },
        createdAt,
        updatedAt,
        updatedBy: actor,
      }),
    };
  });
}

function readExistingLoadEvent(snapshot: QueryDocumentSnapshot<DocumentData>): ExistingLoadEvent | null {
  const data = snapshot.data() as {
    date?: unknown;
    field?: unknown;
    source?: unknown;
    driver?: unknown;
    timestamp?: unknown;
    createdAt?: unknown;
  };
  if (
    typeof data.date !== 'string'
    || typeof data.field !== 'string'
    || typeof data.source !== 'string'
    || typeof data.driver !== 'string'
  ) {
    return null;
  }

  return {
    id: snapshot.id,
    groupKey: createLoadGroupKey({
      date: data.date,
      field: data.field,
      source: data.source,
    }),
    timestamp: firstString(data.timestamp, data.createdAt, '') || '',
    driver: data.driver,
  };
}

function parseLegacyRegionAssignment(snapshot: QueryDocumentSnapshot<DocumentData>): {
  regionId: string;
  loadGroupKey: string;
  loadCount: number;
} | null {
  const data = snapshot.data() as LegacyRegionAssignmentDocument;
  if (typeof data.regionId !== 'string' || typeof data.loadGroupKey !== 'string') {
    return null;
  }
  if (typeof data.loadCount !== 'number' || !Number.isFinite(data.loadCount) || data.loadCount <= 0) {
    return null;
  }

  return {
    regionId: data.regionId,
    loadGroupKey: data.loadGroupKey,
    loadCount: Math.round(data.loadCount),
  };
}

async function writeLoadEvents(
  firestoreInstance: Firestore,
  yearId: string,
  loads: ExpandedLoadEvent[],
): Promise<void> {
  if (loads.length < 1) {
    return;
  }

  for (let index = 0; index < loads.length; index += WRITE_BATCH_LIMIT) {
    const batch = writeBatch(firestoreInstance);
    for (const load of loads.slice(index, index + WRITE_BATCH_LIMIT)) {
      batch.set(
        doc(manureYearCollectionRef(firestoreInstance, yearId, LOAD_EVENTS_COLLECTION), load.id),
        load.data,
        { merge: true },
      );
    }
    await batch.commit();
  }
}

async function writeRegionLoadIds(
  firestoreInstance: Firestore,
  yearId: string,
  updates: RegionMigrationState[],
): Promise<void> {
  if (updates.length < 1) {
    return;
  }

  const timestamp = nowIso();
  for (let index = 0; index < updates.length; index += WRITE_BATCH_LIMIT) {
    const batch = writeBatch(firestoreInstance);
    for (const update of updates.slice(index, index + WRITE_BATCH_LIMIT)) {
      batch.set(
        doc(manureYearCollectionRef(firestoreInstance, yearId, REGIONS_COLLECTION), update.id),
        {
          loadIds: update.loadIds,
          updatedAt: timestamp,
          updatedBy: 'migration',
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}

async function migrateManureYearToLoadEvents(
  firestoreInstance: Firestore,
  yearId: string,
  log: FirebaseMigrationLog,
): Promise<void> {
  const [legacyLoadSnapshot, existingLoadEventSnapshot, regionSnapshot, assignmentSnapshot] = await Promise.all([
    getDocs(manureYearCollectionRef(firestoreInstance, yearId, LEGACY_LOADS_COLLECTION)),
    getDocs(manureYearCollectionRef(firestoreInstance, yearId, LOAD_EVENTS_COLLECTION)),
    getDocs(manureYearCollectionRef(firestoreInstance, yearId, REGIONS_COLLECTION)),
    getDocs(manureYearCollectionRef(firestoreInstance, yearId, REGION_ASSIGNMENTS_COLLECTION)),
  ]);

  log(
    `Year ${yearId}: ${legacyLoadSnapshot.size} legacy load record${legacyLoadSnapshot.size === 1 ? '' : 's'}, ${regionSnapshot.size} region${regionSnapshot.size === 1 ? '' : 's'}, ${assignmentSnapshot.size} legacy region assignment${assignmentSnapshot.size === 1 ? '' : 's'}.`,
  );

  const expandedLoads = legacyLoadSnapshot.docs.flatMap(snapshot => expandLegacyLoadSnapshot(snapshot, log));
  const existingLoads = existingLoadEventSnapshot.docs
    .map(readExistingLoadEvent)
    .filter((load): load is ExistingLoadEvent => !!load);
  const allLoadsById = new Map<string, ExpandedLoadEvent | ExistingLoadEvent>();
  for (const load of [ ...existingLoads, ...expandedLoads ]) {
    allLoadsById.set(load.id, load);
  }

  await writeLoadEvents(firestoreInstance, yearId, expandedLoads);
  if (expandedLoads.length > 0) {
    log(`Year ${yearId}: ensured ${expandedLoads.length} load event document${expandedLoads.length === 1 ? '' : 's'} in ${LOAD_EVENTS_COLLECTION}.`);
  }

  const sortedAllLoads = sortExpandedLoadEvents([ ...allLoadsById.values() ]);
  const loadIdsByGroupKey = new Map<string, string[]>();
  for (const load of sortedAllLoads) {
    const existing = loadIdsByGroupKey.get(load.groupKey) || [];
    existing.push(load.id);
    loadIdsByGroupKey.set(load.groupKey, existing);
  }

  const regionsById = new Map<string, RegionMigrationState>();
  for (const snapshot of regionSnapshot.docs) {
    const data = snapshot.data() as { loadIds?: unknown };
    const loadIds = Array.isArray(data.loadIds)
      ? uniqueStrings(data.loadIds.filter((loadId): loadId is string => typeof loadId === 'string'))
      : [];
    regionsById.set(snapshot.id, {
      id: snapshot.id,
      loadIds,
    });
  }

  const consumedLoadIds = new Set<string>();
  for (const region of regionsById.values()) {
    for (const loadId of region.loadIds) {
      if (allLoadsById.has(loadId)) {
        consumedLoadIds.add(loadId);
      }
    }
  }

  const assignments = assignmentSnapshot.docs
    .map(parseLegacyRegionAssignment)
    .filter((assignment): assignment is NonNullable<ReturnType<typeof parseLegacyRegionAssignment>> => !!assignment)
    .sort((left, right) => {
      const byGroup = left.loadGroupKey.localeCompare(right.loadGroupKey);
      if (byGroup !== 0) return byGroup;
      return left.regionId.localeCompare(right.regionId);
    });

  const changedRegions = new Map<string, RegionMigrationState>();
  for (const assignment of assignments) {
    const region = regionsById.get(assignment.regionId);
    if (!region) {
      log(`Year ${yearId}: skipping legacy assignment for missing region ${assignment.regionId}.`);
      continue;
    }

    const currentGroupLoadIds = region.loadIds.filter(loadId => allLoadsById.get(loadId)?.groupKey === assignment.loadGroupKey);
    const remainingNeeded = Math.max(assignment.loadCount - currentGroupLoadIds.length, 0);
    if (remainingNeeded < 1) {
      continue;
    }

    const selectedLoadIds = (loadIdsByGroupKey.get(assignment.loadGroupKey) || [])
      .filter(loadId => !consumedLoadIds.has(loadId))
      .slice(0, remainingNeeded);
    if (selectedLoadIds.length < remainingNeeded) {
      log(
        `Year ${yearId}: only found ${currentGroupLoadIds.length + selectedLoadIds.length} of ${assignment.loadCount} load IDs needed for region ${assignment.regionId} and load group ${assignment.loadGroupKey}.`,
      );
    }
    if (selectedLoadIds.length < 1) {
      continue;
    }

    region.loadIds = uniqueStrings([ ...region.loadIds, ...selectedLoadIds ]);
    changedRegions.set(region.id, region);
    for (const loadId of selectedLoadIds) {
      consumedLoadIds.add(loadId);
    }
  }

  await writeRegionLoadIds(firestoreInstance, yearId, [ ...changedRegions.values() ]);
  if (changedRegions.size > 0) {
    log(`Year ${yearId}: updated ${changedRegions.size} region${changedRegions.size === 1 ? '' : 's'} with migrated loadIds.`);
  }
}

async function migrateLegacyManureLoadModel(context: ManureMigrationContext): Promise<void> {
  const yearSnapshots = sortYears((await getDocs(collection(context.firestore, MANURE_YEARS_COLLECTION))).docs);
  if (yearSnapshots.length < 1) {
    context.log('No manure year documents were found. Nothing to migrate.');
    return;
  }

  context.log(`Preparing manure migration across ${yearSnapshots.length} year${yearSnapshots.length === 1 ? '' : 's'}.`);
  for (const yearSnapshot of yearSnapshots) {
    await migrateManureYearToLoadEvents(context.firestore, yearSnapshot.id, context.log);
  }
}

const MANURE_MIGRATIONS: RegisteredManureMigration[] = [
  {
    version: '0.0.4',
    description: 'Expand legacy manure load counters into loadEvents and store region membership as loadIds.',
    run: migrateLegacyManureLoadModel,
  },
];

export async function createManureBackupPayload(
  options: FirebaseManureBackupOptions,
): Promise<FirebaseManureBackupPayload> {
  const firestoreInstance = firestore();
  const status = await getManureMigrationStatus(options.targetVersion);
  const pendingVersions = status.pendingMigrations.map(migration => migration.version);
  const filesWithoutManifest: FirebaseManureBackupFile[] = [];
  const collectionPaths: string[] = [];

  backupLog(options, 'Reading manure model metadata for backup.');
  const metadataFile = await backupDocumentFile(
    firestoreInstance,
    `${MANURE_METADATA_COLLECTION}/${MANURE_METADATA_DOC}`,
  );
  filesWithoutManifest.push({
    path: `${MANURE_METADATA_COLLECTION}/${MANURE_METADATA_DOC}.json`,
    content: toJsonSafeValue(metadataFile, `${MANURE_METADATA_COLLECTION}/${MANURE_METADATA_DOC}.json`) as FirebaseJsonObject,
  });

  backupLog(options, 'Reading manure year index for backup.');
  const yearIndexFile = await backupCollectionFile(firestoreInstance, MANURE_YEARS_COLLECTION);
  filesWithoutManifest.push({
    path: backupFileNameForCollectionPath(MANURE_YEARS_COLLECTION),
    content: toJsonSafeValue(yearIndexFile, backupFileNameForCollectionPath(MANURE_YEARS_COLLECTION)) as FirebaseJsonObject,
  });
  collectionPaths.push(MANURE_YEARS_COLLECTION);

  const yearIds = yearIndexFile.documents.map(documentSnapshot => documentSnapshot.id);
  for (const yearId of yearIds) {
    backupLog(options, `Reading manure year ${yearId} collections for backup.`);
    for (const collectionName of YEAR_BACKUP_COLLECTIONS) {
      const collectionPath = manureYearCollectionPath(yearId, collectionName);
      const collectionFile = await backupCollectionFile(firestoreInstance, collectionPath);
      const backupPath = backupFileNameForCollectionPath(collectionPath);
      filesWithoutManifest.push({
        path: backupPath,
        content: toJsonSafeValue(collectionFile, backupPath) as FirebaseJsonObject,
      });
      collectionPaths.push(collectionPath);
    }
  }

  const filePaths = [
    'manifest.json',
    ...filesWithoutManifest.map(file => file.path),
  ];
  const manifest: FirebaseManureBackupManifest = {
    format: MANURE_BACKUP_FORMAT,
    formatVersion: MANURE_BACKUP_FORMAT_VERSION,
    createdAt: nowIso(),
    projectId: currentProjectId(),
    appVersion: options.appVersion,
    adminEmail: options.adminEmail,
    currentVersion: status.currentVersion,
    targetVersion: status.targetVersion,
    pendingVersions,
    filePaths,
    collectionPaths,
    yearIds,
  };

  const files: FirebaseManureBackupFile[] = [
    {
      path: 'manifest.json',
      content: toJsonSafeValue(manifest, 'manifest.json') as FirebaseJsonObject,
    },
    ...filesWithoutManifest,
  ];
  backupLog(options, `Prepared manure backup with ${yearIds.length} year${yearIds.length === 1 ? '' : 's'} and ${collectionPaths.length} collection snapshot${collectionPaths.length === 1 ? '' : 's'}.`);

  return {
    manifest,
    files,
  };
}

export async function restoreManureBackupPayload(
  payload: FirebaseManureBackupPayload,
  options?: FirebaseManureRestoreOptions,
): Promise<FirebaseManureRestoreResult> {
  const firestoreInstance = firestore();
  const manifest = validateBackupManifest(payload.manifest);
  if (manifest.projectId !== currentProjectId() && !options?.allowProjectMismatch) {
    throw new Error(`Backup project ${manifest.projectId} does not match current project ${currentProjectId()}.`);
  }

  const payloadFilesByPath = filesByPath(payload);
  const manifestFile = requiredBackupFile(payloadFilesByPath, 'manifest.json');
  validateBackupManifest(manifestFile.content);
  const metadataFile = validateDocumentFile(
    requiredBackupFile(payloadFilesByPath, `${MANURE_METADATA_COLLECTION}/${MANURE_METADATA_DOC}.json`).content,
    `${MANURE_METADATA_COLLECTION}/${MANURE_METADATA_DOC}`,
  );
  const yearIndexFile = validateCollectionFile(
    requiredBackupFile(payloadFilesByPath, backupFileNameForCollectionPath(MANURE_YEARS_COLLECTION)).content,
    MANURE_YEARS_COLLECTION,
  );

  const currentYearSnapshots = await getDocs(collection(firestoreInstance, MANURE_YEARS_COLLECTION));
  const yearIdsToClear = uniqueStrings([
    ...currentYearSnapshots.docs.map(snapshot => snapshot.id),
    ...manifest.yearIds,
  ]);

  let deletedDocuments = 0;
  let restoredDocuments = 0;
  let restoredCollections = 0;

  backupLog(options, `Clearing manure subcollections for ${yearIdsToClear.length} year${yearIdsToClear.length === 1 ? '' : 's'}.`);
  for (const yearId of yearIdsToClear) {
    for (const collectionName of YEAR_BACKUP_COLLECTIONS) {
      const collectionPath = manureYearCollectionPath(yearId, collectionName);
      deletedDocuments += await deleteCollectionDocuments(firestoreInstance, collectionPath);
    }
  }

  backupLog(options, 'Restoring manure year documents.');
  deletedDocuments += await deleteCollectionDocuments(firestoreInstance, MANURE_YEARS_COLLECTION);
  restoredDocuments += await setCollectionDocuments(firestoreInstance, MANURE_YEARS_COLLECTION, yearIndexFile.documents);
  restoredCollections += 1;

  for (const yearId of manifest.yearIds) {
    for (const collectionName of YEAR_BACKUP_COLLECTIONS) {
      const collectionPath = manureYearCollectionPath(yearId, collectionName);
      const collectionFile = validateCollectionFile(
        requiredBackupFile(payloadFilesByPath, backupFileNameForCollectionPath(collectionPath)).content,
        collectionPath,
      );
      backupLog(options, `Restoring ${collectionFile.documents.length} document${collectionFile.documents.length === 1 ? '' : 's'} to ${collectionPath}.`);
      restoredDocuments += await setCollectionDocuments(firestoreInstance, collectionPath, collectionFile.documents);
      restoredCollections += 1;
    }
  }

  backupLog(options, 'Restoring manure model metadata.');
  const metadataBatch = writeBatch(firestoreInstance);
  const metadataRef = manureMetadataDocRef(firestoreInstance);
  if (metadataFile.exists && metadataFile.document) {
    metadataBatch.set(metadataRef, fromJsonSafeObject(metadataFile.document.data));
    restoredDocuments += 1;
  } else {
    metadataBatch.delete(metadataRef);
    deletedDocuments += 1;
  }
  await metadataBatch.commit();

  backupLog(options, `Restore complete. Restored ${restoredDocuments} document${restoredDocuments === 1 ? '' : 's'} and deleted ${deletedDocuments} existing document${deletedDocuments === 1 ? '' : 's'}.`);
  return {
    restoredCollections,
    restoredDocuments,
    deletedDocuments,
    restoredYearIds: manifest.yearIds,
    restoredModelVersion: metadataFile.document?.data[MANURE_MODEL_VERSION_FIELD] as string | null || null,
  };
}

export async function getManureModelVersion(): Promise<string | null> {
  const snapshot = await getDoc(manureMetadataDocRef(firestore()));
  const version = snapshot.data()?.[MANURE_MODEL_VERSION_FIELD];
  return typeof version === 'string' && version.trim() ? version : null;
}

export async function setManureModelVersion(version: string): Promise<void> {
  await setDoc(
    manureMetadataDocRef(firestore()),
    {
      [MANURE_MODEL_VERSION_FIELD]: version,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
}

export async function getManureMigrationStatus(targetVersion?: string): Promise<FirebaseMigrationStatus> {
  const currentVersion = await getManureModelVersion();
  const relevantMigrations = relevantManureMigrations(targetVersion);
  const pendingMigrations = pendingManureMigrations(currentVersion, targetVersion)
    .map(({ version, description }) => ({ version, description }));

  return {
    currentVersion,
    pendingMigrations,
    targetVersion: relevantMigrations[relevantMigrations.length - 1]?.version || null,
  };
}

export async function runPendingManureMigrations(options?: {
  targetVersion?: string;
  log?: FirebaseMigrationLog;
}): Promise<FirebaseMigrationRunResult> {
  const migrationLog = options?.log || (() => {});
  const firestoreInstance = firestore();
  const currentVersion = await getManureModelVersion();
  const pending = pendingManureMigrations(currentVersion, options?.targetVersion);
  const targetVersion = relevantManureMigrations(options?.targetVersion).at(-1)?.version || null;
  if (pending.length < 1) {
    migrationLog('No manure database migration is needed.');
    return {
      currentVersion,
      pendingMigrations: [],
      targetVersion,
      appliedVersions: [],
    };
  }

  const appliedVersions: string[] = [];
  let previousVersion = currentVersion;
  for (const migration of pending) {
    migrationLog(`Starting manure migration ${previousVersion || 'legacy'} → ${migration.version}.`);
    migrationLog(migration.description);
    info('Starting manure migration fromVersion=%s toVersion=%s', previousVersion || 'legacy', migration.version);
    try {
      await migration.run({
        firestore: firestoreInstance,
        log: migrationLog,
      });
      await setDoc(
        manureMetadataDocRef(firestoreInstance),
        {
          [MANURE_MODEL_VERSION_FIELD]: migration.version,
          updatedAt: nowIso(),
        },
        { merge: true },
      );
      appliedVersions.push(migration.version);
      previousVersion = migration.version;
      migrationLog(`Finished manure migration ${migration.version}.`);
    } catch (error) {
      warn('Manure migration failed fromVersion=%s toVersion=%s error=%O', previousVersion || 'legacy', migration.version, error);
      throw error;
    }
  }

  const finalStatus = await getManureMigrationStatus(options?.targetVersion);
  return {
    ...finalStatus,
    appliedVersions,
  };
}
