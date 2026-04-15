import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { GeoJSON, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { Feature, FeatureCollection, GeoJsonObject, MultiPolygon, Polygon } from 'geojson';
import { context } from './state';
import './Map.css';

type FieldFeature = Feature<Polygon | MultiPolygon, { name: string }>;
type FieldFeatureCollection = FeatureCollection<Polygon | MultiPolygon, { name: string }>;

function fieldCollection(fields: Array<{ name: string; boundary: Feature<Polygon | MultiPolygon> | null }>): FieldFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fields
      .filter((field): field is { name: string; boundary: Feature<Polygon | MultiPolygon> } => !!field.boundary)
      .map((field) => ({
        ...field.boundary,
        properties: { name: field.name },
      })),
  };
}

function boundaryFromFeatureGroup(featureGroup: L.FeatureGroup): Feature<Polygon | MultiPolygon> | null {
  const polygons: Feature<Polygon>[] = [];

  featureGroup.eachLayer((layer) => {
    if (layer instanceof L.Polygon) {
      const feature = layer.toGeoJSON() as Feature<Polygon>;
      if (feature.geometry.type === 'Polygon') {
        polygons.push(feature);
      }
    }
  });

  if (polygons.length < 1) {
    return null;
  }
  if (polygons.length === 1) {
    return polygons[0];
  }

  return {
    type: 'Feature',
    properties: polygons[0]?.properties || {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: polygons.map(polygon => polygon.geometry.coordinates),
    },
  };
}

const MapEvents = () => {
  const { actions } = React.useContext(context);

  useMapEvents({
    moveend: (event) => {
      const map = event.target;
      const center = map.getCenter();
      const zoom = map.getZoom();
      actions.mapView({
        center: [ center.lat, center.lng ],
        zoom,
      });
    },
  });

  return null;
};

const MapController = observer(() => {
  const map = useMap();
  const { state } = React.useContext(context);

  useEffect(() => {
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const targetCenter = state.mapView.center;
    const targetZoom = state.mapView.zoom;

    if (
      currentCenter.lat !== targetCenter[0]
      || currentCenter.lng !== targetCenter[1]
      || currentZoom !== targetZoom
    ) {
      map.setView(targetCenter, targetZoom);
    }
  }, [map, state.mapView.center, state.mapView.zoom]);

  return null;
});

const FieldManagerDrawControl = observer(() => {
  const map = useMap();
  const { state, actions } = React.useContext(context);
  const featureGroupRef = React.useRef<L.FeatureGroup | null>(null);
  const controlRef = React.useRef<L.Control.Draw | null>(null);
  const selectedField = state.fieldDrafts.find(field => field.name === state.selectedManagerFieldName) || null;
  const selectedBoundary = selectedField?.boundary || null;

  useEffect(() => {
    const featureGroup = new L.FeatureGroup();
    featureGroupRef.current = featureGroup;
    map.addLayer(featureGroup);

    return () => {
      map.removeLayer(featureGroup);
      featureGroupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const featureGroup = featureGroupRef.current;
    if (!featureGroup) {
      return;
    }
    featureGroup.clearLayers();
    if (!selectedBoundary) {
      return;
    }
    const geoJsonLayer = L.geoJSON(selectedBoundary as unknown as GeoJsonObject);
    geoJsonLayer.eachLayer(layer => featureGroup.addLayer(layer));
  }, [selectedBoundary]);

  useEffect(() => {
    if (controlRef.current) {
      map.removeControl(controlRef.current);
      controlRef.current = null;
    }

    const featureGroup = featureGroupRef.current;
    if (!featureGroup || !selectedField) {
      return;
    }

    const drawControl = new L.Control.Draw({
      position: 'topright',
      edit: {
        featureGroup,
        edit: selectedBoundary ? {} : false,
        remove: !!selectedBoundary,
      },
      draw: {
        polygon: !selectedBoundary
          ? {
              allowIntersection: false,
              showArea: true,
            }
          : false,
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
    });
    controlRef.current = drawControl;
    map.addControl(drawControl);

    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map, selectedBoundary, selectedField]);

  useEffect(() => {
    const handleCreated: L.LeafletEventHandlerFn = (event) => {
      const createdEvent = event as L.DrawEvents.Created;
      if (!selectedField || !featureGroupRef.current) {
        return;
      }
      featureGroupRef.current.clearLayers();
      featureGroupRef.current.addLayer(createdEvent.layer);
      actions.fieldDraftBoundary(selectedField.name, boundaryFromFeatureGroup(featureGroupRef.current));
    };
    const handleEdited: L.LeafletEventHandlerFn = () => {
      if (!selectedField || !featureGroupRef.current) {
        return;
      }
      actions.fieldDraftBoundary(selectedField.name, boundaryFromFeatureGroup(featureGroupRef.current));
    };
    const handleDeleted: L.LeafletEventHandlerFn = () => {
      if (!selectedField) {
        return;
      }
      actions.fieldDraftBoundary(selectedField.name, null);
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, handleEdited);
    map.on(L.Draw.Event.DELETED, handleDeleted);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, handleEdited);
      map.off(L.Draw.Event.DELETED, handleDeleted);
    };
  }, [actions, map, selectedField]);

  return null;
});

