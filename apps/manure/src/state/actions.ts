import { action, runInAction } from 'mobx';
import pkg from '../../package.json';
import {
  createLoadGroupKey,
  assertDrivers,
  assertFields,
  assertLoadsRecords,
  assertSpreadRegions,
  assertSources,
  appendToLoadRecord,
  deleteAccessRecord as removeAccessRecord,
  deleteLoadHistoryBundle,
  emptyLoadRecord,
  getAccessRecord,
  isAccessEnabled,
  loadManureAppData,
  nominalFieldAcreage,
  observeAccessRecord,
  observeAccessRecords,
  observeDrivers,
  observeFields,
  observeLoads,
  observeSources,
  observeSpreadRegions,
  saveAccessRecord as persistAccessRecord,
  saveDrivers as persistDrivers,
  saveFields as persistFields,
  saveSpreadRegionWithLoadIds,
  saveSources as persistSources,
  type AccessRecord,
  type Driver,
  type Field,
  type FieldGeoJSON,
  type LoadsRecord,
  type LoadsRecordGeoJSON,
  type LoadsRecordGeoJSONProps,
  type Source,
  type SpreadRegion,
} from '@aultfarms/manure';
import {
  createManureBackupPayload,
  getBrowserFirebase,
  getCurrentUser,
  getManureMigrationStatus,
  restoreManureBackupPayload,
  runPendingManureMigrations,
  signInWithGoogle,
  signOutBrowserUser,
  type FirebaseJsonObject,
  type FirebaseManureBackupManifest,
  type FirebaseManureBackupPayload,
} from '@aultfarms/firebase';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import JSZip from 'jszip';
import * as toGeoJSON from '@tmcw/togeojson';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import bbox from '@turf/bbox';
import center from '@turf/center';
import { point } from '@turf/helpers';
import debug from 'debug';
import { summarizeLoadGroupsByKey } from '../loadGroups';
import { defaultHistoryFilters, state, type State } from './state';

const info = debug('af/manure:info');
const warn = debug('af/manure:warn');
const MANURE_APP_VERSION = pkg.version;

function createLoadPoint(current: State['currentGPS']): Feature<Point> {
  return point([ current.lon, current.lat ]);
}

function refreshStoredLoadRecord(): void {
  localStorage.setItem('af.manure.loadRecord', JSON.stringify({
    field: state.load.field,
    source: state.load.source,
    driver: state.load.driver,
  }));
}

function currentActorEmail(): string {
  return state.auth.email || 'unknown@local';
}

function makeClientId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function drawHeadingStorageKey(fieldName: string): string {
  return `af.manure.drawHeading.${normalizedName(fieldName)}`;
}

function storedFieldHeading(fieldName: string): number | null {
  const rawValue = localStorage.getItem(drawHeadingStorageKey(fieldName));
  if (!rawValue) {
    return null;
  }

  const headingDegrees = Number.parseFloat(rawValue);
  return Number.isFinite(headingDegrees) ? headingDegrees : null;
}

function persistFieldHeading(fieldName: string, headingDegrees: number | null): void {
  const storageKey = drawHeadingStorageKey(fieldName);
  if (headingDegrees === null) {
    localStorage.removeItem(storageKey);
    return;
  }

  localStorage.setItem(storageKey, String(headingDegrees));
}

function nextBlankLoad(): LoadsRecord {
  return {
    ...emptyLoadRecord(state.load.date),
    field: state.load.field,
    source: state.load.source,
    driver: state.load.driver,
  };
}

function nextBlankAccessDraft(): State['accessManagement']['draft'] {
  return {
    email: '',
    displayName: '',
    enabled: true,
    admin: false,
  };
}

function nextBlankSourceDraft(): State['lookupManagement']['sourceDraft'] {
  return {
    name: '',
    type: 'solid',
    acPerLoad: '',
    spreadWidthFeet: '40',
    defaultLoadLengthFeet: '500',
  };
}

function nextBlankDriverDraft(): State['lookupManagement']['driverDraft'] {
  return {
    name: '',
  };
}

function sortManagedAccessRecords(records: AccessRecord[]): AccessRecord[] {
  return [ ...records ].sort((left, right) => left.email.localeCompare(right.email));
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

function sourceRecordKey(source: Pick<Source, 'id' | 'name'>): string {
  return source.id || normalizedName(source.name);
}

function driverRecordKey(driver: Pick<Driver, 'id' | 'name'>): string {
  return driver.id || normalizedName(driver.name);
}

function cloneSources(sourcesList: Source[]): Source[] {
  return sourcesList.map(source => ({ ...source }));
}

function cloneDrivers(driversList: Driver[]): Driver[] {
  return driversList.map(driver => ({ ...driver }));
}

function cloneFields(fieldsList: Field[]): Field[] {
  return JSON.parse(JSON.stringify(fieldsList)) as Field[];
}

function cloneAccessRecords(records: AccessRecord[]): AccessRecord[] {
  return records.map(record => ({ ...record }));
}

function stableEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function safeBackupTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}

function backupFileName(manifest: FirebaseManureBackupManifest): string {
  const targetVersion = manifest.targetVersion || MANURE_APP_VERSION;
  return `manure-backup-pre-${targetVersion}-${safeBackupTimestamp(manifest.createdAt)}.zip`;
}

