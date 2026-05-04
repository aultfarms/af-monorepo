import { action, runInAction } from 'mobx';
import {
  createLoadRecordId,
  createLoadGroupKey,
  assertDrivers,
  assertFields,
  assertLoadsRecords,
  assertSpreadRegionAssignments,
  assertSpreadRegions,
  assertSources,
  deleteAccessRecord as removeAccessRecord,
  deleteLoadRecords as removeLoadRecords,
  deleteSpreadRegionAssignments as removeSpreadRegionAssignments,
  deleteSpreadRegions as removeSpreadRegions,
  emptyLoadRecord,
  getAccessRecord,
  isAccessEnabled,
  listAccessRecords,
  loadManureAppData,
  nominalFieldAcreage,
  saveAccessRecord as persistAccessRecord,
  saveDrivers as persistDrivers,
  saveFields as persistFields,
  saveLoadRecord,
  saveSpreadRegionAssignments as persistSpreadRegionAssignments,
  saveSpreadRegions as persistSpreadRegions,
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
  type SpreadRegionAssignment,
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
import { summarizeLoadGroupsByKey } from '../loadGroups';
import { state, type State } from './state';

const info = debug('af/manure:info');
const warn = debug('af/manure:warn');

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

  const groupsByKey = summarizeLoadGroupsByKey(state.loads, state.regionAssignments, state.thisYear);
  const groups = loadGroupKeys
    .map(loadGroupKey => groupsByKey.get(loadGroupKey))
    .filter((group): group is NonNullable<typeof group> => !!group);

  if (groups.length < 1) {
    snackbarMessage('No matching grouped load rows were found to delete.');
    return;
  }

  const totalLoads = groups.reduce((sum, group) => sum + group.totalLoads, 0);
  const confirmMessage = groups.length === 1
    ? `Delete ${totalLoads} loads from ${groups[0]!.date} ${groups[0]!.field} / ${groups[0]!.source}? This also removes linked spread-region assignments and any region left with no assigned loads.`
    : `Delete ${totalLoads} loads across ${groups.length} grouped history rows? This also removes linked spread-region assignments and any region left with no assigned loads.`;

  if (!window.confirm(confirmMessage)) {
    return;
  }

  const selectedSet = new Set(groups.map(group => group.loadGroupKey));
  const loadRecordIdsToDelete = groups.flatMap(group => group.records.map(record => record.id || createLoadRecordId(record)));
  const assignmentsToDelete = state.regionAssignments.filter(assignment => selectedSet.has(assignment.loadGroupKey));
  const assignmentIdsToDelete = assignmentsToDelete.map(
    assignment => assignment.id || `${assignment.regionId}__${assignment.loadGroupKey}`,
  );
  const nextAssignments = state.regionAssignments.filter(assignment => !selectedSet.has(assignment.loadGroupKey));
  const affectedRegionIds = new Set(assignmentsToDelete.map(assignment => assignment.regionId));
  const remainingRegionIds = new Set(nextAssignments.map(assignment => assignment.regionId));
  const regionIdsToDelete = [ ...affectedRegionIds ].filter(regionId => !remainingRegionIds.has(regionId));
  const nextRegions = state.regions.filter(region => !region.id || !regionIdsToDelete.includes(region.id));
  const nextLoads = state.loads.filter(loadRecord => !selectedSet.has(createLoadGroupKey(loadRecord)));
  const currentLoadId = state.load.id || (
    state.load.date && state.load.field && state.load.source && state.load.driver
      ? createLoadRecordId(state.load)
      : ''
  );

  historyManagementState({ deleting: true });
  try {
    if (assignmentIdsToDelete.length > 0) {
      await removeSpreadRegionAssignments(state.thisYear, assignmentIdsToDelete);
    }
    if (regionIdsToDelete.length > 0) {
      await removeSpreadRegions(state.thisYear, regionIdsToDelete);
    }
    if (loadRecordIdsToDelete.length > 0) {
      await removeLoadRecords(state.thisYear, loadRecordIdsToDelete);
    }

    regionAssignments(nextAssignments);
    regions(nextRegions);
    loads(nextLoads);
    historyManagementState({
      selectedLoadGroupKeys: state.historyManagement.selectedLoadGroupKeys.filter(key => !selectedSet.has(key)),
    });
    if (currentLoadId && loadRecordIdsToDelete.includes(currentLoadId)) {
      load({});
    }
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
    const groupsByKey = summarizeLoadGroupsByKey(state.loads, state.regionAssignments, state.thisYear);
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
          group.totalLoads,
          preferredLoadCounts?.[group.loadGroupKey]
            ?? (group.unassignedLoads > 0 ? group.unassignedLoads : group.totalLoads),
        ),
      ),
    ]));
    const defaultHeading = storedFieldHeading(targetField) ?? fieldDefaultHeading(targetField);
    drawState({
      modalOpen: true,
      saving: false,
      mode: preferredMode || (selectedGroups.length > 1 ? 'polygon' : 'load'),
      targetLoadGroupKeys: selectedGroups.map(group => group.loadGroupKey),
      assignmentLoadCounts,
      targetField,
      headingDegrees: defaultHeading,
      useDefaultFieldHeading: storedFieldHeading(targetField) === null,
    });
  },
);

