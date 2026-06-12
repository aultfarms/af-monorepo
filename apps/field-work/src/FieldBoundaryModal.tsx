import React from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, IconButton, Modal, Stack, Tooltip, Typography } from '@mui/material';
import BackspaceIcon from '@mui/icons-material/Backspace';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { MapContainer, Marker, Polygon as LeafletPolygon, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { GeoJsonObject } from 'geojson';
import type { FieldBoundary } from '@aultfarms/field-work';
import { context } from './state';

const MAP_TILE_URL = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}';
const MAP_TILE_ATTRIBUTION = 'Map services and data available from U.S. Geological Survey, National Geospatial Program.';

type Coordinate = [number, number];

const defaultPointIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:14px;height:14px;border-radius:999px;background:#0d47a1;border:2px solid #ffffff;box-shadow:0 1px 6px rgba(0,0,0,0.35);"></div>',
  iconSize: [ 14, 14 ],
  iconAnchor: [ 7, 7 ],
});

const selectedPointIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:999px;background:#d32f2f;border:2px solid #ffffff;box-shadow:0 1px 6px rgba(0,0,0,0.35);"></div>',
  iconSize: [ 16, 16 ],
  iconAnchor: [ 8, 8 ],
});

function coordinateToLatLng(coordinate: Coordinate): [number, number] {
  return [ coordinate[1], coordinate[0] ];
}

function latLngToCoordinate(latLng: L.LatLng): Coordinate {
  return [ latLng.lng, latLng.lat ];
}

function buildPolygonDraftFromCoordinates(coordinates: Coordinate[]): FieldBoundary | null {
  if (coordinates.length < 3) {
    return null;
  }

  return {
    type: 'Feature',
    properties: null,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        ...coordinates,
        coordinates[0]!,
      ]],
    },
  };
}

function editableBoundaryCoordinates(boundary: FieldBoundary): Coordinate[] {
  if (boundary.geometry.type !== 'Polygon') {
    return [];
  }

  const ring = boundary.geometry.coordinates[0] || [];
  if (ring.length < 2) {
    return [];
  }

  const normalizedRing = ring.map(([lng, lat]) => [ lng, lat ] as Coordinate);
  const firstCoordinate = normalizedRing[0];
  const lastCoordinate = normalizedRing[normalizedRing.length - 1];
  if (
    firstCoordinate
    && lastCoordinate
    && firstCoordinate[0] === lastCoordinate[0]
    && firstCoordinate[1] === lastCoordinate[1]
  ) {
    return normalizedRing.slice(0, -1);
  }

  return normalizedRing;
}

function FitToEditorView({
  boundary,
  center,
  zoom,
  fitKey,
}: {
  boundary: FieldBoundary | null;
  center: [number, number];
  zoom: number;
  fitKey: number;
}) {
  const map = useMap();

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      if (boundary) {
        const layer = L.geoJSON(boundary as GeoJsonObject);
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, {
            padding: [ 24, 24 ],
            maxZoom: 18,
          });
          return;
        }
      }

      map.setView(center, zoom);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [boundary, center, fitKey, map, zoom]);

  return null;
}

function PolygonTapEditor({
  active,
  onAddCoordinate,
}: {
  active: boolean;
  onAddCoordinate: (coordinate: Coordinate) => void;
}) {
  useMapEvents({
    click: (event) => {
      if (!active) {
        return;
      }
      onAddCoordinate(latLngToCoordinate(event.latlng));
    },
  });

  return null;
}