function appendMigrationLog(message: string): void {
  runInAction(() => {
    state.migration.logs = [ ...state.migration.logs, message ];
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isJsonObject(value: unknown): value is FirebaseJsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(text: string, path: string): FirebaseJsonObject {
  const parsedValue = JSON.parse(text) as unknown;
  if (!isJsonObject(parsedValue)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsedValue;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
    ? value
    : [];
}

function parseBackupManifest(value: FirebaseJsonObject): FirebaseManureBackupManifest {
  if (value.format !== 'aultfarms.manure.backup' || value.formatVersion !== 1) {
    throw new Error('The selected file is not a supported manure backup.');
  }
  if (
    typeof value.createdAt !== 'string'
    || typeof value.projectId !== 'string'
    || typeof value.appVersion !== 'string'
    || typeof value.adminEmail !== 'string'
    || !(typeof value.currentVersion === 'string' || value.currentVersion === null)
    || !(typeof value.targetVersion === 'string' || value.targetVersion === null)
  ) {
    throw new Error('The selected manure backup manifest is malformed.');
  }

  return {
    format: 'aultfarms.manure.backup',
    formatVersion: 1,
    createdAt: value.createdAt,
    projectId: value.projectId,
    appVersion: value.appVersion,
    adminEmail: value.adminEmail,
    currentVersion: value.currentVersion,
    targetVersion: value.targetVersion,
    pendingVersions: stringArray(value.pendingVersions),
    filePaths: stringArray(value.filePaths),
    collectionPaths: stringArray(value.collectionPaths),
    yearIds: stringArray(value.yearIds),
  };
}

function restoreSummaryFromManifest(manifest: FirebaseManureBackupManifest): State['migration']['restoreSummary'] {
  return {
    createdAt: manifest.createdAt,
    projectId: manifest.projectId,
    appVersion: manifest.appVersion,
    adminEmail: manifest.adminEmail,
    currentVersion: manifest.currentVersion,
    targetVersion: manifest.targetVersion,
    pendingVersions: manifest.pendingVersions,
    yearIds: manifest.yearIds,
    collectionCount: manifest.collectionPaths.length,
  };
}

async function createBackupZipBlob(payload: FirebaseManureBackupPayload): Promise<Blob> {
  const zip = new JSZip();
  for (const file of payload.files) {
    zip.file(file.path, JSON.stringify(file.content, null, 2));
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

async function readBackupPayloadFromZip(file: File): Promise<FirebaseManureBackupPayload> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const jsonEntries = Object.values(zip.files)
    .filter(entry => !entry.dir && entry.name.endsWith('.json'));
  if (jsonEntries.length < 1) {
    throw new Error('The selected ZIP does not contain any JSON backup files.');
  }

  const files = await Promise.all(jsonEntries.map(async (entry) => ({
    path: entry.name,
    content: parseJsonObject(await entry.async('text'), entry.name),
  })));
  const manifestFile = files.find(entry => entry.path === 'manifest.json');
  if (!manifestFile) {
    throw new Error('The selected ZIP is missing manifest.json.');
  }

  return {
    manifest: parseBackupManifest(manifestFile.content),
    files,
  };
}

function isBlankSourceDraft(
  draft: State['lookupManagement']['sourceDraft'] = state.lookupManagement.sourceDraft,
): boolean {
  return (
    !draft.name.trim()
    && draft.type === 'solid'
    && draft.acPerLoad.trim() === ''
    && draft.spreadWidthFeet.trim() === '40'
    && draft.defaultLoadLengthFeet.trim() === '500'
  );
}

function isBlankDriverDraft(
  draft: State['lookupManagement']['driverDraft'] = state.lookupManagement.driverDraft,
): boolean {
  return !draft.name.trim();
}

function isBlankAccessDraft(
  draft: State['accessManagement']['draft'] = state.accessManagement.draft,
): boolean {
  return (
    !draft.email.trim()
    && !draft.displayName.trim()
    && draft.enabled
    && !draft.admin
  );
}

function isFieldDraftDirty(): boolean {
  return state.fieldsChanged || !stableEquals(state.fields, state.serverFields);
}

function isSourceDraftDirty(canonicalSources = state.sources): boolean {
  return (
    !stableEquals(state.lookupManagement.sources, canonicalSources)
    || !isBlankSourceDraft()
  );
}

function isDriverDraftDirty(canonicalDrivers = state.drivers): boolean {
  return (
    !stableEquals(state.lookupManagement.drivers, canonicalDrivers)
    || !isBlankDriverDraft()
  );
}

function isAccessDraftDirty(canonicalRecords = state.accessManagement.serverRecords): boolean {
  return (
    !stableEquals(state.accessManagement.records, canonicalRecords)
    || !isBlankAccessDraft()
  );
}

function closeAdminManagementSessions(): void {
  if (state.lookupManagement.sourceModalOpen) {
    closeSourceManagementModal();
  }
  if (state.lookupManagement.driverModalOpen) {
    closeDriverManagementModal();
  }
  if (state.accessManagement.modalOpen) {
    closeAccessManagementModal();
  }
}

function revalidateHistorySelections(): void {

  const validLoadGroupKeys = new Set(
    summarizeLoadGroupsByKey(state.loads, state.regions, state.thisYear).keys(),
  );
  historyManagementState({
    selectedLoadGroupKeys: state.historyManagement.selectedLoadGroupKeys.filter(loadGroupKey => (
      validLoadGroupKeys.has(loadGroupKey)
    )),
    expandedLoadGroupKeys: state.historyManagement.expandedLoadGroupKeys.filter(loadGroupKey => (
      validLoadGroupKeys.has(loadGroupKey)
    )),
  });
}

function revalidateDrawTargets(): void {
  if (!state.draw.modalOpen || state.draw.purpose !== 'region' || state.draw.targetLoadGroupKeys.length < 1) {
    return;
  }

  const groupsByKey = summarizeLoadGroupsByKey(state.loads, state.regions, state.thisYear);
  const selectedGroups = state.draw.targetLoadGroupKeys
    .map(loadGroupKey => groupsByKey.get(loadGroupKey))
    .filter((group): group is NonNullable<typeof group> => !!group);

  if (selectedGroups.length < 1) {
    closeDrawModal();
    snackbarMessage('The selected grouped load no longer exists.');
    return;
  }

  const targetFieldNames = [ ...new Set(selectedGroups.map(group => group.field)) ];
  if (targetFieldNames.length !== 1) {
    closeDrawModal();
    snackbarMessage('The selected grouped loads no longer belong to one field.');
    return;
  }

  drawState({
    targetLoadGroupKeys: selectedGroups.map(group => group.loadGroupKey),
    targetField: targetFieldNames[0] || '',
    assignmentLoadCounts: Object.fromEntries(selectedGroups.map(group => ([
      group.loadGroupKey,
      Math.max(
        0,
        Math.min(
          group.unassignedLoads,
          state.draw.assignmentLoadCounts[group.loadGroupKey] ?? group.unassignedLoads,
        ),
      ),
    ]))),
  });
}

type Unsubscribe = () => void;

let activeSessionGeneration = 0;
let stopDataListenersRef: Unsubscribe | null = null;
let stopCurrentAccessListenerRef: Unsubscribe | null = null;
let stopAccessRecordsListenerRef: Unsubscribe | null = null;

function stopDataListeners(): void {
  stopDataListenersRef?.();
  stopDataListenersRef = null;
}

function stopCurrentAccessListener(): void {
  stopCurrentAccessListenerRef?.();
  stopCurrentAccessListenerRef = null;
}

function stopAccessRecordsListener(): void {
  stopAccessRecordsListenerRef?.();
  stopAccessRecordsListenerRef = null;
}

function stopAllRealtimeListeners(): void {
  stopAccessRecordsListener();
  stopCurrentAccessListener();
  stopDataListeners();
}

function beginSessionGeneration(): number {
  activeSessionGeneration += 1;
  stopAllRealtimeListeners();
  return activeSessionGeneration;
}

function isActiveSessionGeneration(generation: number): boolean {
  return generation === activeSessionGeneration;
}

function handleRealtimeSyncError(scope: string, generation: number, error: Error): void {
  if (!isActiveSessionGeneration(generation)) {
    return;
  }

  warn('Realtime manure sync failed for %s. Error=%O', scope, error);
  snackbarMessage(`Error syncing ${scope}: ${error.message}`);
}

function applyFieldsSnapshot(nextFields: Field[]): void {
  const draftDirty = isFieldDraftDirty();
  const nextServerFields = cloneFields(nextFields);

  state.serverFields = nextServerFields;

  if (draftDirty) {
    const differsFromServer = !stableEquals(state.fields, nextServerFields);
    state.fieldsStale = differsFromServer && !state.fieldsKeepLocal;
    if (!differsFromServer) {
      state.fieldsKeepLocal = false;
    }
    return;
  }

  fields(nextServerFields);
  state.pendingBoundaryFieldNames = [];
  state.fieldsStale = false;
  state.fieldsKeepLocal = false;
}

function applySourcesSnapshot(nextSources: Source[]): void {
  const canonicalBefore = cloneSources(state.sources);
  const draftDirty = state.lookupManagement.sourceModalOpen && isSourceDraftDirty(canonicalBefore);
  const nextCanonical = cloneSources(nextSources);
  const serverChanged = !stableEquals(canonicalBefore, nextCanonical);

  sources(nextCanonical);

  if (!state.lookupManagement.sourceModalOpen) {
    lookupManagementState({
      sourcesStale: false,
      sourceKeepLocal: false,
    });
    return;
  }

  if (!draftDirty) {
    lookupManagementState({
      sources: cloneSources(nextCanonical),
      sourcesStale: false,
      sourceKeepLocal: false,
    });
    return;
  }

  const differsFromServer = !stableEquals(state.lookupManagement.sources, nextCanonical) || !isBlankSourceDraft();
  if (!serverChanged || !differsFromServer) {
    lookupManagementState({
      sourcesStale: false,
      sourceKeepLocal: false,
    });
    return;
  }
  lookupManagementState({ sourcesStale: !state.lookupManagement.sourceKeepLocal });
}

function applyDriversSnapshot(nextDrivers: Driver[]): void {
  const canonicalBefore = cloneDrivers(state.drivers);
  const draftDirty = state.lookupManagement.driverModalOpen && isDriverDraftDirty(canonicalBefore);
  const nextCanonical = cloneDrivers(nextDrivers);
  const serverChanged = !stableEquals(canonicalBefore, nextCanonical);

  drivers(nextCanonical);

  if (!state.lookupManagement.driverModalOpen) {
    lookupManagementState({
      driversStale: false,
      driverKeepLocal: false,
    });
    return;
  }

  if (!draftDirty) {
    lookupManagementState({
      drivers: cloneDrivers(nextCanonical),
      driversStale: false,
      driverKeepLocal: false,
    });
    return;
  }

  const differsFromServer = !stableEquals(state.lookupManagement.drivers, nextCanonical) || !isBlankDriverDraft();
  if (!serverChanged || !differsFromServer) {
    lookupManagementState({
      driversStale: false,
      driverKeepLocal: false,
    });
    return;
  }
  lookupManagementState({ driversStale: !state.lookupManagement.driverKeepLocal });
}

function applyAccessRecordsSnapshot(nextRecords: AccessRecord[]): void {
  const canonicalBefore = cloneAccessRecords(state.accessManagement.serverRecords);
  const draftDirty = state.accessManagement.modalOpen && isAccessDraftDirty(canonicalBefore);
  const nextCanonical = sortManagedAccessRecords(cloneAccessRecords(nextRecords));
  const serverChanged = !stableEquals(canonicalBefore, nextCanonical);

  state.accessManagement.serverRecords = nextCanonical;

  if (!state.accessManagement.modalOpen) {
    accessManagementState({
      stale: false,
      keepLocal: false,
    });
    return;
  }

  if (!draftDirty) {
    accessManagementState({
      records: cloneAccessRecords(nextCanonical),
      stale: false,
      keepLocal: false,
    });
    return;
  }

  const differsFromServer = !stableEquals(state.accessManagement.records, nextCanonical) || !isBlankAccessDraft();
  if (!serverChanged || !differsFromServer) {
    accessManagementState({
      stale: false,
      keepLocal: false,
    });
    return;
  }
  accessManagementState({ stale: !state.accessManagement.keepLocal });
}

function startCurrentAccessListener(
  email: string,
  displayName: string,
  generation: number,
): void {
  stopCurrentAccessListener();
  stopCurrentAccessListenerRef = observeAccessRecord(
    email,
    (record) => {
      if (!isActiveSessionGeneration(generation)) {
        return;
      }

      if (!isAccessEnabled(record)) {
        info('Realtime access listener revoked manure access for email=%s', email);
        stopAllRealtimeListeners();
        closeAdminManagementSessions();
        applyAccessDeniedUser({ email, displayName });
        snackbarMessage('Your manure access changed. Reloaded the latest server access state.');
        return;
      }

      const lostAdmin = state.auth.admin && !record.admin;
      authState({
        status: 'signed_in',
        email,
        displayName: record.displayName || displayName || email,
        admin: record.admin,
        error: '',
      });
      if (lostAdmin) {
        closeAdminManagementSessions();
      }
    },
    (error) => handleRealtimeSyncError('your access', generation, error),
  );
}

function startAccessRecordsListener(generation: number): void {
  stopAccessRecordsListener();
  accessManagementState({ loading: true });
  stopAccessRecordsListenerRef = observeAccessRecords(
    (records) => {
      if (!isActiveSessionGeneration(generation)) {
        return;
      }

      applyAccessRecordsSnapshot(records);
      accessManagementState({ loading: false });
    },
    (error) => {
      if (!isActiveSessionGeneration(generation)) {
        return;
      }

      accessManagementState({ loading: false });
      handleRealtimeSyncError('access records', generation, error);
    },
  );
}

function startDataListeners(generation: number): void {
  stopDataListeners();

  const year = state.thisYear;
  const unsubs = [
    observeFields(
      year,
      (nextFields) => {
        if (!isActiveSessionGeneration(generation)) {
          return;
        }
        applyFieldsSnapshot(nextFields);
      },
      (error) => handleRealtimeSyncError('fields', generation, error),
    ),
    observeSources(
      year,
      (nextSources) => {
        if (!isActiveSessionGeneration(generation)) {
          return;
        }
        applySourcesSnapshot(nextSources);
      },
      (error) => handleRealtimeSyncError('sources', generation, error),
    ),
    observeDrivers(
      year,
      (nextDrivers) => {
        if (!isActiveSessionGeneration(generation)) {
          return;
        }
        applyDriversSnapshot(nextDrivers);
      },
      (error) => handleRealtimeSyncError('drivers', generation, error),
    ),
    observeLoads(
      year,
      (nextLoads) => {
        if (!isActiveSessionGeneration(generation)) {
          return;
        }
        loads(nextLoads);
      },
      (error) => handleRealtimeSyncError('current loads', generation, error),
    ),
    observeLoads(
      year - 1,
      (nextLoads) => {
        if (!isActiveSessionGeneration(generation)) {
          return;
        }
        previousLoads(nextLoads);
      },
      (error) => handleRealtimeSyncError('previous loads', generation, error),
    ),
    observeSpreadRegions(
      year,
      (nextRegions) => {
        if (!isActiveSessionGeneration(generation)) {
          return;
        }
        regions(nextRegions);
      },
      (error) => handleRealtimeSyncError('spread regions', generation, error),
    ),
  ];

  stopDataListenersRef = () => {
    for (const unsubscribe of unsubs) {
      unsubscribe();
    }
  };
}

function validateManagedSources(sourcesList: Source[]): string | null {
  const seen = new Set<string>();
  for (const source of sourcesList) {
    const name = source.name.trim();
    if (!name) {
      return 'Source name cannot be empty.';
    }
    const key = normalizedName(name);
    if (seen.has(key)) {
      return `Source "${name}" already exists.`;
    }
    seen.add(key);
    if (source.type !== 'solid' && source.type !== 'liquid') {
      return `Source "${name}" must be solid or liquid.`;
    }
    if (!Number.isFinite(source.acPerLoad)) {
      return `Source "${name}" must have a valid acres-per-load value.`;
    }
    if (!Number.isFinite(source.spreadWidthFeet) || (source.spreadWidthFeet || 0) <= 0) {
      return `Source "${name}" must have a valid spread width in feet.`;
    }
    if (!Number.isFinite(source.defaultLoadLengthFeet) || (source.defaultLoadLengthFeet || 0) <= 0) {
      return `Source "${name}" must have a valid default load length in feet.`;
    }
  }
  return null;
}

function validateManagedDrivers(driversList: Driver[]): string | null {
  const seen = new Set<string>();
  for (const driver of driversList) {
    const name = driver.name.trim();
    if (!name) {
      return 'Driver name cannot be empty.';
    }
    const key = normalizedName(name);
    if (seen.has(key)) {
      return `Driver "${name}" already exists.`;
    }
    seen.add(key);
  }
  return null;
}

function isCurrentUserAccessRecord(email: string): boolean {
  return normalizedEmail(email) === normalizedEmail(state.auth.email);
}

function findManagedAccessRecord(email: string): AccessRecord | undefined {
  return state.accessManagement.records.find(record => record.email === normalizedEmail(email));
}

function fieldDefaultHeading(fieldName: string): number | null {
  const field = state.fields.find(candidate => candidate.name === fieldName);
  return typeof field?.defaultHeadingDegrees === 'number' ? field.defaultHeadingDegrees : null;
}

function nextNewFieldName(): string {
  const existingNames = new Set(state.fields.map(field => field.name));
  let nextName = 'New Field';
  let suffix = 2;
  while (existingNames.has(nextName)) {
    nextName = `New Field ${suffix}`;
    suffix += 1;
  }
  return nextName;
}

function placeholderFieldBoundary(): Feature<Polygon> {
  const [ lat, lon ] = state.mapView.center;
  const delta = 0.00005;
  return {
    type: 'Feature',
    properties: null,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [ lon - delta, lat - delta ],
        [ lon + delta, lat - delta ],
        [ lon + delta, lat + delta ],
        [ lon - delta, lat + delta ],
        [ lon - delta, lat - delta ],
      ]],
    },
  };
}

function sessionLoadUserSummary(user: ReturnType<typeof getCurrentUser>) {
  if (!user) {
    return null;
  }

  return {
    uid: user.uid,
    email: user.email || '',
    emailVerified: user.emailVerified,
    displayName: user.displayName || '',
    providers: user.providerData.map((provider) => ({
      providerId: provider.providerId,
      email: provider.email || '',
      displayName: provider.displayName || '',
    })),
  };
}

async function logSessionLoadTokenSummary(context: string, user: ReturnType<typeof getCurrentUser>): Promise<void> {
  if (!user) {
    info('%s - no Firebase user available for manure session token inspection', context);
    return;
  }

  try {
    const tokenResult = await user.getIdTokenResult();
    info(
      '%s - uid=%s email=%s verified=%s tokenEmail=%s tokenEmailVerified=%s signInProvider=%s authTime=%s issuedAt=%s expiration=%s',
      context,
      user.uid,
      user.email || '',
      user.emailVerified,
      typeof tokenResult.claims.email === 'string' ? tokenResult.claims.email : '',
      tokenResult.claims.email_verified === true,
      tokenResult.signInProvider || '',
      tokenResult.authTime,
      tokenResult.issuedAtTime,
      tokenResult.expirationTime,
    );
  } catch (error) {
    warn(
      '%s - failed to inspect manure session token for uid=%s email=%s. Error=%O',
      context,
      user.uid,
      user.email || '',
      error,
    );
  }
}

async function loadSessionForUser(user: ReturnType<typeof getCurrentUser>): Promise<void> {
  const generation = beginSessionGeneration();
  if (!user?.email) {
    info('No authenticated Firebase user is available; applying signed-out state');
    applySignedOutUser();
    return;
  }
  info(
    'Loading manure session for user=%O currentAuthUser=%O sameUid=%s',
    sessionLoadUserSummary(user),
    sessionLoadUserSummary(getCurrentUser()),
    user.uid === getCurrentUser()?.uid,
  );
  await logSessionLoadTokenSummary('Preparing manure session load token summary', user);

  loading(true);
  loadingError('');
  authState({
    status: 'checking',
    email: user.email,
    displayName: user.displayName || user.email,
    admin: false,
    error: '',
  });

  try {
    const accessRecord = await getAccessRecord(user.email);
    if (!isActiveSessionGeneration(generation)) {
      return;
    }
    if (!isAccessEnabled(accessRecord)) {
      info('Manure access was denied or disabled for email=%s', user.email);
      applyAccessDeniedUser({
        email: user.email,
        displayName: user.displayName || '',
      });
      return;
    }

    await applySignedInUser(
      {
        email: user.email,
        displayName: user.displayName || '',
      },
      accessRecord,
      generation,
    );
  } catch (error) {
    if (!isActiveSessionGeneration(generation)) {
      return;
    }
    warn('Manure session load failed for email=%s. Error=%O', user.email, error);
    const message = `Error loading manure access: ${(error as Error).message}`;
    resetSessionData();
    authState({
      status: 'signed_out',
      email: user.email,
      displayName: user.displayName || user.email,
      admin: false,
      error: message,
    });
    loadingError(message);
    loading(false);
  }
}

async function ensureMigrationReady(
  isAdmin: boolean,
  generation: number,
): Promise<boolean> {
  const status = await getManureMigrationStatus(MANURE_APP_VERSION);
  if (!isActiveSessionGeneration(generation)) {
    return false;
  }

  const pendingVersions = status.pendingMigrations.map(migration => migration.version);
  if (pendingVersions.length < 1) {
    migrationState({
      modalOpen: false,
      required: false,
      running: false,
      currentVersion: status.currentVersion,
      targetVersion: status.targetVersion,
      pendingVersions: [],
      logs: [],
      error: '',
    });
    return true;
  }

  const fromVersion = status.currentVersion || 'legacy';
  const toVersion = status.targetVersion || pendingVersions[pendingVersions.length - 1] || MANURE_APP_VERSION;
  migrationState({
    modalOpen: isAdmin,
    required: true,
    running: false,
    currentVersion: status.currentVersion,
    targetVersion: toVersion,
    pendingVersions,
    logs: isAdmin
      ? [
          'Database upgrade required before loading manure data.',
          `Current model version: ${fromVersion}.`,
          `Pending migration${pendingVersions.length === 1 ? '' : 's'}: ${pendingVersions.join(', ')}.`,
        ]
      : [],
    error: isAdmin
      ? ''
      : `An admin must run the manure database migration (${fromVersion} → ${toVersion}) before this app can load.`,
  });
  loading(false);
  return false;
}

export const authState = action('authState', (auth: Partial<State['auth']>) => {
  state.auth = {
    ...state.auth,
    ...auth,
  };
});

export const toggleHistoryLoadGroupSelection = action('toggleHistoryLoadGroupSelection', (loadGroupKey: string) => {
  const selected = new Set(state.historyManagement.selectedLoadGroupKeys);
  if (selected.has(loadGroupKey)) {
    selected.delete(loadGroupKey);
  } else {
    selected.add(loadGroupKey);
  }

  historyManagementState({
    selectedLoadGroupKeys: [ ...selected ],
  });
});

export const clearHistoryLoadGroupSelection = action('clearHistoryLoadGroupSelection', () => {
  historyManagementState({
    selectedLoadGroupKeys: [],
  });
});

export const toggleHistoryLoadGroupExpansion = action('toggleHistoryLoadGroupExpansion', (loadGroupKey: string) => {
  const expanded = new Set(state.historyManagement.expandedLoadGroupKeys);
  if (expanded.has(loadGroupKey)) {
    expanded.delete(loadGroupKey);
  } else {
    expanded.add(loadGroupKey);
  }

  historyManagementState({
    expandedLoadGroupKeys: [ ...expanded ],
  });
});

export const setHistoryFilters = action(
  'setHistoryFilters',
  (filters: Partial<State['historyManagement']['filters']>) => {
    historyManagementState({
      filters: {
        ...state.historyManagement.filters,
        ...filters,
      },
      selectedLoadGroupKeys: [],
      expandedLoadGroupKeys: [],
    });
  },
);

export const clearHistoryFilters = action('clearHistoryFilters', () => {
  historyManagementState({
    filters: defaultHistoryFilters(state.thisYear),
    selectedLoadGroupKeys: [],
    expandedLoadGroupKeys: [],
  });
});

export const deleteHistoryLoadGroups = action('deleteHistoryLoadGroups', async (requestedLoadGroupKeys?: string[]) => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can delete load history.');
    return;
  }

  const loadGroupKeys = [ ...new Set((requestedLoadGroupKeys ?? state.historyManagement.selectedLoadGroupKeys).filter(Boolean)) ];
  if (loadGroupKeys.length < 1) {
    snackbarMessage('Select at least one grouped load row to delete.');
    return;
  }

  const groupsByKey = summarizeLoadGroupsByKey(state.loads, state.regions, state.thisYear);
  const groups = loadGroupKeys
    .map(loadGroupKey => groupsByKey.get(loadGroupKey))
    .filter((group): group is NonNullable<typeof group> => !!group);

  if (groups.length < 1) {
    snackbarMessage('No matching grouped load rows were found to delete.');
    return;
  }

  const totalLoads = groups.reduce((sum, group) => sum + group.totalLoads, 0);
  const confirmMessage = groups.length === 1
    ? `Delete ${totalLoads} loads from ${groups[0]!.date} ${groups[0]!.field} / ${groups[0]!.source}? This also removes those loads from linked spread regions and deletes any region left with no loads.`
    : `Delete ${totalLoads} loads across ${groups.length} grouped history rows? This also removes those loads from linked spread regions and deletes any region left with no loads.`;

  if (!window.confirm(confirmMessage)) {
    return;
  }

  const selectedSet = new Set(groups.map(group => group.loadGroupKey));
  const loadRecordIdsToDelete = groups.flatMap(group => group.loadRows.map(row => row.id));
  const loadRecordIdSet = new Set(loadRecordIdsToDelete);
  const updatedRegions: SpreadRegion[] = [];
  const regionIdsToDelete: string[] = [];
  for (const region of state.regions) {
    const remainingLoadIds = (region.loadIds || []).filter(loadId => !loadRecordIdSet.has(loadId));
    if (remainingLoadIds.length === (region.loadIds || []).length) {
      continue;
    }
    if (remainingLoadIds.length < 1) {
      if (region.id) {
        regionIdsToDelete.push(region.id);
      }
      continue;
    }
    updatedRegions.push({
      ...region,
      loadIds: remainingLoadIds,
    });
  }

  historyManagementState({ deleting: true });
  try {
    await deleteLoadHistoryBundle(state.thisYear, {
      loadRecordIds: loadRecordIdsToDelete,
      updatedRegions,
      regionIds: regionIdsToDelete,
    });
    historyManagementState({
      selectedLoadGroupKeys: state.historyManagement.selectedLoadGroupKeys.filter(key => !selectedSet.has(key)),
      expandedLoadGroupKeys: state.historyManagement.expandedLoadGroupKeys.filter(key => !selectedSet.has(key)),
    });
    snackbarMessage(groups.length === 1 ? 'Grouped load deleted' : 'Grouped loads deleted');
  } catch (error) {
    warn('Error deleting grouped manure load history. Error=%O', error);
    snackbarMessage(`Error deleting grouped loads: ${(error as Error).message}`);
  } finally {
    historyManagementState({ deleting: false });
  }
});

