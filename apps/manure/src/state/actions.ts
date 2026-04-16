import { action, runInAction } from 'mobx';
import {
  assertDrivers,
  assertFields,
  assertLoadsRecords,
  assertSources,
  deleteAccessRecord as removeAccessRecord,
  emptyLoadRecord,
  getAccessRecord,
  isAccessEnabled,
  listAccessRecords,
  loadManureAppData,
  saveAccessRecord as persistAccessRecord,
  saveFields as persistFields,
  saveLoadRecord,
  type AccessRecord,
  type Driver,
  type Field,
  type FieldGeoJSON,
  type LoadsRecord,
  type LoadsRecordGeoJSON,
  type LoadsRecordGeoJSONProps,
  type Source,
} from '@aultfarms/manure';
import { getCurrentUser, signInWithGoogle, signOutBrowserUser } from '@aultfarms/firebase';
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';
import JSZip from 'jszip';
import * as toGeoJSON from '@tmcw/togeojson';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import bbox from '@turf/bbox';
import center from '@turf/center';
import { point } from '@turf/helpers';
import debug from 'debug';
import { state, type State } from './state';

const info = debug('af/manure:info');
const warn = debug('af/manure:warn');

function createLoadPoint(current: State['currentGPS']): Feature<Point> {
  return point([ current.lon, current.lat ]);
}

function refreshStoredLoadRecord(): void {
  localStorage.setItem('af.manure.loadRecord', JSON.stringify(state.load));
}

function currentActorEmail(): string {
  return state.auth.email || 'unknown@local';
}

function nextBlankLoad(): LoadsRecord {
  return {
    ...emptyLoadRecord(state.load.date),
    field: state.load.field,
    source: state.load.source,
    driver: state.load.driver,
  };
}

function mergeOrAppendLoad(nextLoad: LoadsRecord): LoadsRecord[] {
  const existingIndex = state.loads.findIndex(loadRecord => loadRecord.id === nextLoad.id);
  if (existingIndex >= 0) {
    return state.loads.map((loadRecord, index) => index === existingIndex ? nextLoad : loadRecord);
  }

  return [ ...state.loads, nextLoad ];
}

function nextBlankAccessDraft(): State['accessManagement']['draft'] {
  return {
    email: '',
    displayName: '',
    enabled: true,
    admin: false,
  };
}

