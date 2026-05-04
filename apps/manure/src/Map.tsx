import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { context } from './state';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap, GeoJSON } from 'react-leaflet';
import { IconButton, Tooltip, Typography } from '@mui/material';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import L from 'leaflet';
import debug from 'debug';
import type { Feature, Geometry } from 'geojson';
import { createLoadGroupKey } from '@aultfarms/manure';

import 'leaflet/dist/leaflet.css';
import './Map.css';

const info = debug('af/manure#Map:info');

const currentLocationIcon = new L.DivIcon({
  html: `
    <svg width="28" height="28" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="10" fill="#1976D2" stroke="white" stroke-width="3"/>
    </svg>
  `,
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const MapEvents = () => {
  const { actions } = React.useContext(context);

  useMapEvents({
    moveend: (e) => {
      const map = e.target;
      const center = map.getCenter();
      const zoom = map.getZoom();
      actions.mapView({
        center: [center.lat, center.lng],
        zoom,
      });
    },
  });

  return null;
};

// Updates map view based on state changes
const MapController = observer(() => {
  const map = useMap();
  const { state } = React.useContext(context);

  useEffect(() => {
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const stateCenter = state.mapView.center;
    const stateZoom = state.mapView.zoom;

    // Only update if the map's view differs from the state
    if (
      currentCenter.lat !== stateCenter[0] ||
      currentCenter.lng !== stateCenter[1] ||
      currentZoom !== stateZoom
    ) {
      map.setView(stateCenter, stateZoom);
    }
  }, [state.mapView.center, state.mapView.zoom, map]);

  return null;
});

export const Map = observer(() => {
  const { state, actions } = React.useContext(context);
  const l = state.load;
  const currentLoadGroupKey = state.load.date && state.load.field && state.load.source
    ? createLoadGroupKey(state.load)
    : '';
  const selectedRegionIds = React.useMemo(() => {
    const selectedGroupKeys = new Set([
      ...state.historyManagement.selectedLoadGroupKeys,
      ...state.draw.targetLoadGroupKeys,
    ]);
    return new Set(
      state.regionAssignments
        .filter(assignment => selectedGroupKeys.has(assignment.loadGroupKey))
        .map(assignment => assignment.regionId),
    );
  }, [state.draw.targetLoadGroupKeys, state.historyManagement.selectedLoadGroupKeys, state.regionAssignments]);
  const currentRegionIds = React.useMemo(() => (
    new Set(
      state.regionAssignments
        .filter(assignment => assignment.loadGroupKey === currentLoadGroupKey)
        .map(assignment => assignment.regionId),
    )
  ), [currentLoadGroupKey, state.regionAssignments]);
  const todayLoads = state.loads
    .filter(r => r.date === l.date && r.field === l.field && r.source === l.source)
    .reduce((sum, r) => sum + r.loads, 0);
  const seasonLoads = state.loads
    .filter(r => r.field === l.field && r.source === l.source)
    .reduce((sum, r) => sum + r.loads, 0);

  // Referencing rev so mobx will redraw
  if (state.geojsonFields.rev === 0) {
    info('No geojson fields yet');
  }

  const handleFieldClick = (feature: Feature<Geometry, { name?: string }>) => {
    const fieldName = feature.properties?.name;
    if (fieldName) {
      actions.load({ field: fieldName });
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <MapContainer
        className="mapcontainer"
        center={state.mapView.center}
        zoom={state.mapView.zoom}
        zoomControl={false} // get rid of the +/- zoom buttons
      >
        <TileLayer url="https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.jpg"/>

        <Marker
          position={[state.currentGPS.lat, state.currentGPS.lon]}
          icon={currentLocationIcon}
        >
          <Popup>You are here</Popup>
        </Marker>

        <GeoJSON
          data={actions.geojsonRegions()}
          style={(feature) => {
            const regionId = feature?.properties?.id as string | undefined;
            const isCurrent = !!regionId && currentRegionIds.has(regionId);
            const isSelected = !!regionId && selectedRegionIds.has(regionId);
            const isCurrentField = feature?.properties?.field === state.load.field;
            return {
              color: isCurrent ? '#e0a800' : isSelected ? '#d4b000' : '#cdbd63',
              weight: isCurrent ? 3 : isSelected ? 2.5 : 1.5,
              opacity: isCurrent || isSelected ? 0.95 : 0.7,
              fillColor: '#fff4b8',
              fillOpacity: isCurrent ? 0.5 : isSelected ? 0.38 : (isCurrentField ? 0.28 : 0.18),
            };
          }}
        />

        <GeoJSON
          data={actions.geojsonFields()}
          style={(feature) => ({
            color: feature?.properties.name === state.load.field ? '#00FF00' : '#0000FF', // Red for active, blue for others
            weight: 2,
            opacity: 0.9,
          })}
          onEachFeature={(feature, layer) => {
              layer.on('click', () => handleFieldClick(feature));
            }}
        />

        <MapEvents/>
        <MapController/>
      </MapContainer>
      <Typography sx={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(255, 255, 255, 0.7)', padding: '5px', zIndex: 1000 }}>
        Field: {state.load.field || 'None'} | Source: {state.load.source || 'None'} | Today: {todayLoads} | Season: {seasonLoads}
      </Typography>
      <Tooltip title="Zoom to selected field">
        <span
          style={{
            position: 'absolute',
            right: '12px',
            bottom: '12px',
            zIndex: 1000,
          }}
        >
          <IconButton
            aria-label="zoom to selected field"
            onClick={() => actions.moveMapToField(state.load.field)}
            disabled={!state.load.field}
            sx={{ bgcolor: 'rgba(255, 255, 255, 0.85)' }}
          >
            <ZoomOutMapIcon />
          </IconButton>
        </span>
      </Tooltip>
      {state.gpsMode === 'map' && (
        <Typography
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '2rem', // Adjust size as needed
            color: '#FFFFFF', // Black for visibility (adjust as needed)
            zIndex: 500,      // Below the top overlay (1000) but above map (400)
            pointerEvents: 'none', // Allows map interaction through the overlay
          }}
        >
          +
        </Typography>
      )}
    </div>
  );
});