export const setDrawEnabled = action('setDrawEnabled', (enabled: boolean) => {
  drawState({ enabled });
});

export const openDrawModalForLoadGroups = action(
  'openDrawModalForLoadGroups',
  (
    loadGroupKeys: string[],
    preferredMode?: SpreadRegion['mode'],
    preferredLoadCounts?: Record<string, number>,
  ) => {
    const groupsByKey = summarizeLoadGroupsByKey(state.loads, state.regions, state.thisYear);
    const selectedGroups = loadGroupKeys
      .map(loadGroupKey => groupsByKey.get(loadGroupKey))
      .filter((group): group is NonNullable<typeof group> => !!group);

    if (selectedGroups.length < 1) {
      snackbarMessage('No matching grouped loads were found to draw.');
      return;
    }

    const fieldNames = [ ...new Set(selectedGroups.map(group => group.field)) ];
    if (fieldNames.length !== 1) {
      snackbarMessage('Select grouped loads from the same field before drawing one region.');
      return;
    }

    const targetField = fieldNames[0] || '';
    const assignmentLoadCounts = Object.fromEntries(selectedGroups.map(group => [
      group.loadGroupKey,
      Math.max(
        0,
        Math.min(
          group.unassignedLoads,
          preferredLoadCounts?.[group.loadGroupKey] ?? group.unassignedLoads,
        ),
      ),
    ]));
    const defaultHeading = storedFieldHeading(targetField) ?? fieldDefaultHeading(targetField);
    drawState({
      modalOpen: true,
      saving: false,
      purpose: 'region',
      mode: preferredMode || (selectedGroups.length > 1 ? 'polygon' : 'load'),
      targetLoadGroupKeys: selectedGroups.map(group => group.loadGroupKey),
      assignmentLoadCounts,
      targetField,
      headingDegrees: defaultHeading,
      useDefaultFieldHeading: storedFieldHeading(targetField) === null,
    });
  },
);

