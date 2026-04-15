import { observable } from 'mobx';
import type { LatLngTuple } from 'leaflet';
import type { CompletionValues, FieldBoundary, FieldWorkBoard } from '@aultfarms/field-work';

export type EditableField = {
  cardId?: string;
  name: string;
  aliases: string[];
  acreage: number;
  boundary: FieldBoundary | null;
};

export type EditableCrop = {
  idList?: string;
  name: string;
  isTemplate: boolean;
  fieldNames: string[];
};

export type EditableOption = {
  key: string;
  cardId?: string;
  type: string;
  name: string;
  description: string;
};

export type FieldModalAction = 'complete' | 'uncomplete' | 'include' | 'exclude' | 'remove_exclude' | '';
export type AppIssue = {
  key: string;
  level: 'error' | 'warning';
  source: 'board' | 'runtime';
  message: string;
  count: number;
};

export type State = {
  loading: boolean;
  loadingError: string;
  trelloAuthorized: boolean;
  board: FieldWorkBoard | null;
  mode: 'operations' | 'field_manager' | 'crops_manager' | 'options_manager';
  mapView: {
    center: LatLngTuple;
    zoom: number;
  };
  selectedOperationName: string;
  selectedManagerFieldName: string;
  selectedCropName: string;
  fieldDrafts: EditableField[];
  fieldDraftsDirty: boolean;
  cropDrafts: EditableCrop[];
  cropDraftsDirty: boolean;
  optionDrafts: EditableOption[];
  optionDraftsDirty: boolean;
  snackbar: {
    open: boolean;
    message: string;
  };
  issuesModalOpen: boolean;
  issues: AppIssue[];
  fieldModal: {
    open: boolean;
    fieldName: string;
    action: FieldModalAction;
    date: string;
    note: string;
    values: CompletionValues;
  };
};

function assertMapView(value: unknown): asserts value is State['mapView'] {
  if (!value || typeof value !== 'object') {
    throw new Error('Expected map view to be an object');
  }

  const mapView = value as State['mapView'];
  if (!Array.isArray(mapView.center) || mapView.center.length !== 2) {
    throw new Error('Expected map center to be a 2-tuple');
  }
  if (typeof mapView.center[0] !== 'number' || typeof mapView.center[1] !== 'number') {
    throw new Error('Expected map center coordinates to be numbers');
  }
  if (typeof mapView.zoom !== 'number') {
    throw new Error('Expected map zoom to be a number');
  }
}

const defaultMapView: State['mapView'] = {
  center: [ 40.98147222, -86.19505556 ],
  zoom: 12,
};

let storedMapView = defaultMapView;
try {
  const localMapView = JSON.parse(localStorage.getItem('af.field-work.map') || '{}');
  assertMapView(localMapView);
  storedMapView = localMapView;
} catch (error) {
  void error;
}

let storedOperationName = '';
try {
  const localOperationName = localStorage.getItem('af.field-work.operation');
  if (localOperationName) {
    storedOperationName = localOperationName;
  }
} catch (error) {
  void error;
}

export const state = observable<State>({
  loading: true,
  loadingError: '',
  trelloAuthorized: false,
  board: null,
  mode: 'operations',
  mapView: storedMapView,
  selectedOperationName: storedOperationName,
  selectedManagerFieldName: '',
  selectedCropName: '',
  fieldDrafts: [],
  fieldDraftsDirty: false,
  cropDrafts: [],
  cropDraftsDirty: false,
  optionDrafts: [],
  optionDraftsDirty: false,
  snackbar: {
    open: false,
    message: '',
  },
  issuesModalOpen: false,
  issues: [],
  fieldModal: {
    open: false,
    fieldName: '',
    action: '',
    date: new Date().toISOString().split('T')[0] || '',
    note: '',
    values: {},
  },
});