export const Map = observer(() => {
  const { state, actions } = React.useContext(context);
  const operation = state.board?.operations.find(candidate => candidate.name === state.selectedOperationName) || null;
  const allBoardFields = state.board?.fields || [];
  const otherDraftFields = state.fieldDrafts.filter(field => field.name !== state.selectedManagerFieldName);
  const selectedDraftField = state.fieldDrafts.find(field => field.name === state.selectedManagerFieldName) || null;
  const selectedCrop = state.cropDrafts.find(crop => crop.name === state.selectedCropName) || null;
  const selectedCropFieldNames = new Set(selectedCrop?.fieldNames || []);
  const cropMembershipKey = selectedCrop?.fieldNames.join('|') || '';
  const showOperationMap = state.mode === 'operations' || state.mode === 'options_manager';
  const operationKey = `${state.mode}-${state.selectedOperationName}-${state.selectedManagerFieldName}-${state.selectedCropName}-${cropMembershipKey}-${state.fieldDrafts.length}-${state.cropDrafts.length}-${allBoardFields.length}`;

  const handleFeatureClick = (feature: FieldFeature) => {
    const fieldName = feature.properties?.name;
    if (fieldName) {
      actions.handleMapFieldClick(fieldName);
    }
  };

  const operationData = fieldCollection(allBoardFields.map(field => ({
    name: field.name,
    boundary: field.boundary,
  })));
  const managerOtherData = fieldCollection(otherDraftFields);
  const managerSelectedData = fieldCollection(selectedDraftField ? [ selectedDraftField ] : []);
  const cropManagerOtherData = fieldCollection(allBoardFields
    .filter(field => !selectedCropFieldNames.has(field.name))
    .map(field => ({
      name: field.name,
      boundary: field.boundary,
    })));
  const cropManagerSelectedData = fieldCollection(allBoardFields
    .filter(field => selectedCropFieldNames.has(field.name))
    .map(field => ({
      name: field.name,
      boundary: field.boundary,
    })));

  return (
    <MapContainer
      className="mapcontainer"
      center={state.mapView.center}
      zoom={state.mapView.zoom}
      zoomControl={false}
    >
      <TileLayer url="https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.jpg" />

      {showOperationMap && (
        <GeoJSON
          key={operationKey}
          data={operationData}
          style={(feature) => {
            const fieldName = feature?.properties?.name || '';
            const fieldState = operation?.fieldStateByName[fieldName] || null;
            if (!fieldState || fieldState.status === 'ineligible') {
              return {
                color: '#616161',
                fillColor: '#9e9e9e',
                fillOpacity: 0.35,
                weight: 2,
                opacity: 0.8,
              };
            }
            if (fieldState.status === 'completed') {
              return {
                color: '#1b5e20',
                fillColor: '#4caf50',
                fillOpacity: 0.45,
                weight: 2,
                opacity: 0.9,
              };
            }
            return {
              color: '#b71c1c',
              fillColor: '#ef5350',
              fillOpacity: 0.35,
              weight: 2,
              opacity: 0.9,
            };
          }}
          onEachFeature={(feature, layer) => {
            layer.on('click', () => handleFeatureClick(feature as FieldFeature));
          }}
        />
      )}

      {state.mode === 'field_manager' && (
        <>
          <GeoJSON
            key={`${operationKey}-others`}
            data={managerOtherData}
            style={() => ({
              color: '#616161',
              fillColor: '#bdbdbd',
              fillOpacity: 0.25,
              weight: 2,
              opacity: 0.8,
            })}
            onEachFeature={(feature, layer) => {
              layer.on('click', () => handleFeatureClick(feature as FieldFeature));
            }}
          />
          <GeoJSON
            key={`${operationKey}-selected`}
            data={managerSelectedData}
            style={() => ({
              color: '#0d47a1',
              fillColor: '#42a5f5',
              fillOpacity: 0.35,
              weight: 3,
              opacity: 0.95,
            })}
            onEachFeature={(feature, layer) => {
              layer.on('click', () => handleFeatureClick(feature as FieldFeature));
            }}
          />
          <FieldManagerDrawControl />
        </>
      )}

      {state.mode === 'crops_manager' && (
        <>
          <GeoJSON
            key={`${operationKey}-crop-others`}
            data={cropManagerOtherData}
            style={() => ({
              color: '#616161',
              fillColor: '#bdbdbd',
              fillOpacity: 0.25,
              weight: 2,
              opacity: 0.8,
            })}
            onEachFeature={(feature, layer) => {
              layer.on('click', () => handleFeatureClick(feature as FieldFeature));
            }}
          />
          <GeoJSON
            key={`${operationKey}-crop-selected`}
            data={cropManagerSelectedData}
            style={() => ({
              color: '#1b5e20',
              fillColor: '#66bb6a',
              fillOpacity: 0.4,
              weight: 3,
              opacity: 0.95,
            })}
            onEachFeature={(feature, layer) => {
              layer.on('click', () => handleFeatureClick(feature as FieldFeature));
            }}
          />
        </>
      )}

      <MapEvents />
      <MapController />
    </MapContainer>
  );
});
