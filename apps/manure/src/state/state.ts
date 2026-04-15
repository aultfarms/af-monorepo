import { observable } from 'mobx';
import debug from 'debug';
import type { LatLngTuple } from 'leaflet';
import {
  assertGPS,
  emptyLoadRecord,
  type Driver,
  type Field,
  type LoadsRecord,
  type Source,
} from '@aultfarms/manure';
import type { FirebaseCacheMode } from '@aultfarms/firebase';

const info = debug('af/manure#state:info');

export type BigData = {
  rev: number;
};

export type AuthStatus = 'checking' | 'signed_out' | 'signed_in' | 'access_denied';

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
  loads: LoadsRecord[];
  fields: Field[];
  sources: Source[];
  drivers: Driver[];
  geojsonFields: BigData;
  geojsonLoads: BigData;
  load: LoadsRecord;
  config: {
    modalOpen: boolean;
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

const load = emptyLoadRecord();
try {
  const localLoad = JSON.parse(localStorage.getItem('af.manure.loadRecord') || '{}') as Partial<LoadsRecord>;
  if (typeof localLoad.field === 'string') load.field = localLoad.field;
  if (typeof localLoad.source === 'string') load.source = localLoad.source;
  if (typeof localLoad.driver === 'string') load.driver = localLoad.driver;
  if (typeof localLoad.date === 'string') load.date = localLoad.date;
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
  loads: [],
  fields: [],
  sources: [],
  drivers: [],
  geojsonFields: { rev: 0 },
  geojsonLoads: { rev: 0 },
  load,
  config: {
    modalOpen: false,
  },
  loadingError: '',
  loading: true,
  snackbar: {
    open: false,
    message: '',
  },
});
