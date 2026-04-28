import JSZip from 'jszip';
import * as toGeoJSON from '@tmcw/togeojson';
import bbox from '@turf/bbox';
import center from '@turf/center';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { LatLngBoundsLiteral, LatLngTuple } from 'leaflet';
import type { EditableField } from './state/state';
import { defaultFieldAreaAcres, type FieldBoundary } from '@aultfarms/field-work';
export function boundsForPoint(point: LatLngTuple): LatLngBoundsLiteral {
  return [
    [ point[0], point[1] ],
    [ point[0], point[1] ],
  ];
}

export function boundsForBoundary(boundary: FieldBoundary): LatLngBoundsLiteral {
  const fieldBbox = bbox(boundary);
  return [
    [ fieldBbox[1], fieldBbox[0] ],
    [ fieldBbox[3], fieldBbox[2] ],
  ];
}

export function extendBoundsToIncludePoint(bounds: LatLngBoundsLiteral | null, point: LatLngTuple): LatLngBoundsLiteral {
  if (!bounds) {
    return boundsForPoint(point);
  }
  return [
    [
      Math.min(bounds[0][0], point[0]),
      Math.min(bounds[0][1], point[1]),
    ],
    [
      Math.max(bounds[1][0], point[0]),
      Math.max(bounds[1][1], point[1]),
    ],
  ];
}

export function mapViewForBoundary(boundary: FieldBoundary): { center: [number, number]; zoom: number } {
  const fieldCenter = center(boundary).geometry.coordinates as [number, number];
  const fieldBbox = bbox(boundary);
  const latDiff = fieldBbox[3] - fieldBbox[1];
  const lngDiff = fieldBbox[2] - fieldBbox[0];
  const maxDiff = Math.max(latDiff, lngDiff);
  const zoom = maxDiff > 0
    ? Math.min(18, Math.max(10, Math.floor(16 - Math.log2(maxDiff * 100))))
    : 16;

  return {
    center: [ fieldCenter[1], fieldCenter[0] ],
    zoom,
  };
}

export function boundsForFields(fields: EditableField[]): LatLngBoundsLiteral | null {
  const boundaries = fields
    .map(field => field.boundary)
    .filter((boundary): boundary is FieldBoundary => !!boundary);
  if (boundaries.length < 1) {
    return null;
  }
  if (boundaries.length === 1) {
    return boundsForBoundary(boundaries[0]);
  }

  const featureCollection: FeatureCollection<Polygon | MultiPolygon> = {
    type: 'FeatureCollection',
    features: boundaries,
  };
  const collectionBbox = bbox(featureCollection);
  return [
    [ collectionBbox[1], collectionBbox[0] ],
    [ collectionBbox[3], collectionBbox[2] ],
  ];
}

export function mapViewForFields(fields: EditableField[]): { center: [number, number]; zoom: number } | null {
  const boundaries = fields
    .map(field => field.boundary)
    .filter((boundary): boundary is FieldBoundary => !!boundary);
  if (boundaries.length < 1) {
    return null;
  }
  if (boundaries.length === 1) {
    return mapViewForBoundary(boundaries[0]);
  }

  const featureCollection: FeatureCollection<Polygon | MultiPolygon> = {
    type: 'FeatureCollection',
    features: boundaries,
  };
  const collectionCenter = center(featureCollection).geometry.coordinates as [number, number];
  const collectionBbox = bbox(featureCollection);
  const latDiff = collectionBbox[3] - collectionBbox[1];
  const lngDiff = collectionBbox[2] - collectionBbox[0];
  const maxDiff = Math.max(latDiff, lngDiff);
  const zoom = maxDiff > 0
    ? Math.min(16, Math.max(8, Math.floor(15 - Math.log2(maxDiff * 30))))
    : 14;

  return {
    center: [ collectionCenter[1], collectionCenter[0] ],
    zoom,
  };
}

export async function parseKMZIntoEditableFields(file: File): Promise<EditableField[]> {
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
    .filter((feature): feature is Feature<Polygon | MultiPolygon> => {
      return feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon';
    })
    .map(feature => ({
      name: feature.properties?.name || 'Unnamed Field',
      aliases: [],
      acreage: defaultFieldAreaAcres({
        name: feature.properties?.name || 'Unnamed Field',
        boundary: feature,
      }),
      boundary: feature,
    }));
}