export const FieldBoundaryModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const modalOpen = state.fieldBoundaryEditor.open;
  const fieldName = state.fieldBoundaryEditor.fieldName;
  const field = state.fieldDrafts.find(candidate => candidate.name === fieldName) || null;
  const seedBoundary = field?.boundary || null;
  const seedCoordinates = React.useMemo(
    () => seedBoundary ? editableBoundaryCoordinates(seedBoundary) : [],
    [seedBoundary],
  );
  const fallbackCenter = React.useMemo<[number, number]>(
    () => state.currentLocation
      ? [ state.currentLocation.center[0], state.currentLocation.center[1] ]
      : [ state.mapView.center[0], state.mapView.center[1] ],
    [state.currentLocation, state.mapView.center],
  );
  const fallbackZoom = state.mapView.zoom;

  const [fitKey, setFitKey] = React.useState(0);
  const [polygonCoordinates, setPolygonCoordinates] = React.useState<Coordinate[]>([]);
  const [polygonCurrentIndex, setPolygonCurrentIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (modalOpen && !field) {
      actions.closeFieldBoundaryEditor();
    }
  }, [actions, field, modalOpen]);

  React.useEffect(() => {
    if (!modalOpen || !field) {
      return;
    }

    setPolygonCoordinates(seedCoordinates);
    setPolygonCurrentIndex(seedCoordinates.length > 0 ? seedCoordinates.length - 1 : null);
    setFitKey(currentValue => currentValue + 1);
  }, [field, modalOpen, seedCoordinates]);

  React.useEffect(() => {
    if (polygonCoordinates.length < 1) {
      if (polygonCurrentIndex !== null) {
        setPolygonCurrentIndex(null);
      }
      return;
    }

    if (polygonCurrentIndex === null || polygonCurrentIndex >= polygonCoordinates.length) {
      setPolygonCurrentIndex(polygonCoordinates.length - 1);
    }
  }, [polygonCoordinates.length, polygonCurrentIndex]);

  const polygonDraft = React.useMemo(
    () => buildPolygonDraftFromCoordinates(polygonCoordinates),
    [polygonCoordinates],
  );

  const resetPolygonCoordinates = React.useCallback(() => {
    setPolygonCoordinates(seedCoordinates);
    setPolygonCurrentIndex(seedCoordinates.length > 0 ? seedCoordinates.length - 1 : null);
    setFitKey(currentValue => currentValue + 1);
  }, [seedCoordinates]);

  const clearPolygonCoordinates = React.useCallback(() => {
    setPolygonCoordinates([]);
    setPolygonCurrentIndex(null);
  }, []);

  const handlePolygonPointAdd = React.useCallback((nextCoordinate: Coordinate) => {
    if (polygonCoordinates.length < 1) {
      setPolygonCoordinates([ nextCoordinate ]);
      setPolygonCurrentIndex(0);
      return;
    }

    const activeIndex = polygonCurrentIndex === null
      || polygonCurrentIndex < 0
      || polygonCurrentIndex >= polygonCoordinates.length
      ? polygonCoordinates.length - 1
      : polygonCurrentIndex;
    const insertionIndex = activeIndex + 1;
    setPolygonCoordinates([
      ...polygonCoordinates.slice(0, insertionIndex),
      nextCoordinate,
      ...polygonCoordinates.slice(insertionIndex),
    ]);
    setPolygonCurrentIndex(insertionIndex);
  }, [polygonCoordinates, polygonCurrentIndex]);

  const handleDeleteCurrentPolygonPoint = React.useCallback(() => {
    if (polygonCoordinates.length < 1) {
      return;
    }

    const activeIndex = polygonCurrentIndex === null
      || polygonCurrentIndex < 0
      || polygonCurrentIndex >= polygonCoordinates.length
      ? polygonCoordinates.length - 1
      : polygonCurrentIndex;
    const nextCoordinates = polygonCoordinates.filter((_coordinate, index) => index !== activeIndex);
    setPolygonCoordinates(nextCoordinates);
    if (nextCoordinates.length < 1) {
      setPolygonCurrentIndex(null);
      return;
    }

    setPolygonCurrentIndex(activeIndex === 0 ? nextCoordinates.length - 1 : activeIndex - 1);
  }, [polygonCoordinates, polygonCurrentIndex]);

  const handleMovePolygonPoint = React.useCallback((index: number, nextCoordinate: Coordinate) => {
    setPolygonCoordinates(previousCoordinates => previousCoordinates.map((coordinate, currentIndex) => (
      currentIndex === index ? nextCoordinate : coordinate
    )));
    setPolygonCurrentIndex(index);
  }, []);

  const handleClose = React.useCallback(() => {
    actions.closeFieldBoundaryEditor();
  }, [actions]);

  const handleSave = React.useCallback(() => {
    if (!polygonDraft) {
      return;
    }
    actions.saveFieldBoundaryFromEditor(polygonDraft);
  }, [actions, polygonDraft]);

  React.useEffect(() => {
    if (!modalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (event.key !== 'Backspace' && event.key !== 'Delete') {
        return;
      }

      event.preventDefault();
      handleDeleteCurrentPolygonPoint();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDeleteCurrentPolygonPoint, modalOpen]);

  const selectedPointNumber = polygonCurrentIndex === null ? 0 : polygonCurrentIndex + 1;
  const canSave = !!polygonDraft;

  return (
    <Modal open={modalOpen} onClose={handleClose}>
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(1200px, calc(100vw - 16px))',
          height: 'min(860px, calc(100vh - 16px))',
          bgcolor: 'background.paper',
          boxShadow: 24,
          borderRadius: 2,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: 'minmax(0, 3fr) minmax(320px, 1fr)',
          },
          gridTemplateRows: {
            xs: 'minmax(320px, 52vh) minmax(0, 1fr)',
            md: 'minmax(0, 1fr)',
          },
        }}
      >
        <Box sx={{ position: 'relative', minHeight: 0, bgcolor: '#eef3f6' }}>
          <MapContainer
            center={fallbackCenter}
            zoom={fallbackZoom}
            zoomControl={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url={MAP_TILE_URL}
              attribution={MAP_TILE_ATTRIBUTION}
            />
            <FitToEditorView
              boundary={seedBoundary}
              center={fallbackCenter}
              zoom={fallbackZoom}
              fitKey={fitKey}
            />
            {polygonCoordinates.length >= 3 && (
              <LeafletPolygon
                positions={polygonCoordinates.map(coordinateToLatLng)}
                interactive={false}
                pathOptions={{
                  color: '#0d47a1',
                  weight: 2.5,
                  opacity: 0.9,
                  fillColor: '#42a5f5',
                  fillOpacity: 0.35,
                }}
              />
            )}
            {polygonCoordinates.length === 2 && (
              <Polyline
                positions={polygonCoordinates.map(coordinateToLatLng)}
                pathOptions={{
                  color: '#0d47a1',
                  weight: 3,
                  opacity: 0.95,
                }}
              />
            )}
            {polygonCoordinates.map((coordinate, index) => (
              <Marker
                key={`vertex-${index}`}
                position={coordinateToLatLng(coordinate)}
                icon={index === polygonCurrentIndex ? selectedPointIcon : defaultPointIcon}
                draggable
                eventHandlers={{
                  click: (event) => {
                    event.originalEvent.stopPropagation();
                    setPolygonCurrentIndex(index);
                  },
                  drag: (event) => {
                    const marker = event.target as L.Marker;
                    handleMovePolygonPoint(index, latLngToCoordinate(marker.getLatLng()));
                  },
                  dragend: (event) => {
                    const marker = event.target as L.Marker;
                    handleMovePolygonPoint(index, latLngToCoordinate(marker.getLatLng()));
                  },
                }}
              />
            ))}
            <PolygonTapEditor active onAddCoordinate={handlePolygonPointAdd} />
          </MapContainer>
          <Tooltip title="Delete selected point">
            <span>
              <IconButton
                size="small"
                onClick={handleDeleteCurrentPolygonPoint}
                disabled={polygonCoordinates.length < 1}
                sx={{
                  position: 'absolute',
                  top: 12,
                  right: 16,
                  zIndex: 1000,
                  bgcolor: 'rgba(255,255,255,0.88)',
                  boxShadow: 1,
                }}
              >
                <BackspaceIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        <Box
          sx={{
            minHeight: 0,
            overflow: 'auto',
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <Stack spacing={0.5}>
            <Typography variant="h6">
              {seedBoundary ? 'Edit field boundary' : 'Draw field boundary'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {field?.name || 'No field selected'}
            </Typography>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Tap the map to add a vertex after the selected point. Tap or drag an existing point to select and reposition it.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {polygonCoordinates.length < 3
                ? `Add ${3 - polygonCoordinates.length} more point${3 - polygonCoordinates.length === 1 ? '' : 's'} before saving.`
                : `${polygonCoordinates.length} boundary points ready to save.`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {polygonCoordinates.length > 0
                ? `Selected point: ${selectedPointNumber} of ${polygonCoordinates.length} • press Delete or Backspace to remove it`
                : 'No points selected yet.'}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<RestartAltIcon />}
              onClick={resetPolygonCoordinates}
            >
              {seedCoordinates.length > 0 ? 'Revert' : 'Reset view'}
            </Button>
            <Button
              variant="outlined"
              color="warning"
              onClick={clearPolygonCoordinates}
              disabled={polygonCoordinates.length < 1}
            >
              Clear points
            </Button>
          </Stack>

          <Box sx={{ flexGrow: 1 }} />

          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Saving updates the local field draft. Use “Save Fields” in the field manager to persist the new boundary to Trello.
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="contained" onClick={handleSave} disabled={!canSave}>
                Save boundary
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Box>
    </Modal>
  );
});