type LoadGroupSelectionDraft = {
  loadGroupKey: string;
  date: string;
  field: string;
  source: string;
  loadCount: number;
};

export const openDrawModalForCurrentLoad = action('openDrawModalForCurrentLoad', () => {
  if (!state.load.date || !state.load.field || !state.load.source) {
    snackbarMessage('Select a date, field, and source before drawing.');
    return;
  }
  openDrawModalForLoadGroups([ createLoadGroupKey(state.load) ], 'load');
});

export const openDrawModalForFieldHeading = action('openDrawModalForFieldHeading', (fieldName: string) => {
  const field = state.fields.find(candidate => candidate.name === fieldName);
  if (!field) {
    snackbarMessage(`Field "${fieldName}" not found`);
    return;
  }

  drawState({
    modalOpen: true,
    saving: false,
    purpose: 'fieldHeading',
    mode: 'load',
    targetLoadGroupKeys: [],
    assignmentLoadCounts: {},
    targetField: fieldName,
    headingDegrees: fieldDefaultHeading(fieldName),
    useDefaultFieldHeading: true,
  });
});

export const openDrawModalForFieldBoundary = action('openDrawModalForFieldBoundary', (fieldName: string) => {
  const field = state.fields.find(candidate => candidate.name === fieldName);
  if (!field) {
    snackbarMessage(`Field "${fieldName}" not found`);
    return;
  }

  drawState({
    modalOpen: true,
    saving: false,
    purpose: 'fieldBoundary',
    mode: 'polygon',
    targetLoadGroupKeys: [],
    assignmentLoadCounts: {},
    targetField: fieldName,
    headingDegrees: fieldDefaultHeading(fieldName),
    useDefaultFieldHeading: true,
  });
});

export const closeDrawModal = action('closeDrawModal', () => {
  drawState({
    modalOpen: false,
    saving: false,
    purpose: 'region',
    targetLoadGroupKeys: [],
    assignmentLoadCounts: {},
    targetField: '',
    mode: 'load',
  });
});

export const setDrawHeadingDegrees = action('setDrawHeadingDegrees', (headingDegrees: number | null) => {
  drawState({
    headingDegrees,
    useDefaultFieldHeading: false,
  });
  if (state.draw.targetField) {
    persistFieldHeading(state.draw.targetField, headingDegrees);
  }
});

export const setDrawAssignmentLoadCount = action(
  'setDrawAssignmentLoadCount',
  (loadGroupKey: string, nextLoadCount: number) => {
    drawState({
      assignmentLoadCounts: {
        ...state.draw.assignmentLoadCounts,
        [loadGroupKey]: nextLoadCount,
      },
    });
  },
);

export const saveDrawRegion = action('saveDrawRegion', async (
  regionDraft: Omit<SpreadRegion, 'createdAt' | 'updatedAt' | 'updatedBy'>,
  assignmentDrafts: LoadGroupSelectionDraft[],
) => {
  if (!regionDraft.field) {
    snackbarMessage('Choose a field before saving a drawn region.');
    return;
  }
  if (assignmentDrafts.length < 1) {
    snackbarMessage('Select at least one grouped load to associate with the region.');
    return;
  }

  drawState({ saving: true });
  try {
    const groupsByKey = summarizeLoadGroupsByKey(state.loads, state.regions, state.thisYear);
    const selectedLoadIds = assignmentDrafts.flatMap((assignmentDraft) => {
      const group = groupsByKey.get(assignmentDraft.loadGroupKey);
      if (!group) {
        return [];
      }
      return group.unassignedLoadIds.slice(0, assignmentDraft.loadCount);
    });
    if (selectedLoadIds.length < 1) {
      snackbarMessage('No unassigned loads were available to attach to the region.');
      return;
    }

    await saveSpreadRegionWithLoadIds(
      state.thisYear,
      {
        ...regionDraft,
        id: regionDraft.id || makeClientId('region'),
      },
      selectedLoadIds,
      currentActorEmail(),
    );
    historyManagementState({
      selectedLoadGroupKeys: [],
      expandedLoadGroupKeys: [],
      deleting: false,
    });
    closeDrawModal();
    snackbarMessage('Spread region saved');
  } catch (error) {
    warn('Error saving manure spread region. Error=%O', error);
    snackbarMessage(`Error saving spread region: ${(error as Error).message}`);
  } finally {
    drawState({ saving: false });
  }
});

export const saveFieldHeadingFromDraw = action('saveFieldHeadingFromDraw', (headingDegrees: number) => {
  if (!state.draw.targetField) {
    snackbarMessage('Choose a field before saving a heading.');
    return;
  }

  fieldDefaultHeadingDegrees(state.draw.targetField, headingDegrees);
  persistFieldHeading(state.draw.targetField, null);
  closeDrawModal();
  snackbarMessage('Field default heading updated. Save fields to persist it.');
});

export const revertDrawHeadingToFieldDefault = action('revertDrawHeadingToFieldDefault', () => {
  if (!state.draw.targetField) {
    return;
  }

  const headingDegrees = fieldDefaultHeading(state.draw.targetField);
  persistFieldHeading(state.draw.targetField, null);
  drawState({
    headingDegrees,
    useDefaultFieldHeading: true,
  });
});

export const accessManagementState = action('accessManagementState', (accessManagement: Partial<State['accessManagement']>) => {
  state.accessManagement = {
    ...state.accessManagement,
    ...accessManagement,
  };
});

export const historyManagementState = action('historyManagementState', (historyManagement: Partial<State['historyManagement']>) => {
  state.historyManagement = {
    ...state.historyManagement,
    ...historyManagement,
  };
});

export const migrationState = action('migrationState', (migration: Partial<State['migration']>) => {
  state.migration = {
    ...state.migration,
    ...migration,
  };
});
export const downloadManureMigrationBackup = action('downloadManureMigrationBackup', async () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can download manure database backups.');
    return;
  }
  if (state.migration.backingUp || state.migration.running || state.migration.restoring) {
    snackbarMessage('Wait for the current migration task to finish first.');
    return;
  }

  migrationState({
    backingUp: true,
    error: '',
    restoreError: '',
  });
  appendMigrationLog('Starting manure database backup.');

  try {
    const payload = await createManureBackupPayload({
      appVersion: MANURE_APP_VERSION,
      adminEmail: currentActorEmail(),
      targetVersion: MANURE_APP_VERSION,
      log: appendMigrationLog,
    });
    const fileName = backupFileName(payload.manifest);
    const blob = await createBackupZipBlob(payload);
    downloadBlob(blob, fileName);
    migrationState({
      backingUp: false,
      backupDownloaded: true,
      backupFileName: fileName,
    });
    appendMigrationLog(`Downloaded backup file ${fileName}.`);
    snackbarMessage('Manure database backup downloaded.');
  } catch (error) {
    const message = `Error downloading manure backup: ${(error as Error).message}`;
    warn(message, error);
    migrationState({
      backingUp: false,
      error: message,
    });
    appendMigrationLog(message);
    snackbarMessage(message);
  }
});

export const openRestoreBackupModal = action('openRestoreBackupModal', () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can restore manure database backups.');
    return;
  }

  migrationState({
    restoreModalOpen: true,
    restoreFileName: '',
    restoreSummary: null,
    restoreError: '',
  });
});

export const closeRestoreBackupModal = action('closeRestoreBackupModal', () => {
  if (state.migration.restoring) {
    return;
  }

  migrationState({
    restoreModalOpen: false,
    restoreFileName: '',
    restoreSummary: null,
    restoreError: '',
  });
});

