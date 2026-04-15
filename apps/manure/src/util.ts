import * as turf from '@turf/turf';
import debug from 'debug';
import type { GPS } from '@aultfarms/manure';
import type { Polygon } from 'geojson';

const info = debug('af/manure#util:info');

export function computeFieldArea(geoJson: Polygon): number {
  const polygon = turf.polygon(geoJson.coordinates);
  return turf.area(polygon) / 4046.86;
}

export async function getCurrentGPSFromBrowser(): Promise<GPS> {
  let coords: GPS = { lat: 0, lon: 0 };
  try {
    const currentPosition = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });

    coords = {
      lat: currentPosition.coords.latitude,
      lon: currentPosition.coords.longitude,
    };
  } catch (error) {
    info('Failed to get GPS coordinates, error was: %O', error);
  }

  return coords;
}
