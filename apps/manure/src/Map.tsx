import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { context } from './state';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import { Typography } from '@mui/material';
import L from 'leaflet';
import debug from 'debug';

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
      info('Map Moved!  e = ', e);
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
  const { state } = React.useContext(context);
  const l = state.load;
  const todayLoads = state.loads
    .filter(r => r.date === l.date && r.field === l.field && r.source === l.source)
    .reduce((sum, r) => sum + r.loads, 0);
  const seasonLoads = state.loads
    .filter(r => r.field === l.field && r.source === l.source)
    .reduce((sum, r) => sum + r.loads, 0);

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

        <MapEvents/>
        <MapController/>
      </MapContainer>
      <Typography sx={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(255, 255, 255, 0.7)', padding: '5px', zIndex: 1000 }}>
        Field: {state.load.field || 'None'} | Source: {state.load.source || 'None'} | Today: {todayLoads} | Season: {seasonLoads}
      </Typography>
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