export const restoreManureBackupFile = action('restoreManureBackupFile', async (file: File) => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can restore manure database backups.');
    return;
  }
  if (state.migration.running || state.migration.backingUp || state.migration.restoring) {
    snackbarMessage('Wait for the current migration task to finish first.');
    return;
  }

  migrationState({
    restoreFileName: file.name,
    restoreSummary: null,
    restoreError: '',
    error: '',
  });

  try {
    const payload = await readBackupPayloadFromZip(file);
    const summary = restoreSummaryFromManifest(payload.manifest);
    migrationState({
      restoreSummary: summary,
    });

    const currentProjectId = getBrowserFirebase().config.projectId;
    let allowProjectMismatch = false;
    if (summary?.projectId !== currentProjectId) {
      allowProjectMismatch = window.confirm(
        `This backup is from Firebase project ${summary?.projectId}, but the current app is using ${currentProjectId}. Restore anyway?`,
      );
      if (!allowProjectMismatch) {
        appendMigrationLog('Restore cancelled because the backup project did not match the current Firebase project.');
        return;
      }
    }

    const confirmed = window.confirm(
      `Restore manure backup ${file.name} from ${summary?.createdAt || 'an unknown time'}? This will replace manure model metadata and manure year data for ${summary?.yearIds.length || 0} year${summary?.yearIds.length === 1 ? '' : 's'}.`,
    );
    if (!confirmed) {
      appendMigrationLog('Restore cancelled before writing backup data.');
      return;
    }

    const generation = beginSessionGeneration();
    migrationState({
      restoring: true,
      restoreError: '',
    });
    appendMigrationLog(`Starting restore from backup file ${file.name}.`);
    const result = await restoreManureBackupPayload(payload, {
      allowProjectMismatch,
      log: appendMigrationLog,
    });
    if (!isActiveSessionGeneration(generation)) {
      return;
    }

    migrationState({
      restoring: false,
      restoreModalOpen: false,
      backupDownloaded: false,
      backupFileName: '',
    });
    appendMigrationLog(`Restore finished from ${file.name}.`);
    snackbarMessage(`Manure backup restored (${result.restoredDocuments} documents).`);

    const migrationReady = await ensureMigrationReady(state.auth.admin, generation);
    if (!migrationReady || !isActiveSessionGeneration(generation)) {
      return;
    }
    const loaded = await loadAllData(generation);
    if (!loaded || !isActiveSessionGeneration(generation)) {
      return;
    }
    startCurrentAccessListener(state.auth.email, state.auth.displayName || state.auth.email, generation);
    startDataListeners(generation);
  } catch (error) {
    const message = `Error restoring manure backup: ${(error as Error).message}`;
    warn(message, error);
    migrationState({
      restoring: false,
      restoreError: message,
      error: message,
    });
    appendMigrationLog(message);
    snackbarMessage(message);
  }
});

export const runPendingMigrationUpgrade = action('runPendingMigrationUpgrade', async () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can run manure database migrations.');
    return;
  }
  if (!state.migration.required) {
    snackbarMessage('No manure database migration is currently required.');
    return;
  }
  if (state.migration.backingUp || state.migration.restoring) {
    snackbarMessage('Wait for the current backup or restore task to finish first.');
    return;
  }
  if (!state.migration.backupDownloaded) {
    const proceed = window.confirm(
      'No manure database backup has been downloaded in this session. Run the migration anyway?',
    );
    if (!proceed) {
      return;
    }
  }

  runInAction(() => {
    state.migration.running = true;
    state.migration.error = '';
    state.migration.logs = [];
  });

  const appendLog = (message: string) => {
    runInAction(() => {
      state.migration.logs = [ ...state.migration.logs, message ];
    });
  };

  try {
    const result = await runPendingManureMigrations({
      targetVersion: MANURE_APP_VERSION,
      log: appendLog,
    });
    if (!isActiveSessionGeneration(activeSessionGeneration)) {
      return;
    }

    runInAction(() => {
      state.migration.currentVersion = result.currentVersion;
      state.migration.targetVersion = result.targetVersion;
      state.migration.pendingVersions = result.pendingMigrations.map(migration => migration.version);
      state.migration.required = result.pendingMigrations.length > 0;
      state.migration.running = false;
      state.migration.error = '';
      state.migration.modalOpen = result.pendingMigrations.length > 0;
    });

    if (result.pendingMigrations.length > 0) {
      appendLog('Additional manure migrations are still pending.');
      return;
    }

    const loaded = await loadAllData(activeSessionGeneration);
    if (!loaded || !isActiveSessionGeneration(activeSessionGeneration)) {
      return;
    }
    startCurrentAccessListener(state.auth.email, state.auth.displayName || state.auth.email, activeSessionGeneration);
    startDataListeners(activeSessionGeneration);
    runInAction(() => {
      state.migration.modalOpen = false;
      state.migration.required = false;
      state.migration.pendingVersions = [];
    });
    snackbarMessage('Manure database migration complete.');
  } catch (error) {
    const message = `Error running manure database migration: ${(error as Error).message}`;
    warn(message, error);
    runInAction(() => {
      state.migration.running = false;
      state.migration.error = message;
      state.migration.logs = [ ...state.migration.logs, message ];
    });
    snackbarMessage(message);
  }
});

export const drawState = action('drawState', (draw: Partial<State['draw']>) => {
  state.draw = {
    ...state.draw,
    ...draw,
  };
});

export const activityOverlayState = action('activityOverlayState', (activityOverlay: Partial<State['activityOverlay']>) => {
  state.activityOverlay = {
    ...state.activityOverlay,
    ...activityOverlay,
  };
});

export const accessManagementDraft = action('accessManagementDraft', (draft: Partial<State['accessManagement']['draft']>) => {
  state.accessManagement.draft = {
    ...state.accessManagement.draft,
    ...draft,
  };
});

export const lookupManagementState = action('lookupManagementState', (lookupManagement: Partial<State['lookupManagement']>) => {
  state.lookupManagement = {
    ...state.lookupManagement,
    ...lookupManagement,
  };
});

export const sourceManagementDraft = action('sourceManagementDraft', (draft: Partial<State['lookupManagement']['sourceDraft']>) => {
  state.lookupManagement.sourceDraft = {
    ...state.lookupManagement.sourceDraft,
    ...draft,
  };
});

export const driverManagementDraft = action('driverManagementDraft', (draft: Partial<State['lookupManagement']['driverDraft']>) => {
  state.lookupManagement.driverDraft = {
    ...state.lookupManagement.driverDraft,
    ...draft,
  };
});

export const updateManagedAccessRecord = action('updateManagedAccessRecord', (email: string, patch: Partial<AccessRecord>) => {
  const targetEmail = normalizedEmail(email);
  state.accessManagement.records = state.accessManagement.records.map(record =>
    record.email === targetEmail
      ? {
          ...record,
          ...patch,
          email: targetEmail,
        }
      : record,
  );
});

export const updateManagedSource = action('updateManagedSource', (key: string, patch: Partial<Source>) => {
  state.lookupManagement.sources = state.lookupManagement.sources.map(source =>
    sourceRecordKey(source) === key
      ? {
          ...source,
          ...patch,
        }
      : source,
  );
});

export const updateManagedDriver = action('updateManagedDriver', (key: string, patch: Partial<Driver>) => {
  state.lookupManagement.drivers = state.lookupManagement.drivers.map(driver =>
    driverRecordKey(driver) === key
      ? {
          ...driver,
          ...patch,
        }
      : driver,
  );
});

export const online = action('online', (isOnline: boolean) => {
  state.network.online = isOnline;
});

export const resetSessionData = action('resetSessionData', () => {
  fields([]);
  state.serverFields = [];
  state.fieldsStale = false;
  state.fieldsKeepLocal = false;
  sources([]);
  drivers([]);
  loads([]);
  previousLoads([]);
  regions([]);
  state.mode = 'loads';
  state.editingField = '';
  state.pendingBoundaryFieldNames = [];
  state.load = nextBlankLoad();
  state.migration = {
    modalOpen: false,
    required: false,
    running: false,
    backingUp: false,
    backupDownloaded: false,
    backupFileName: '',
    restoreModalOpen: false,
    restoring: false,
    restoreFileName: '',
    restoreSummary: null,
    restoreError: '',
    currentVersion: null,
    targetVersion: null,
    pendingVersions: [],
    logs: [],
    error: '',
  };
  refreshStoredLoadRecord();
  fieldsChanged(false);
  accessManagementState({
    modalOpen: false,
    loading: false,
    saving: false,
    serverRecords: [],
    records: [],
    draft: nextBlankAccessDraft(),
    stale: false,
    keepLocal: false,
  });
  historyManagementState({
    modalOpen: false,
    selectedLoadGroupKeys: [],
    expandedLoadGroupKeys: [],
    deleting: false,
    filters: defaultHistoryFilters(state.thisYear),
  });
  drawState({
    enabled: false,
    modalOpen: false,
    saving: false,
    purpose: 'region',
    mode: 'load',
    targetLoadGroupKeys: [],
    assignmentLoadCounts: {},
    targetField: '',
    headingDegrees: null,
    useDefaultFieldHeading: true,
  });
  activityOverlayState({
    open: false,
    title: '',
    message: '',
  });
  lookupManagementState({
    sourceModalOpen: false,
    driverModalOpen: false,
    saving: false,
    sources: [],
    drivers: [],
    sourceDraft: nextBlankSourceDraft(),
    driverDraft: nextBlankDriverDraft(),
    sourcesStale: false,
    driversStale: false,
    sourceKeepLocal: false,
    driverKeepLocal: false,
  });
});

export const startSignIn = action('startSignIn', async () => {
  info('Starting manure Google sign-in from UI');
  loading(true);
  loadingError('');
  authState({
    status: 'checking',
    error: '',
  });

  try {
    const user = await signInWithGoogle();
    if (state.loading || state.auth.status === 'checking') {
      info('Google sign-in popup returned before manure auth observer completed; loading session directly');
      await loadSessionForUser(user);
    }
  } catch (error) {
    warn('Manure Google sign-in failed. Error=%O', error);
    loading(false);
    authState({
      status: 'signed_out',
      error: `Unable to sign in: ${(error as Error).message}`,
    });
    loadingError(`Unable to sign in: ${(error as Error).message}`);
  }
});

export const signOut = action('signOut', async () => {
  info('Signing out manure user email=%s', state.auth.email);
  loading(true);
  try {
    await signOutBrowserUser();
  } catch (error) {
    warn('Manure sign-out failed for email=%s. Error=%O', state.auth.email, error);
    loading(false);
    loadingError(`Unable to sign out: ${(error as Error).message}`);
  }
});

export const applySignedInUser = action('applySignedInUser', async (
  user: {
    email: string;
    displayName: string;
  },
  accessRecord: AccessRecord,
  generation = activeSessionGeneration,
) => {
  info('Applying signed-in manure user email=%s admin=%s', user.email, accessRecord.admin);
  authState({
    status: 'signed_in',
    email: user.email,
    displayName: accessRecord.displayName || user.displayName || user.email,
    admin: accessRecord.admin,
    error: '',
  });
  const migrationReady = await ensureMigrationReady(accessRecord.admin, generation);
  if (!migrationReady || !isActiveSessionGeneration(generation)) {
    return;
  }
  const loaded = await loadAllData(generation);
  if (!loaded || !isActiveSessionGeneration(generation)) {
    return;
  }

  startCurrentAccessListener(user.email, user.displayName || user.email, generation);
  startDataListeners(generation);
});

export const applySignedOutUser = action('applySignedOutUser', () => {
  info('Applying signed-out manure session state');
  stopAllRealtimeListeners();
  resetSessionData();
  authState({
    status: 'signed_out',
    email: '',
    displayName: '',
    admin: false,
    error: '',
  });
  loading(false);
});