export const openDrawModalForCurrentLoad = action('openDrawModalForCurrentLoad', () => {
  if (!state.load.date || !state.load.field || !state.load.source) {
    snackbarMessage('Select a date, field, and source before drawing.');
    return;
  }
  openDrawModalForLoadGroups([ createLoadGroupKey(state.load) ], 'load');
});

export const closeDrawModal = action('closeDrawModal', () => {
  drawState({
    modalOpen: false,
    saving: false,
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
  assignmentDrafts: Array<Omit<SpreadRegionAssignment, 'id' | 'regionId' | 'createdAt' | 'updatedAt' | 'updatedBy'>>,
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
    const regionId = regionDraft.id || makeClientId('region');
    const regionToSave: SpreadRegion = {
      ...regionDraft,
      id: regionId,
    };
    const nextRegions = state.regions.filter(region => region.id !== regionId);
    const savedRegions = await persistSpreadRegions(
      state.thisYear,
      [ ...nextRegions, regionToSave ],
      currentActorEmail(),
    );

    const assignmentsToSave: SpreadRegionAssignment[] = assignmentDrafts.map(assignment => ({
      ...assignment,
      regionId,
    }));
    const nextAssignments = state.regionAssignments.filter(assignment => assignment.regionId !== regionId);
    const savedAssignments = await persistSpreadRegionAssignments(
      state.thisYear,
      [ ...nextAssignments, ...assignmentsToSave ],
      currentActorEmail(),
    );

    regions(savedRegions);
    regionAssignments(savedAssignments);
    historyManagementState({
      selectedLoadGroupKeys: [],
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

export const drawState = action('drawState', (draw: Partial<State['draw']>) => {
  state.draw = {
    ...state.draw,
    ...draw,
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
  sources([]);
  drivers([]);
  loads([]);
  previousLoads([]);
  regions([]);
  regionAssignments([]);
  state.load = nextBlankLoad();
  refreshStoredLoadRecord();
  fieldsChanged(false);
  historyManagementState({
    modalOpen: false,
    selectedLoadGroupKeys: [],
    deleting: false,
  });
  drawState({
    enabled: false,
    modalOpen: false,
    saving: false,
    mode: 'load',
    targetLoadGroupKeys: [],
    assignmentLoadCounts: {},
    targetField: '',
    headingDegrees: null,
    useDefaultFieldHeading: true,
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
    assertSpreadRegions(data.regions);
    assertSpreadRegionAssignments(data.regionAssignments);

    fields(data.fields);
    sources(data.sources);
    drivers(data.drivers);
    loads(data.loads);
    previousLoads(data.previousLoads);
    regions(data.regions);
    regionAssignments(data.regionAssignments);
    fieldsChanged(false);
    load({});
    info(
      'Loaded manure app data for year=%d fields=%d sources=%d drivers=%d loads=%d previousLoads=%d regions=%d assignments=%d',
      state.thisYear,
      data.fields.length,
      data.sources.length,
      data.drivers.length,
      data.loads.length,
      data.previousLoads.length,
      data.regions.length,
      data.regionAssignments.length,
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

export async function parseKMZIntoFields(file: File): Promise<Array<Pick<Field, 'name' | 'acreage' | 'boundary'>>> {
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
    state.fields[fieldIndex]!.acreage = nominalFieldAcreage(newName, state.fields[fieldIndex]!.boundary);
  }
});

export const fieldBoundary = action('fieldBoundary', (name: string, boundary: Field['boundary']) => {
  const fieldIndex = state.fields.findIndex(field => field.name === name);
  if (fieldIndex >= 0) {
    fieldsChanged(true);
    state.fields[fieldIndex]!.boundary = boundary;
    state.fields[fieldIndex]!.acreage = nominalFieldAcreage(state.fields[fieldIndex]!.name, boundary);
  } else {
    info('Could not find field with name %s', name);
  }
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

  const savedLoad = await saveLoad(nextLoad);
  if (savedLoad && state.draw.enabled) {
    const loadGroupKey = createLoadGroupKey(savedLoad);
    openDrawModalForLoadGroups([ loadGroupKey ], 'load', {
      [loadGroupKey]: 1,
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
    const savedLoad = await saveLoadRecord(state.thisYear, currentLoad, currentActorEmail());
    loads(mergeOrAppendLoad(savedLoad));
    load(savedLoad);
    return savedLoad;
  } catch (error) {
    loadingError(`Error saving load: ${(error as Error).message}`);
  }
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
});

export const regionAssignments = action('regionAssignments', (nextAssignments: SpreadRegionAssignment[]) => {
  state.regionAssignments = nextAssignments;
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

export const openHistoryModal = action('openHistoryModal', () => {
  historyManagementState({
    modalOpen: true,
    selectedLoadGroupKeys: [],
    deleting: false,
  });
});

export const closeHistoryModal = action('closeHistoryModal', () => {
  historyManagementState({
    modalOpen: false,
    selectedLoadGroupKeys: [],
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
    sources(savedSources);
    lookupManagementState({
      sources: cloneSources(savedSources),
      sourceDraft: nextBlankSourceDraft(),
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
    drivers(savedDrivers);
    lookupManagementState({
      drivers: cloneDrivers(savedDrivers),
      driverDraft: nextBlankDriverDraft(),
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