function sortManagedAccessRecords(records: AccessRecord[]): AccessRecord[] {
  return [ ...records ].sort((left, right) => left.email.localeCompare(right.email));
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isCurrentUserAccessRecord(email: string): boolean {
  return normalizedEmail(email) === normalizedEmail(state.auth.email);
}

function findManagedAccessRecord(email: string): AccessRecord | undefined {
  return state.accessManagement.records.find(record => record.email === normalizedEmail(email));
}

async function loadSessionForUser(user: ReturnType<typeof getCurrentUser>): Promise<void> {
  if (!user?.email) {
    info('No authenticated Firebase user is available; applying signed-out state');
    applySignedOutUser();
    return;
  }
  info('Loading manure session for email=%s verified=%s', user.email, user.emailVerified);

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
    );
  } catch (error) {
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

export const authState = action('authState', (auth: Partial<State['auth']>) => {
  state.auth = {
    ...state.auth,
    ...auth,
  };
});

export const accessManagementState = action('accessManagementState', (accessManagement: Partial<State['accessManagement']>) => {
  state.accessManagement = {
    ...state.accessManagement,
    ...accessManagement,
  };
});

export const accessManagementDraft = action('accessManagementDraft', (draft: Partial<State['accessManagement']['draft']>) => {
  state.accessManagement.draft = {
    ...state.accessManagement.draft,
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

export const online = action('online', (isOnline: boolean) => {
  state.network.online = isOnline;
});

export const resetSessionData = action('resetSessionData', () => {
  fields([]);
  sources([]);
  drivers([]);
  loads([]);
  state.load = nextBlankLoad();
  refreshStoredLoadRecord();
  fieldsChanged(false);
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
    await signInWithGoogle();
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
) => {
  info('Applying signed-in manure user email=%s admin=%s', user.email, accessRecord.admin);
  authState({
    status: 'signed_in',
    email: user.email,
    displayName: accessRecord.displayName || user.displayName || user.email,
    admin: accessRecord.admin,
    error: '',
  });

  await loadAllData();
});

export const applySignedOutUser = action('applySignedOutUser', () => {
  info('Applying signed-out manure session state');
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

export const loadAllData = action('loadAllData', async () => {
  info('Loading all manure app data for year=%d', state.thisYear);
  loading(true);
  loadingError('');

  try {
    const data = await loadManureAppData(state.thisYear);
    assertFields(data.fields);
    assertSources(data.sources);
    assertDrivers(data.drivers);
    assertLoadsRecords(data.loads);
    assertLoadsRecords(data.previousLoads);

    fields(data.fields);
    sources(data.sources);
    drivers(data.drivers);
    loads([ ...data.loads, ...data.previousLoads ]);
    fieldsChanged(false);
    load({});
    info(
      'Loaded manure app data for year=%d fields=%d sources=%d drivers=%d loads=%d previousLoads=%d',
      state.thisYear,
      data.fields.length,
      data.sources.length,
      data.drivers.length,
      data.loads.length,
      data.previousLoads.length,
    );
  } catch (error) {
    warn('Error loading manure app data for year=%d. Error=%O', state.thisYear, error);
    loadingError(`Error loading manure data: ${(error as Error).message}`);
  } finally {
    loading(false);
  }
});

export const uploadKMZ = action('uploadKMZ', async (file: File) => {
  const newFields = await parseKMZIntoFields(file);
  const nextFields = JSON.parse(JSON.stringify(state.fields)) as Field[];

  for (const field of newFields) {
    const existing = nextFields.find(existingField => existingField.name === field.name);
    if (existing) {
      existing.name = field.name;
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
  loading(true);
  try {
    const savedFields = await persistFields(state.thisYear, state.fields, currentActorEmail());
    fields(savedFields);
    fieldsChanged(false);
    snackbarMessage('Fields saved');
  } catch (error) {
    loadingError(`Error updating fields: ${(error as Error).message}`);
  } finally {
    loading(false);
  }
});

export async function parseKMZIntoFields(file: File): Promise<{ name: string; boundary: Field['boundary'] }[]> {
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
      boundary: feature as Feature<Polygon | MultiPolygon>,
    }));
}

export const fieldName = action('fieldName', (oldName: string, newName: string) => {
  if (!newName) {
    snackbarMessage('Field name cannot be empty');
    return;
  }

  if (state.fields.find(field => field.name === newName && field.name !== oldName)) {
    snackbarMessage('Field name already exists');
    return;
  }

  const fieldIndex = state.fields.findIndex(field => field.name === oldName);
  if (fieldIndex >= 0) {
    fieldsChanged(true);
    state.fields[fieldIndex]!.name = newName;
  }
});

export const fieldBoundary = action('fieldBoundary', (name: string, boundary: Field['boundary']) => {
  const fieldIndex = state.fields.findIndex(field => field.name === name);
  if (fieldIndex >= 0) {
    fieldsChanged(true);
    state.fields[fieldIndex]!.boundary = boundary;
  } else {
    info('Could not find field with name %s', name);
  }
});

export const plusLoad = action('plusLoad', async () => {
  if (!state.load.date || !state.load.field || !state.load.source || !state.load.driver) {
    snackbarMessage('Cannot record load without a date, field, source, and driver');
    return;
  }

  runInAction(() => {
    state.load.loads += 1;
    state.load.geojson = {
      ...state.load.geojson,
      features: [ ...state.load.geojson.features, createLoadPoint(state.currentGPS) ],
    };
  });

  await saveLoad();
});

export const saveLoad = action('saveLoad', async () => {
  const currentLoad = state.load;
  if (!currentLoad.date || !currentLoad.field || !currentLoad.source || !currentLoad.driver) {
    snackbarMessage('Cannot record load without a date, field, source, and driver');
    return;
  }

  try {
    const savedLoad = await saveLoadRecord(state.thisYear, currentLoad, currentActorEmail());
    loads(mergeOrAppendLoad(savedLoad));
    load(savedLoad);
  } catch (error) {
    loadingError(`Error saving load: ${(error as Error).message}`);
  }
});

export const toggleConfigModal = action('toggleConfigModal', () => {
  state.config.modalOpen = !state.config.modalOpen;
});

export const closeAccessManagementModal = action('closeAccessManagementModal', () => {
  accessManagementState({
    modalOpen: false,
    loading: false,
    saving: false,
    records: [],
    draft: nextBlankAccessDraft(),
  });
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

  const knownLoad = state.loads.find(loadRecord =>
    loadRecord.date === state.load.date
    && loadRecord.source === state.load.source
    && loadRecord.field === state.load.field
    && loadRecord.driver === state.load.driver,
  );

  if (knownLoad) {
    state.load.id = knownLoad.id;
    state.load.createdAt = knownLoad.createdAt;
    state.load.updatedAt = knownLoad.updatedAt;
    state.load.updatedBy = knownLoad.updatedBy;
    if (!('loads' in record)) {
      state.load.loads = knownLoad.loads;
    }
    if (!('geojson' in record)) {
      state.load.geojson = knownLoad.geojson;
    }
  } else {
    if (!('loads' in record)) {
      state.load.loads = 0;
    }
    if (!('geojson' in record)) {
      state.load.geojson = { type: 'FeatureCollection', features: [] };
    }
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
});

export const drivers = action('drivers', (nextDrivers: Driver[]) => {
  state.drivers = nextDrivers;
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
});

let cachedGeojsonLoads: FeatureCollection<Point, LoadsRecordGeoJSONProps> = { type: 'FeatureCollection', features: [] };
export const geojsonLoads = action('geojsonLoads', (geojson?: FeatureCollection<Point, LoadsRecordGeoJSONProps>) => {
  if (geojson) {
    cachedGeojsonLoads = geojson;
    state.geojsonLoads.rev += 1;
  }
  return cachedGeojsonLoads;
});


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

export const loadAccessManagementRecords = action('loadAccessManagementRecords', async () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage manure access.');
    return;
  }

  accessManagementState({ loading: true });
  try {
    const records = await listAccessRecords();
    accessManagementState({ records });
  } catch (error) {
    warn('Error loading manure access management records. Error=%O', error);
    snackbarMessage(`Error loading access records: ${(error as Error).message}`);
  } finally {
    accessManagementState({ loading: false });
  }
});

export const openAccessManagementModal = action('openAccessManagementModal', async () => {
  if (!state.auth.admin) {
    snackbarMessage('Only admins can manage manure access.');
    return;
  }

  accessManagementState({
    modalOpen: true,
    records: [],
    draft: nextBlankAccessDraft(),
  });
  await loadAccessManagementRecords();
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