export const applyAccessDeniedUser = action('applyAccessDeniedUser', (
  user: {
    email: string;
    displayName: string;
  },
) => {
  info('Applying manure access-denied state for email=%s', user.email);
  stopAllRealtimeListeners();
  resetSessionData();
  authState({
    status: 'access_denied',
    email: user.email,
    displayName: user.displayName || user.email,
    admin: false,
    error: 'This email is not currently on the manure access allowlist.',
  });
  loading(false);
});

export const loadAllData = action('loadAllData', async (generation = activeSessionGeneration): Promise<boolean> => {
  info('Loading all manure app data for year=%d', state.thisYear);
  loading(true);
  loadingError('');

  try {
    const data = await loadManureAppData(state.thisYear);
    if (!isActiveSessionGeneration(generation)) {
      return false;
    }
    assertFields(data.fields);
    assertSources(data.sources);
    assertDrivers(data.drivers);
    assertLoadsRecords(data.loads);
    assertLoadsRecords(data.previousLoads);
    assertSpreadRegions(data.regions);
    state.serverFields = cloneFields(data.fields);
    state.fieldsStale = false;
    state.fieldsKeepLocal = false;
    fields(cloneFields(data.fields));
    sources(cloneSources(data.sources));
    drivers(cloneDrivers(data.drivers));
    loads(data.loads);
    previousLoads(data.previousLoads);
    regions(data.regions);
    state.pendingBoundaryFieldNames = [];
    fieldsChanged(false);
    load({});
    info(
      'Loaded manure app data for year=%d fields=%d sources=%d drivers=%d loads=%d previousLoads=%d regions=%d',
      state.thisYear,
      data.fields.length,
      data.sources.length,
      data.drivers.length,
      data.loads.length,
      data.previousLoads.length,
      data.regions.length,
    );
    return true;
  } catch (error) {
    warn('Error loading manure app data for year=%d. Error=%O', state.thisYear, error);
    loadingError(`Error loading manure data: ${(error as Error).message}`);
    return false;
  } finally {
    if (isActiveSessionGeneration(generation)) {
      loading(false);
    }
  }
});

export const uploadKMZ = action('uploadKMZ', async (file: File) => {
  const newFields = await parseKMZIntoFields(file);
  const nextFields = JSON.parse(JSON.stringify(state.fields)) as Field[];

  for (const field of newFields) {
    const existing = nextFields.find(existingField => existingField.name === field.name);
    if (existing) {
      existing.name = field.name;
      existing.acreage = field.acreage;
      existing.boundary = field.boundary;
    } else {
      nextFields.push(field);
    }
  }

  fieldsChanged(true);
  fields(nextFields);
});

export const fieldsChanged = action('fieldsChanged', (value: boolean) => {
  state.fieldsChanged = value;
});

export const saveFields = action('saveFields', async () => {
  const remainingPendingFieldNames = state.pendingBoundaryFieldNames.filter(
    fieldName => state.fields.some(field => field.name === fieldName),
  );
  if (remainingPendingFieldNames.length > 0) {
    snackbarMessage(`Draw a boundary for ${remainingPendingFieldNames.join(', ')} before saving fields.`);
    return;
  }
  loading(true);
  try {
    const savedFields = await persistFields(state.thisYear, state.fields, currentActorEmail());
    const nextSavedFields = cloneFields(savedFields);
    state.serverFields = nextSavedFields;
    state.fieldsStale = false;
    state.fieldsKeepLocal = false;
    fields(nextSavedFields);
    state.pendingBoundaryFieldNames = [];
    fieldsChanged(false);
    snackbarMessage('Fields saved');
  } catch (error) {
    loadingError(`Error updating fields: ${(error as Error).message}`);
  } finally {
    loading(false);
  }
});

export async function parseKMZIntoFields(file: File): Promise<Array<Pick<Field, 'name' | 'acreage' | 'responsibleParty' | 'boundary'>>> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const kmlFile = Object.values(zip.files).find(candidate => candidate.name.endsWith('.kml'));
  if (!kmlFile) {
    throw new Error('No KML file found in KMZ');
  }

  const kmlText = await kmlFile.async('text');
  const parser = new DOMParser();
  const kmlDom = parser.parseFromString(kmlText, 'text/xml');
  const geoJson = toGeoJSON.kml(kmlDom);

  return geoJson.features
    .filter(feature => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
    .map(feature => ({
      name: feature.properties?.name || 'Unnamed Field',
      acreage: nominalFieldAcreage(feature.properties?.name || 'Unnamed Field', feature as Feature<Polygon | MultiPolygon>),
      responsibleParty: '',
      boundary: feature as Feature<Polygon | MultiPolygon>,
    }));
}

export const fieldName = action('fieldName', (oldName: string, newName: string) => {
  const trimmedNewName = newName.trim();
  if (!trimmedNewName) {
    snackbarMessage('Field name cannot be empty');
    return;
  }

  if (state.fields.find(field => field.name === trimmedNewName && field.name !== oldName)) {
    snackbarMessage('Field name already exists');
    return;
  }

  const fieldIndex = state.fields.findIndex(field => field.name === oldName);
  if (fieldIndex >= 0) {
    fieldsChanged(true);
    fields(state.fields.map((field, index) => index === fieldIndex
      ? {
          ...field,
          name: trimmedNewName,
        }
      : field));
    state.pendingBoundaryFieldNames = state.pendingBoundaryFieldNames.map(fieldName => (
      fieldName === oldName ? trimmedNewName : fieldName
    ));
  }
});

export const fieldBoundary = action('fieldBoundary', (name: string, boundary: Field['boundary']) => {
  const fieldIndex = state.fields.findIndex(field => field.name === name);
  if (fieldIndex >= 0) {
    fieldsChanged(true);
    fields(state.fields.map((field, index) => index === fieldIndex
      ? {
          ...field,
          boundary,
        }
      : field));
    state.pendingBoundaryFieldNames = state.pendingBoundaryFieldNames.filter(fieldName => fieldName !== name);
  } else {
    info('Could not find field with name %s', name);
  }
});

export const fieldAcreage = action('fieldAcreage', (name: string, value: number) => {
  if (!Number.isFinite(value)) {
    snackbarMessage('Field acreage must be a valid number');
    return;
  }

  const fieldIndex = state.fields.findIndex(field => field.name === name);
  if (fieldIndex < 0) {
    info('Could not find field with name %s for acreage update', name);
    return;
  }

  fieldsChanged(true);
  fields(state.fields.map((field, index) => index === fieldIndex
    ? {
        ...field,
        acreage: value,
      }
    : field));
});

export const fieldResponsibleParty = action('fieldResponsibleParty', (name: string, value: string) => {
  const fieldIndex = state.fields.findIndex(field => field.name === name);
  if (fieldIndex < 0) {
    info('Could not find field with name %s for responsible party update', name);
    return;
  }

  fieldsChanged(true);
  fields(state.fields.map((field, index) => index === fieldIndex
    ? {
        ...field,
        responsibleParty: value,
      }
    : field));
});

export const fieldDefaultHeadingDegrees = action('fieldDefaultHeadingDegrees', (name: string, value: number | undefined) => {
  const fieldIndex = state.fields.findIndex(field => field.name === name);
  if (fieldIndex < 0) {
    info('Could not find field with name %s for default heading update', name);
    return;
  }

  fieldsChanged(true);
  state.fields[fieldIndex]!.defaultHeadingDegrees = value;
});

export const addField = action('addField', () => {
  const name = nextNewFieldName();
  const nextField: Field = {
    name,
    acreage: 0,
    responsibleParty: '',
    boundary: placeholderFieldBoundary(),
  };

  fieldsChanged(true);
  fields([ ...state.fields, nextField ]);
  state.pendingBoundaryFieldNames = [ ...state.pendingBoundaryFieldNames, name ];
  editingField(name);
});

export const saveFieldBoundaryFromDraw = action('saveFieldBoundaryFromDraw', (boundary: Field['boundary']) => {
  if (!state.draw.targetField) {
    snackbarMessage('Choose a field before saving a boundary.');
    return;
  }

  fieldBoundary(state.draw.targetField, boundary);
  closeDrawModal();
  snackbarMessage('Field boundary updated. Save fields to persist it.');
});

export const deleteField = action('deleteField', (name: string) => {
  const existingField = state.fields.find(field => field.name === name);
  if (!existingField) {
    snackbarMessage(`Field "${name}" not found`);
    return;
  }

  fieldsChanged(true);
  fields(state.fields.filter(field => field.name !== name));
  state.pendingBoundaryFieldNames = state.pendingBoundaryFieldNames.filter(fieldName => fieldName !== name);
  persistFieldHeading(name, null);

  if (state.editingField === name) {
    editingField('');
  }
  if (state.load.field === name) {
    load({ field: '' });
  }
  if (state.draw.targetField === name) {
    closeDrawModal();
  }

  snackbarMessage(`Removed field "${name}". Save Fields to persist.`);
});

export const plusLoad = action('plusLoad', async () => {
  if (!state.load.date || !state.load.field || !state.load.source || !state.load.driver) {
    snackbarMessage('Cannot record load without a date, field, source, and driver');
    return;
  }
  let nextLoad: LoadsRecord | null = null;

  runInAction(() => {
    state.load.loads += 1;
    state.load.geojson = {
      ...state.load.geojson,
      features: [ ...state.load.geojson.features, createLoadPoint(state.currentGPS) ],
    };
    nextLoad = { ...state.load };
  });
  activityOverlayState({
    open: true,
    title: state.draw.enabled ? 'Opening draw' : 'Recording load',
    message: state.draw.enabled
      ? 'Saving the load and preparing the draw modal…'
      : 'Saving the load…',
  });
  try {
    const savedLoad = await saveLoad(nextLoad);
    if (savedLoad && state.draw.enabled) {
      const loadGroupKey = createLoadGroupKey(savedLoad);
      openDrawModalForLoadGroups([ loadGroupKey ], 'load');
    }
  } finally {
    activityOverlayState({
      open: false,
      title: '',
      message: '',
    });
  }
});

export const saveLoad = action('saveLoad', async (loadToSave?: LoadsRecord | null) => {
  const currentLoad = loadToSave || state.load;
  if (!currentLoad.date || !currentLoad.field || !currentLoad.source || !currentLoad.driver) {
    snackbarMessage('Cannot record load without a date, field, source, and driver');
    return;
  }

  try {
    const latestPoint = currentLoad.geojson.features[currentLoad.geojson.features.length - 1];
    const loadId = await appendToLoadRecord(
      state.thisYear,
      currentLoad,
      1,
      latestPoint ? [ latestPoint ] : [],
      currentActorEmail(),
    );
    return {
      ...currentLoad,
      id: loadId,
    };
  } catch (error) {
    loadingError(`Error saving load: ${(error as Error).message}`);
    load({
      date: currentLoad.date,
      field: currentLoad.field,
      source: currentLoad.source,
      driver: currentLoad.driver,
    });
  }
});


