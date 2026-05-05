import { observable } from 'mobx';
import debug from 'debug';
import type { LatLngTuple } from 'leaflet';
import {
  type AccessRecord,
  assertGPS,
  emptyLoadRecord,
  type Driver,
  type Field,
  type LoadsRecord,
  type Source,
  type SpreadRegion,
  type SpreadRegionAssignment,
} from '@aultfarms/manure';
import type { FirebaseCacheMode } from '@aultfarms/firebase';

const info = debug('af/manure#state:info');

export type BigData = {
  rev: number;
};

export type AuthStatus = 'checking' | 'signed_out' | 'signed_in' | 'access_denied';
export type AccessManagementDraft = {
  email: string;
  displayName: string;
  enabled: boolean;
  admin: boolean;
};
export type SourceManagementDraft = {
  name: string;
  type: Source['type'];
  acPerLoad: string;
  spreadWidthFeet: string;
  defaultLoadLengthFeet: string;
};
export type DriverManagementDraft = {
  name: string;
};
export type DrawManagementState = {
  enabled: boolean;
  modalOpen: boolean;
  saving: boolean;
  purpose: 'region' | 'fieldHeading' | 'fieldBoundary';
  mode: SpreadRegion['mode'];
  targetLoadGroupKeys: string[];
  assignmentLoadCounts: Record<string, number>;
  targetField: string;
  headingDegrees: number | null;
  useDefaultFieldHeading: boolean;
};
export type ActivityOverlayState = {
  open: boolean;
  title: string;
  message: string;
};

export type State = {
  thisYear: number;
  auth: {
    status: AuthStatus;
    email: string;
    displayName: string;
    admin: boolean;
    error: string;
    cacheMode: FirebaseCacheMode | 'unknown';
  };
  network: {
    online: boolean;
  };
  currentGPS: { lat: number; lon: number };
  gpsMode: 'map' | 'me';
  mapView: {
    center: LatLngTuple;
    zoom: number;
  };
  mode: 'loads' | 'fields';
  editingField: string;
  fieldsChanged: boolean;
  pendingBoundaryFieldNames: string[];
  loads: LoadsRecord[];
  previousLoads: LoadsRecord[];
  fields: Field[];
  sources: Source[];
  drivers: Driver[];
  regions: SpreadRegion[];
  regionAssignments: SpreadRegionAssignment[];
  geojsonFields: BigData;
  geojsonLoads: BigData;
  geojsonRegions: BigData;
  load: LoadsRecord;
  accessManagement: {
    modalOpen: boolean;
    loading: boolean;
    saving: boolean;
    records: AccessRecord[];
    draft: AccessManagementDraft;
  };
  historyManagement: {
    modalOpen: boolean;
    selectedLoadGroupKeys: string[];
    deleting: boolean;
  };
  draw: DrawManagementState;
  activityOverlay: ActivityOverlayState;
  lookupManagement: {
    sourceModalOpen: boolean;
    driverModalOpen: boolean;
    saving: boolean;
    sources: Source[];
    drivers: Driver[];
    sourceDraft: SourceManagementDraft;
    driverDraft: DriverManagementDraft;
  };
  loadingError: string;
  loading: boolean;
  snackbar: {
    open: boolean;
    message: string;
  };
};

function assertMapView(value: unknown): asserts value is State['mapView'] {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected MapView to be a truthy object');
  }

  const mapView = value as State['mapView'];
  if (!Array.isArray(mapView.center) || mapView.center.length !== 2) {
    throw new Error('Expected MapView.center to be an array of length 2');
  }

  for (const coordinate of mapView.center) {
    if (typeof coordinate !== 'number') {
      throw new Error('Expected MapView.center to be an array of numbers');
    }
  }

  if (typeof mapView.zoom !== 'number') {
    throw new Error('Expected MapView.zoom to be a number');
  }

  if (mapView.zoom < 0) {
    throw new Error('Expected MapView.zoom to be a positive number');
  }

  if (mapView.zoom > 20) {
    throw new Error('Expected MapView.zoom to be <= 20');
  }
}

function emptyAccessManagementDraft(): AccessManagementDraft {
  return {
    email: '',
    displayName: '',
    enabled: true,
    admin: false,
  };
}

function emptySourceManagementDraft(): SourceManagementDraft {
  return {
    name: '',
    type: 'solid',
    acPerLoad: '',
    spreadWidthFeet: '40',
    defaultLoadLengthFeet: '500',
  };
}

function emptyDriverManagementDraft(): DriverManagementDraft {
  return {
    name: '',
  };
}

function emptyDrawManagementState(): DrawManagementState {
  return {
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
  };
}

function emptyActivityOverlayState(): ActivityOverlayState {
  return {
    open: false,
    title: '',
    message: '',
  };
}

const load = emptyLoadRecord();
try {
  const localLoad = JSON.parse(localStorage.getItem('af.manure.loadRecord') || '{}') as Partial<LoadsRecord>;
  if (typeof localLoad.field === 'string') load.field = localLoad.field;
  if (typeof localLoad.source === 'string') load.source = localLoad.source;
  if (typeof localLoad.driver === 'string') load.driver = localLoad.driver;
} catch (_error) {
  info('No valid previous record found in localStorage, using default');
}

let currentGPS = { lat: 40.98147222, lon: -86.19505556 };
try {
  const localCurrentGPS = JSON.parse(localStorage.getItem('af.manure.currentGPS') || '{}');
  assertGPS(localCurrentGPS);
  currentGPS = localCurrentGPS;
} catch (_error) {
  info('No valid previous GPS found in localStorage, using default');
}

let mapView: State['mapView'] = {
  center: [ 40.98147222, -86.19505556 ],
  zoom: 12,
};
try {
  const localMapView = JSON.parse(localStorage.getItem('af.manure.map') || '{}');
  assertMapView(localMapView);
  mapView = localMapView;
} catch (_error) {
  info('No valid previous map center/zoom found in localStorage, using default');
}

export const state = observable<State>({
  thisYear: new Date().getFullYear(),
  auth: {
    status: 'checking',
    email: '',
    displayName: '',
    admin: false,
    error: '',
    cacheMode: 'unknown',
  },
  network: {
    online: navigator.onLine,
  },
  currentGPS,
  gpsMode: 'me',
  mapView,
  mode: 'loads',
  editingField: '',
  fieldsChanged: false,
  pendingBoundaryFieldNames: [],
  loads: [],
  previousLoads: [],
  fields: [],
  sources: [],
  drivers: [],
  regions: [],
  regionAssignments: [],
  geojsonFields: { rev: 0 },
  geojsonLoads: { rev: 0 },
  geojsonRegions: { rev: 0 },
  load,
  accessManagement: {
    modalOpen: false,
    loading: false,
    saving: false,
    records: [],
    draft: emptyAccessManagementDraft(),
  },
  historyManagement: {
    modalOpen: false,
    selectedLoadGroupKeys: [],
    deleting: false,
  },
  draw: emptyDrawManagementState(),
  activityOverlay: emptyActivityOverlayState(),
  lookupManagement: {
    sourceModalOpen: false,
    driverModalOpen: false,
    saving: false,
    sources: [],
    drivers: [],
    sourceDraft: emptySourceManagementDraft(),
    driverDraft: emptyDriverManagementDraft(),
  },
  loadingError: '',
  loading: true,
  snackbar: {
    open: false,
    message: '',
  },
});