export const closeAccessManagementModal = action('closeAccessManagementModal', () => {
  stopAccessRecordsListener();
  accessManagementState({
    modalOpen: false,
    loading: false,
    saving: false,
    stale: false,
    keepLocal: false,
    records: [],
    draft: nextBlankAccessDraft(),
  });
});

export const keepLocalFieldEdits = action('keepLocalFieldEdits', () => {
  state.fieldsStale = false;
  state.fieldsKeepLocal = true;
});

export const reloadFieldsFromServer = action('reloadFieldsFromServer', () => {
  fields(cloneFields(state.serverFields));
  state.pendingBoundaryFieldNames = [];
  state.fieldsChanged = false;
  state.fieldsStale = false;
  state.fieldsKeepLocal = false;
});

export const snackbarMessage = action('snackbarMessage', (message: string) => {
  state.snackbar.open = true;
  state.snackbar.message = message;
});

export const closeSnackbar = action('closeSnackbar', () => {
  state.snackbar.open = false;
});

export const loading = action('loading', (isLoading: boolean) => {
  state.loading = isLoading;
});

export const loadingError = action('loadingError', (errorMessage: string) => {
  state.loadingError = errorMessage;
  if (errorMessage) {
    snackbarMessage(errorMessage);
  }
});

let latestBrowserGPS: { lat: number; lon: number } = { lat: 0, lon: 0 };
export const currentGPS = action('currentGPS', (coords: { lat: number; lon: number }, notReallyFromBrowser?: boolean) => {
  state.currentGPS = coords;
  localStorage.setItem('af.manure.currentGPS', JSON.stringify(coords));
  if (!notReallyFromBrowser) {
    latestBrowserGPS = { ...coords };
  }
});

export const mapView = action('mapView', (map: Partial<State['mapView']>) => {
  state.mapView = {
    ...state.mapView,
    ...map,
  };
  localStorage.setItem('af.manure.map', JSON.stringify(state.mapView));
  if (state.gpsMode === 'map') {
    currentGPS({ lat: state.mapView.center[0], lon: state.mapView.center[1] }, true);
  }
});

export const moveMapToField = action('moveMapToField', (fieldName: string) => {
  const field = state.fields.find(candidate => candidate.name === fieldName);
  if (!field) {
    snackbarMessage(`Field "${fieldName}" not found`);
    return;
  }

  const fieldFeature = field.boundary as Feature<Polygon | MultiPolygon>;
  const fieldCenter = center(fieldFeature).geometry.coordinates as [number, number];
  const fieldBbox = bbox(fieldFeature);
  const latDiff = fieldBbox[3] - fieldBbox[1];
  const lngDiff = fieldBbox[2] - fieldBbox[0];
  const maxDiff = Math.max(latDiff, lngDiff);
  const zoom = Math.min(18, Math.max(10, Math.floor(16 - Math.log2(maxDiff * 100))));

  mapView({
    center: [ fieldCenter[1], fieldCenter[0] ],
    zoom,
  });
});

export const gpsMode = action('gpsMode', (nextMode: State['gpsMode']) => {
  state.gpsMode = nextMode;
  if (nextMode === 'me') {
    currentGPS(latestBrowserGPS, true);
  } else {
    currentGPS({ lat: state.mapView.center[0], lon: state.mapView.center[1] }, true);
  }
});

export const mode = action('mode', (nextMode: 'loads' | 'fields') => {
  state.mode = nextMode;
});

export const editingField = action('editingField', (name: string) => {
  state.editingField = name;
});

export const load = action('load', (record: Partial<LoadsRecord>) => {
  state.load = {
    ...state.load,
    ...record,
  };

  delete state.load.id;
  delete state.load.createdAt;
  delete state.load.updatedAt;
  delete state.load.updatedBy;

  const matchingLoads = state.loads.filter(loadRecord =>
    loadRecord.date === state.load.date
    && loadRecord.source === state.load.source
    && loadRecord.field === state.load.field
    && loadRecord.driver === state.load.driver,
  );

  if (!('loads' in record)) {
    state.load.loads = matchingLoads.reduce((sum, loadRecord) => sum + loadRecord.loads, 0);
  }
  if (!('geojson' in record)) {
    state.load.geojson = {
      type: 'FeatureCollection',
      features: matchingLoads.flatMap(loadRecord => loadRecord.geojson.features),
    };
  }

  refreshStoredLoadRecord();
});

export const autoselectField = action('autoselectField', () => {
  const { lat, lon } = state.currentGPS;
  if (!lat || !lon) {
    warn('No current GPS coordinates available');
    return;
  }

  const gpsPoint = point([ lon, lat ]);
  const selectedField = state.fields.find(field => {
    try {
      return booleanPointInPolygon(gpsPoint, field.boundary);
    } catch (error) {
      warn('Error parsing boundary for field %s: %O', field.name, error);
      return false;
    }
  });

  if (selectedField) {
    state.load.field = selectedField.name;
    refreshStoredLoadRecord();
  } else {
    snackbarMessage('No field found containing current GPS coordinates');
  }
});

export const fields = action('fields', (nextFields: Field[]) => {
  state.fields = nextFields;
  const geojson: FieldGeoJSON = {
    type: 'FeatureCollection',
    features: nextFields.map(field => ({
      ...field.boundary,
      properties: { name: field.name },
    })),
  };
  geojsonFields(geojson);
});

let cachedGeojsonFields: FeatureCollection<Polygon | MultiPolygon> = { type: 'FeatureCollection', features: [] };
export const geojsonFields = action('geojsonFields', (geojson?: FeatureCollection<Polygon | MultiPolygon>) => {
  if (geojson) {
    cachedGeojsonFields = geojson;
    state.geojsonFields.rev += 1;
  }
  return cachedGeojsonFields;
});

export const sources = action('sources', (nextSources: Source[]) => {
  state.sources = nextSources;
  if (state.load.source && !nextSources.some(source => source.name === state.load.source)) {
    state.load.source = '';
    refreshStoredLoadRecord();
  }
});

export const drivers = action('drivers', (nextDrivers: Driver[]) => {
  state.drivers = nextDrivers;
  if (state.load.driver && !nextDrivers.some(driver => driver.name === state.load.driver)) {
    state.load.driver = '';
    refreshStoredLoadRecord();
  }
});

export const loads = action('loads', (nextLoads: LoadsRecord[]) => {
  state.loads = nextLoads;
  const allFeatures: Feature<Point, LoadsRecordGeoJSONProps>[] = [];
  for (const loadRecord of nextLoads) {
    const { geojson, ...rest } = loadRecord;
    for (const feature of geojson.features) {
      allFeatures.push({
        ...feature,
        properties: rest,
      });
    }
  }

  const geojson: LoadsRecordGeoJSON = {
    type: 'FeatureCollection',
    features: allFeatures,
  };
  geojsonLoads(geojson);
  load({
    date: state.load.date,
    field: state.load.field,
    source: state.load.source,
    driver: state.load.driver,
  });
  revalidateHistorySelections();
  revalidateDrawTargets();
});

export const previousLoads = action('previousLoads', (nextPreviousLoads: LoadsRecord[]) => {
  state.previousLoads = nextPreviousLoads;
});

let cachedGeojsonLoads: FeatureCollection<Point, LoadsRecordGeoJSONProps> = { type: 'FeatureCollection', features: [] };
export const geojsonLoads = action('geojsonLoads', (geojson?: FeatureCollection<Point, LoadsRecordGeoJSONProps>) => {
  if (geojson) {
    cachedGeojsonLoads = geojson;
    state.geojsonLoads.rev += 1;
  }
  return cachedGeojsonLoads;
});

let cachedGeojsonRegions: FeatureCollection<Polygon | MultiPolygon, { id?: string; field: string; mode: SpreadRegion['mode'] }> = {
  type: 'FeatureCollection',
  features: [],
};
export const regions = action('regions', (nextRegions: SpreadRegion[]) => {
  state.regions = nextRegions;
  geojsonRegions({
    type: 'FeatureCollection',
    features: nextRegions.map(region => ({
      ...region.polygon,
      properties: {
        id: region.id,
        field: region.field,
        mode: region.mode,
      },
    })),
  });
  revalidateHistorySelections();
  revalidateDrawTargets();
});

export const geojsonRegions = action(
  'geojsonRegions',
  (geojson?: FeatureCollection<Polygon | MultiPolygon, { id?: string; field: string; mode: SpreadRegion['mode'] }>) => {
    if (geojson) {
      cachedGeojsonRegions = geojson;
      state.geojsonRegions.rev += 1;
    }
    return cachedGeojsonRegions;
  },
);


export const retrySessionLoad = action('retrySessionLoad', async (userOverride?: ReturnType<typeof getCurrentUser>) => {
  info(
    'Retrying manure session load using %s user reference',
    typeof userOverride === 'undefined' ? 'current-auth' : 'auth-observer',
  );
  try {
    await loadSessionForUser(typeof userOverride === 'undefined' ? getCurrentUser() : userOverride);
  } catch (error) {
    warn('Unexpected failure while retrying manure session load. Error=%O', error);
    const message = `Unable to retry manure session: ${(error as Error).message}`;
    resetSessionData();
    authState({
      status: 'signed_out',
      email: '',
      displayName: '',
      admin: false,
      error: message,
    });
    loadingError(message);
    loading(false);
  }
});

export const loadAccessManagementRecords = action('loadAccessManagementRecords', () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage manure access.');
    return;
  }
  if (state.accessManagement.serverRecords.length > 0) {
    accessManagementState({
      records: cloneAccessRecords(state.accessManagement.serverRecords),
      loading: false,
    });
  }
  startAccessRecordsListener(activeSessionGeneration);
});

export const openAccessManagementModal = action('openAccessManagementModal', () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage manure access.');
    return;
  }

  accessManagementState({
    modalOpen: true,
    records: cloneAccessRecords(state.accessManagement.serverRecords),
    draft: nextBlankAccessDraft(),
    stale: false,
    keepLocal: false,
  });
  loadAccessManagementRecords();
});

export const openHistoryModal = action('openHistoryModal', () => {
  historyManagementState({
    modalOpen: true,
    selectedLoadGroupKeys: [],
    expandedLoadGroupKeys: [],
    deleting: false,
  });
});

export const closeHistoryModal = action('closeHistoryModal', () => {
  historyManagementState({
    modalOpen: false,
    selectedLoadGroupKeys: [],
    expandedLoadGroupKeys: [],
    deleting: false,
  });
});

export const openSourceManagementModal = action('openSourceManagementModal', () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage sources.');
    return;
  }

  lookupManagementState({
    sourceModalOpen: true,
    driverModalOpen: false,
    saving: false,
    sources: cloneSources(state.sources),
    drivers: [],
    sourceDraft: nextBlankSourceDraft(),
    driverDraft: nextBlankDriverDraft(),
    sourcesStale: false,
    sourceKeepLocal: false,
  });
});

export const closeSourceManagementModal = action('closeSourceManagementModal', () => {
  lookupManagementState({
    sourceModalOpen: false,
    driverModalOpen: false,
    saving: false,
    sources: [],
    drivers: [],
    sourceDraft: nextBlankSourceDraft(),
    driverDraft: nextBlankDriverDraft(),
    sourcesStale: false,
    sourceKeepLocal: false,
    driversStale: false,
    driverKeepLocal: false,
  });
});

export const openDriverManagementModal = action('openDriverManagementModal', () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage drivers.');
    return;
  }

  lookupManagementState({
    sourceModalOpen: false,
    driverModalOpen: true,
    saving: false,
    sources: [],
    drivers: cloneDrivers(state.drivers),
    sourceDraft: nextBlankSourceDraft(),
    driverDraft: nextBlankDriverDraft(),
    driversStale: false,
    driverKeepLocal: false,
  });
});

export const closeDriverManagementModal = action('closeDriverManagementModal', () => {
  lookupManagementState({
    sourceModalOpen: false,
    driverModalOpen: false,
    saving: false,
    sources: [],
    drivers: [],
    sourceDraft: nextBlankSourceDraft(),
    driverDraft: nextBlankDriverDraft(),
    driversStale: false,
    driverKeepLocal: false,
  });
});

export const addManagedSource = action('addManagedSource', () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage sources.');
    return;
  }

  const acPerLoad = Number.parseFloat(state.lookupManagement.sourceDraft.acPerLoad);
  const spreadWidthFeet = Number.parseFloat(state.lookupManagement.sourceDraft.spreadWidthFeet);
  const defaultLoadLengthFeet = Number.parseFloat(state.lookupManagement.sourceDraft.defaultLoadLengthFeet);
  const nextSource: Source = {
    name: state.lookupManagement.sourceDraft.name.trim(),
    type: state.lookupManagement.sourceDraft.type,
    acPerLoad,
    spreadWidthFeet,
    defaultLoadLengthFeet,
  };
  const validationError = validateManagedSources([ ...state.lookupManagement.sources, nextSource ]);
  if (validationError) {
    snackbarMessage(validationError);
    return;
  }

  lookupManagementState({
    sources: [ ...state.lookupManagement.sources, nextSource ].sort((left, right) => left.name.localeCompare(right.name)),
    sourceDraft: nextBlankSourceDraft(),
  });
});

export const deleteManagedSource = action('deleteManagedSource', (key: string) => {
  state.lookupManagement.sources = state.lookupManagement.sources.filter(source => sourceRecordKey(source) !== key);
});

export const keepLocalManagedSources = action('keepLocalManagedSources', () => {
  lookupManagementState({
    sourcesStale: false,
    sourceKeepLocal: true,
  });
});

export const reloadManagedSourcesFromServer = action('reloadManagedSourcesFromServer', () => {
  lookupManagementState({
    sources: cloneSources(state.sources),
    sourceDraft: nextBlankSourceDraft(),
    sourcesStale: false,
    sourceKeepLocal: false,
  });
});

export const saveManagedSources = action('saveManagedSources', async () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage sources.');
    return;
  }

  const validationError = validateManagedSources(state.lookupManagement.sources);
  if (validationError) {
    snackbarMessage(validationError);
    return;
  }

  lookupManagementState({ saving: true });
  try {
    const savedSources = await persistSources(state.thisYear, state.lookupManagement.sources, currentActorEmail());
    const nextSavedSources = cloneSources(savedSources);
    sources(nextSavedSources);
    lookupManagementState({
      sources: cloneSources(nextSavedSources),
      sourceDraft: nextBlankSourceDraft(),
      sourcesStale: false,
      sourceKeepLocal: false,
    });
    snackbarMessage('Sources saved');
  } catch (error) {
    warn('Error saving manure sources. Error=%O', error);
    snackbarMessage(`Error saving sources: ${(error as Error).message}`);
  } finally {
    lookupManagementState({ saving: false });
  }
});

export const addManagedDriver = action('addManagedDriver', () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage drivers.');
    return;
  }

  const nextDriver: Driver = {
    name: state.lookupManagement.driverDraft.name.trim(),
  };
  const validationError = validateManagedDrivers([ ...state.lookupManagement.drivers, nextDriver ]);
  if (validationError) {
    snackbarMessage(validationError);
    return;
  }

  lookupManagementState({
    drivers: [ ...state.lookupManagement.drivers, nextDriver ].sort((left, right) => left.name.localeCompare(right.name)),
    driverDraft: nextBlankDriverDraft(),
  });
});

export const deleteManagedDriver = action('deleteManagedDriver', (key: string) => {
  state.lookupManagement.drivers = state.lookupManagement.drivers.filter(driver => driverRecordKey(driver) !== key);
});

export const keepLocalManagedDrivers = action('keepLocalManagedDrivers', () => {
  lookupManagementState({
    driversStale: false,
    driverKeepLocal: true,
  });
});

export const reloadManagedDriversFromServer = action('reloadManagedDriversFromServer', () => {
  lookupManagementState({
    drivers: cloneDrivers(state.drivers),
    driverDraft: nextBlankDriverDraft(),
    driversStale: false,
    driverKeepLocal: false,
  });
});

export const saveManagedDrivers = action('saveManagedDrivers', async () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage drivers.');
    return;
  }

  const validationError = validateManagedDrivers(state.lookupManagement.drivers);
  if (validationError) {
    snackbarMessage(validationError);
    return;
  }

  lookupManagementState({ saving: true });
  try {
    const savedDrivers = await persistDrivers(state.thisYear, state.lookupManagement.drivers, currentActorEmail());
    const nextSavedDrivers = cloneDrivers(savedDrivers);
    drivers(nextSavedDrivers);
    lookupManagementState({
      drivers: cloneDrivers(nextSavedDrivers),
      driverDraft: nextBlankDriverDraft(),
      driversStale: false,
      driverKeepLocal: false,
    });
    snackbarMessage('Drivers saved');
  } catch (error) {
    warn('Error saving manure drivers. Error=%O', error);
    snackbarMessage(`Error saving drivers: ${(error as Error).message}`);
  } finally {
    lookupManagementState({ saving: false });
  }
});

export const createManagedAccessRecord = action('createManagedAccessRecord', async () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage manure access.');
    return;
  }

  const email = normalizedEmail(state.accessManagement.draft.email);
  if (!email || !email.includes('@')) {
    snackbarMessage('Enter a valid email address.');
    return;
  }

  accessManagementState({ saving: true });
  try {
    const savedRecord = await persistAccessRecord({
      email,
      displayName: state.accessManagement.draft.displayName,
      enabled: state.accessManagement.draft.enabled,
      admin: state.accessManagement.draft.admin,
    }, currentActorEmail());
    accessManagementState({
      records: sortManagedAccessRecords([
        ...state.accessManagement.records.filter(record => record.email !== savedRecord.email),
        savedRecord,
      ]),
      draft: nextBlankAccessDraft(),
    });
    snackbarMessage(`Saved access for ${savedRecord.email}`);
  } catch (error) {
    warn('Error creating manure access record for email=%s. Error=%O', email, error);
    snackbarMessage(`Error saving access record: ${(error as Error).message}`);
  } finally {
    accessManagementState({ saving: false });
  }
});

export const keepLocalManagedAccess = action('keepLocalManagedAccess', () => {
  accessManagementState({
    stale: false,
    keepLocal: true,
  });
});

export const reloadManagedAccessFromServer = action('reloadManagedAccessFromServer', () => {
  accessManagementState({
    records: cloneAccessRecords(state.accessManagement.serverRecords),
    draft: nextBlankAccessDraft(),
    stale: false,
    keepLocal: false,
  });
});

export const saveManagedAccessRecord = action('saveManagedAccessRecord', async (email: string) => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage manure access.');
    return;
  }

  const record = findManagedAccessRecord(email);
  if (!record) {
    snackbarMessage(`Could not find access record for ${email}.`);
    return;
  }

  if (isCurrentUserAccessRecord(record.email) && (!record.enabled || !record.admin)) {
    snackbarMessage('You cannot remove your own enabled admin access while signed in.');
    return;
  }

  accessManagementState({ saving: true });
  try {
    const savedRecord = await persistAccessRecord(record, currentActorEmail());
    accessManagementState({
      records: sortManagedAccessRecords(
        state.accessManagement.records.map(existingRecord =>
          existingRecord.email === savedRecord.email ? savedRecord : existingRecord,
        ),
      ),
    });
    if (isCurrentUserAccessRecord(savedRecord.email)) {
      authState({
        admin: savedRecord.admin,
        displayName: savedRecord.displayName || state.auth.displayName || state.auth.email,
      });
    }
    snackbarMessage(`Saved access for ${savedRecord.email}`);
  } catch (error) {
    warn('Error saving manure access record for email=%s. Error=%O', email, error);
    snackbarMessage(`Error saving access record: ${(error as Error).message}`);
  } finally {
    accessManagementState({ saving: false });
  }
});

export const deleteManagedAccessRecord = action('deleteManagedAccessRecord', async (email: string) => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage manure access.');
    return;
  }

  const targetEmail = normalizedEmail(email);
  if (isCurrentUserAccessRecord(targetEmail)) {
    snackbarMessage('You cannot delete your own access while signed in.');
    return;
  }

  accessManagementState({ saving: true });
  try {
    await removeAccessRecord(targetEmail);
    accessManagementState({
      records: state.accessManagement.records.filter(record => record.email !== targetEmail),
    });
    snackbarMessage(`Deleted access for ${targetEmail}`);
  } catch (error) {
    warn('Error deleting manure access record for email=%s. Error=%O', targetEmail, error);
    snackbarMessage(`Error deleting access record: ${(error as Error).message}`);
  } finally {
    accessManagementState({ saving: false });
  }
});
export const refreshAccessRecord = action('refreshAccessRecord', async () => {
  if (!state.auth.email) {
    info('Skipping manure access refresh because no auth email is currently set');
    return null;
  }
  info('Refreshing manure access record for email=%s', state.auth.email);

  const accessRecord = await getAccessRecord(state.auth.email);
  if (!isAccessEnabled(accessRecord)) {
    info('Manure access refresh found no enabled access record for email=%s', state.auth.email);
    return null;
  }

  authState({
    admin: accessRecord.admin,
    displayName: accessRecord.displayName || state.auth.displayName,
  });
  info('Refreshed manure access record for email=%s admin=%s', state.auth.email, accessRecord.admin);

  return accessRecord;
});
