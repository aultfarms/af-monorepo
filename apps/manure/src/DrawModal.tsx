import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  Modal,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import BackspaceIcon from '@mui/icons-material/Backspace';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polygon as LeafletPolygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { Feature, GeoJsonObject, LineString, MultiPolygon, Polygon } from 'geojson';
import 'leaflet/dist/leaflet.css';
import bbox from '@turf/bbox';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import center from '@turf/center';
import { lineString, point } from '@turf/helpers';
import {
  bearing as turfBearing,
  buffer as turfBuffer,
  destination as turfDestination,
  distance as turfDistance,
} from '@turf/turf';
import type { Source, SpreadRegion } from '@aultfarms/manure';
import { summarizeLoadGroups, summarizeLoadGroupsByKey, type LoadGroupSummary } from './loadGroups';
import {
  buildLoadGroupColorMap,
  colorWithAlpha,
  EXISTING_SPREAD_REGION_BORDER_COLOR,
  EXISTING_SPREAD_REGION_FILL_COLOR,
  regionColorFromLoadGroups,
} from './regionColors';
import { MANURE_MAP_TILE_ATTRIBUTION, MANURE_MAP_TILE_URL } from './mapTiles';
import { context } from './state';

const DEFAULT_HEADLAND_FEET = 80;
const LENGTH_ROLLER_FEET_PER_PIXEL = 5;
const ROTATION_HANDLE_DISTANCE_FEET = 110;
const MAX_LINE_LENGTH_FEET = 10000;
const MIN_LINE_LENGTH_FEET = 20;
const MAX_TURNAROUND_OFFSET_FEET = 300;
const DRAW_MODAL_LOAD_LIST_MAX_HEIGHT_LANDSCAPE = 280;
const DRAW_MODAL_LOAD_LIST_MAX_HEIGHT_PORTRAIT = 340;

type PolygonDraft = Feature<Polygon | MultiPolygon>;
type Coordinate = [number, number];
type TurnSideSign = -1 | 1;
type LoadEditorSeed = {
  startCoordinate: Coordinate;
  headingDegrees: number | null;
};
type TurnaroundHandleGeometry = {
  index: number;
  coordinate: Coordinate;
  baseCoordinate: Coordinate;
  passEndCoordinate: Coordinate;
  passHeadingDegrees: number;
  minOffsetFeet: number;
  maxOffsetFeet: number;
  offsetFeet: number;
};
type LoadLineGeometry = {
  centerline: Feature<LineString>;
  polygon: Feature<Polygon | MultiPolygon>;
  lineLengthFeet: number;
  rotationHandle: Coordinate;
  rotationGuideStart: Coordinate;
  rotationPivot: Coordinate;
  rotationPivotDistanceFeet: number;
  startHandle: Coordinate;
  turnaroundHandles: TurnaroundHandleGeometry[];
  turned: boolean;
  turnSideSign: TurnSideSign;
};
type FieldBoundary = {
  name: string;
  boundary: Feature<Polygon | MultiPolygon>;
  defaultHeadingDegrees?: number;
};

const rotationHandleIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:22px;height:22px;border-radius:999px;background:#1976d2;border:2px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:13px;font-weight:700;line-height:1;">↻</div>',
  iconSize: [ 22, 22 ],
  iconAnchor: [ 11, 11 ],
});

const startHandleIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:20px;height:20px;border-radius:999px;background:#2e7d32;border:2px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;"><div style="width:6px;height:6px;border-radius:999px;background:#ffffff;"></div></div>',
  iconSize: [ 20, 20 ],
  iconAnchor: [ 10, 10 ],
});

const turnaroundHandleIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:24px;height:24px;border-radius:999px;background:#d4b000;border:2px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>',
  iconSize: [ 24, 24 ],
  iconAnchor: [ 12, 12 ],
});

function asPolygonFeature(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
  return {
    ...feature,
    properties: null,
  };
}

function asLineFeature(feature: Feature<LineString>): Feature<LineString> {
  return {
    ...feature,
    properties: null,
  };
}

function coordinateToLatLng(coordinate: Coordinate): [number, number] {
  return [ coordinate[1], coordinate[0] ];
}

function latLngToCoordinate(latLng: L.LatLng): Coordinate {
  return [ latLng.lng, latLng.lat ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeHeadingDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function roundToNearestFive(value: number): number {
  return Math.round(value / 5) * 5;
}

function snapHeadlandBufferFeet(value: number): number {
  const rounded = roundToNearestFive(Math.max(0, value));
  return Math.abs(rounded - DEFAULT_HEADLAND_FEET) <= 10 ? DEFAULT_HEADLAND_FEET : rounded;
}

function normalizeTurnSideSign(value: number): TurnSideSign {
  return value < 0 ? -1 : 1;
}

function segmentLengthFeet(start: Coordinate, end: Coordinate): number {
  return turfDistance(point(start), point(end), { units: 'feet' });
}

function polylineLengthFeet(coordinates: Coordinate[]): number {
  let totalFeet = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    totalFeet += segmentLengthFeet(coordinates[index - 1]!, coordinates[index]!);
  }
  return totalFeet;
}

function pointAlongSegment(
  startCoordinate: Coordinate,
  endCoordinate: Coordinate,
  distanceFeet: number,
): Coordinate {
  const segmentFeet = segmentLengthFeet(startCoordinate, endCoordinate);
  if (segmentFeet <= 0.1) {
    return endCoordinate;
  }

  const clampedDistanceFeet = clamp(distanceFeet, 0, segmentFeet);
  const bearingDegrees = turfBearing(point(startCoordinate), point(endCoordinate));
  return moveCoordinate(startCoordinate, bearingDegrees, clampedDistanceFeet);
}

function coordinateAlongPolyline(coordinates: Coordinate[], distanceFeet: number): Coordinate {
  if (coordinates.length < 1) {
    return [ 0, 0 ];
  }
  if (coordinates.length === 1) {
    return coordinates[0]!;
  }

  let remainingFeet = clamp(distanceFeet, 0, polylineLengthFeet(coordinates));
  for (let index = 1; index < coordinates.length; index += 1) {
    const startCoordinate = coordinates[index - 1]!;
    const endCoordinate = coordinates[index]!;
    const segmentFeet = segmentLengthFeet(startCoordinate, endCoordinate);
    if (remainingFeet <= segmentFeet) {
      return pointAlongSegment(startCoordinate, endCoordinate, remainingFeet);
    }
    remainingFeet -= segmentFeet;
  }

  return coordinates[coordinates.length - 1]!;
}

function featureVertices(feature: Feature<LineString | Polygon | MultiPolygon>): Coordinate[] {
  if (feature.geometry.type === 'LineString') {
    return feature.geometry.coordinates.map(coordinate => [ coordinate[0], coordinate[1] ]);
  }
  if (feature.geometry.type === 'Polygon') {
    return feature.geometry.coordinates.flat().map(coordinate => [ coordinate[0], coordinate[1] ]);
  }

  return feature.geometry.coordinates.flat(2).map(coordinate => [ coordinate[0], coordinate[1] ]);
}

function featureWithinFieldVertices(
  fieldBoundary: Feature<Polygon | MultiPolygon>,
  feature: Feature<LineString | Polygon | MultiPolygon>,
): boolean {
  return featureVertices(feature).every(coordinate => (
    booleanPointInPolygon(point(coordinate), fieldBoundary)
  ));
}

function moveCoordinate(
  coordinate: Coordinate,
  headingDegrees: number,
  distanceFeet: number,
): Coordinate {
  return turfDestination(
    point(coordinate),
    distanceFeet,
    headingDegrees,
    { units: 'feet' },
  ).geometry.coordinates as Coordinate;
}

function distanceInsideField(
  fieldBoundary: Feature<Polygon | MultiPolygon>,
  origin: Coordinate,
  headingDegrees: number,
): number {
  let distanceFeet = 0;
  const maxDistanceFeet = 10000;
  const coarseStepFeet = 20;

  while (distanceFeet + coarseStepFeet <= maxDistanceFeet) {
    const nextCoordinate = moveCoordinate(origin, headingDegrees, distanceFeet + coarseStepFeet);
    if (!booleanPointInPolygon(point(nextCoordinate), fieldBoundary)) {
      break;
    }
    distanceFeet += coarseStepFeet;
  }

  let refinedDistanceFeet = distanceFeet;
  for (
    let extraFeet = 1;
    refinedDistanceFeet + extraFeet <= Math.min(distanceFeet + coarseStepFeet, maxDistanceFeet);
    extraFeet += 1
  ) {
    const nextCoordinate = moveCoordinate(origin, headingDegrees, refinedDistanceFeet + extraFeet);
    if (!booleanPointInPolygon(point(nextCoordinate), fieldBoundary)) {
      break;
    }
    refinedDistanceFeet += 1;
  }

  return refinedDistanceFeet;
}

function polygonFeatureToLeafletPositions(
  feature: Feature<Polygon | MultiPolygon>,
): L.LatLngExpression[][] | L.LatLngExpression[][][] {
  if (feature.geometry.type === 'Polygon') {
    return feature.geometry.coordinates.map(ring => (
      ring.map(([lng, lat]) => [ lat, lng ] as [number, number])
    ));
  }

  return feature.geometry.coordinates.map(polygonCoordinates => (
    polygonCoordinates.map(ring => (
      ring.map(([lng, lat]) => [ lat, lng ] as [number, number])
    ))
  ));
}

function regionRecencyValue(region: SpreadRegion): string {
  return region.updatedAt || region.dateEnd || region.dateStart || '';
}

function fieldRegionsByRecency(regions: SpreadRegion[], fieldName: string): SpreadRegion[] {
  return regions
    .filter(region => region.field === fieldName && !region.supersededByRegionId)
    .sort((left, right) => regionRecencyValue(right).localeCompare(regionRecencyValue(left)));
}

function centerlineEndHeadingDegrees(centerline: Feature<LineString>): number | null {
  const coordinates = centerline.geometry.coordinates as Coordinate[];
  if (coordinates.length < 2) {
    return null;
  }

  return normalizeHeadingDegrees(
    turfBearing(
      point(coordinates[coordinates.length - 2]!),
      point(coordinates[coordinates.length - 1]!),
    ),
  );
}

function latestFieldRegionSide(
  regions: SpreadRegion[],
  fieldName: string,
  referenceCoordinate: Coordinate,
  headingDegrees: number,
): TurnSideSign {
  const latestRegion = fieldRegionsByRecency(regions, fieldName)[0];

  if (!latestRegion) {
    return 1;
  }

  const regionCenter = center(latestRegion.polygon).geometry.coordinates as Coordinate;
  const distanceFeet = turfDistance(point(referenceCoordinate), point(regionCenter), { units: 'feet' });
  if (distanceFeet <= 0.1) {
    return 1;
  }

  const bearingDegrees = normalizeHeadingDegrees(turfBearing(point(referenceCoordinate), point(regionCenter)));
  const angleDifferenceRadians = ((bearingDegrees - headingDegrees + 540) % 360 - 180) * Math.PI / 180;
  const perpendicularFeet = Math.sin(angleDifferenceRadians) * distanceFeet;

  return perpendicularFeet >= 0 ? -1 : 1;
}

function projectionsFeetFromCoordinate(
  origin: Coordinate,
  target: Coordinate,
  headingDegrees: number,
): { alongFeet: number; perpendicularFeet: number } {
  const distanceFeet = turfDistance(point(origin), point(target), { units: 'feet' });
  if (distanceFeet <= 0.1) {
    return {
      alongFeet: 0,
      perpendicularFeet: 0,
    };
  }

  const bearingDegrees = normalizeHeadingDegrees(turfBearing(point(origin), point(target)));
  const angleDifferenceRadians = ((bearingDegrees - headingDegrees + 540) % 360 - 180) * Math.PI / 180;
  return {
    alongFeet: Math.cos(angleDifferenceRadians) * distanceFeet,
    perpendicularFeet: Math.sin(angleDifferenceRadians) * distanceFeet,
  };
}

function guessUncoveredFieldCoordinate(
  fieldBoundary: Feature<Polygon | MultiPolygon>,
  regions: SpreadRegion[],
): Coordinate {
  const [ minLon, minLat, maxLon, maxLat ] = bbox(fieldBoundary);
  const gridSteps = 30;

  for (let row = 0; row <= gridSteps; row += 1) {
    const latitude = maxLat - ((maxLat - minLat) * row / gridSteps);
    for (let column = 0; column <= gridSteps; column += 1) {
      const longitude = minLon + ((maxLon - minLon) * column / gridSteps);
      const candidate: Coordinate = [ longitude, latitude ];
      if (!booleanPointInPolygon(point(candidate), fieldBoundary)) {
        continue;
      }
      const covered = regions.some(region => booleanPointInPolygon(point(candidate), region.polygon));
      if (!covered) {
        return candidate;
      }
    }
  }

  return center(fieldBoundary).geometry.coordinates as Coordinate;
}

function interiorFieldCoordinate(fieldBoundary: Feature<Polygon | MultiPolygon>): Coordinate {
  const centerCoordinate = center(fieldBoundary).geometry.coordinates as Coordinate;
  if (booleanPointInPolygon(point(centerCoordinate), fieldBoundary)) {
    return centerCoordinate;
  }

  return guessUncoveredFieldCoordinate(fieldBoundary, []);
}

function deriveLoadEditorSeed(
  field: FieldBoundary,
  regions: SpreadRegion[],
  gpsCoordinate: Coordinate,
): LoadEditorSeed {
  const fieldRegions = fieldRegionsByRecency(regions, field.name);
  const latestLineRegion = fieldRegions.find(region => region.mode === 'load' && region.centerline);
  if (latestLineRegion?.centerline) {
    const coordinates = latestLineRegion.centerline.geometry.coordinates as Coordinate[];
    if (coordinates.length >= 1) {
      return {
        startCoordinate: coordinates[coordinates.length - 1]!,
        headingDegrees: centerlineEndHeadingDegrees(latestLineRegion.centerline),
      };
    }
  }

  if (booleanPointInPolygon(point(gpsCoordinate), field.boundary)) {
    return {
      startCoordinate: gpsCoordinate,
      headingDegrees: null,
    };
  }

  return {
    startCoordinate: guessUncoveredFieldCoordinate(field.boundary, fieldRegions),
    headingDegrees: null,
  };
}

function deriveFieldHeadingSeed(field: FieldBoundary): LoadEditorSeed {
  return {
    startCoordinate: interiorFieldCoordinate(field.boundary),
    headingDegrees: typeof field.defaultHeadingDegrees === 'number'
      ? field.defaultHeadingDegrees
      : null,
  };
}

function buildPolygonDraftFromCoordinates(coordinates: Coordinate[]): PolygonDraft | null {
  if (coordinates.length < 3) {
    return null;
  }

  return asPolygonFeature({
    type: 'Feature',
    properties: null,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          ...coordinates,
          coordinates[0]!,
        ],
      ],
    },
  });
}

function editableBoundaryCoordinates(boundary: Feature<Polygon | MultiPolygon>): Coordinate[] {
  const ring = boundary.geometry.type === 'Polygon'
    ? boundary.geometry.coordinates[0] ?? []
    : boundary.geometry.coordinates[0]?.[0] ?? [];
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

function pushCoordinateIfDistinct(coordinates: Coordinate[], nextCoordinate: Coordinate): void {
  const previousCoordinate = coordinates[coordinates.length - 1];
  if (!previousCoordinate || segmentLengthFeet(previousCoordinate, nextCoordinate) > 0.1) {
    coordinates.push(nextCoordinate);
  }
}

function buildLoadLineGeometry({
  fieldBoundary,
  startCoordinate,
  headingDegrees,
  lineLengthFeet,
  spreadWidthFeet,
  headlandBufferFeet,
  turnSideSign,
  turnaroundOffsetFeetByIndex,
  rotationHandleAnchorDistanceFeet,
}: {
  fieldBoundary: Feature<Polygon | MultiPolygon>;
  startCoordinate: Coordinate;
  headingDegrees: number;
  lineLengthFeet: number;
  spreadWidthFeet: number;
  headlandBufferFeet: number;
  turnSideSign: TurnSideSign;
  turnaroundOffsetFeetByIndex: number[];
  rotationHandleAnchorDistanceFeet: number | null;
}): LoadLineGeometry {
  const halfWidthFeet = Math.max(spreadWidthFeet / 2, 1);
  const clampedRequestedLengthFeet = clamp(lineLengthFeet, MIN_LINE_LENGTH_FEET, MAX_LINE_LENGTH_FEET);
  const coordinates: Coordinate[] = [ startCoordinate ];
  const turnaroundHandles: TurnaroundHandleGeometry[] = [];
  let remainingFeet = clampedRequestedLengthFeet;
  let currentStartCoordinate = startCoordinate;
  const baseHeadingDegrees = normalizeHeadingDegrees(headingDegrees);
  let currentHeadingDegrees = baseHeadingDegrees;
  let turned = false;
  let effectiveTurnSideSign = turnSideSign;

  for (let turnIndex = 0; remainingFeet > 0.1 && turnIndex < 100; turnIndex += 1) {
    const maxStraightFeet = Math.max(
      distanceInsideField(fieldBoundary, currentStartCoordinate, currentHeadingDegrees) - halfWidthFeet,
      0,
    );
    if (maxStraightFeet <= 0.1) {
      break;
    }

    const safeStraightFeet = Math.max(maxStraightFeet - headlandBufferFeet, 0);
    const canTurn = safeStraightFeet >= 0.1
      && remainingFeet > safeStraightFeet + spreadWidthFeet + 1;

    if (!canTurn) {
      pushCoordinateIfDistinct(
        coordinates,
        moveCoordinate(currentStartCoordinate, currentHeadingDegrees, Math.min(remainingFeet, maxStraightFeet)),
      );
      break;
    }

    const rawOffsetFeet = turnaroundOffsetFeetByIndex[turnIndex] ?? 0;
    const normalizedOffsetFeet = clamp(
      roundToNearestFive(rawOffsetFeet),
      Math.max(-safeStraightFeet, -MAX_TURNAROUND_OFFSET_FEET),
      Math.min(maxStraightFeet - safeStraightFeet, MAX_TURNAROUND_OFFSET_FEET),
    );
    const turnDistanceFeet = clamp(
      safeStraightFeet + normalizedOffsetFeet,
      0,
      maxStraightFeet,
    );
    const passEndCoordinate = moveCoordinate(
      currentStartCoordinate,
      currentHeadingDegrees,
      turnDistanceFeet,
    );

    const localTurnSideSign = normalizeTurnSideSign(
      effectiveTurnSideSign * (turnIndex % 2 === 0 ? 1 : -1),
    );

    const buildNextLaneCoordinate = (sideSign: TurnSideSign): Coordinate => (
      moveCoordinate(
        passEndCoordinate,
        currentHeadingDegrees + sideSign * 90,
        spreadWidthFeet,
      )
    );
    let resolvedTurnSideSign = effectiveTurnSideSign;
    let resolvedLocalTurnSideSign = localTurnSideSign;
    let nextLaneCoordinate = buildNextLaneCoordinate(resolvedLocalTurnSideSign);
    if (!booleanPointInPolygon(point(nextLaneCoordinate), fieldBoundary)) {
      if (turnIndex === 0) {
        const alternateTurnSideSign = normalizeTurnSideSign(-resolvedTurnSideSign);
        const alternateLocalTurnSideSign = normalizeTurnSideSign(
          alternateTurnSideSign * (turnIndex % 2 === 0 ? 1 : -1),
        );
        const alternateLaneCoordinate = buildNextLaneCoordinate(alternateLocalTurnSideSign);
        if (booleanPointInPolygon(point(alternateLaneCoordinate), fieldBoundary)) {
          resolvedTurnSideSign = alternateTurnSideSign;
          resolvedLocalTurnSideSign = alternateLocalTurnSideSign;
          nextLaneCoordinate = alternateLaneCoordinate;
        } else {
          pushCoordinateIfDistinct(
            coordinates,
            moveCoordinate(currentStartCoordinate, currentHeadingDegrees, Math.min(remainingFeet, maxStraightFeet)),
          );
          break;
        }
      } else {
        pushCoordinateIfDistinct(
          coordinates,
          moveCoordinate(currentStartCoordinate, currentHeadingDegrees, Math.min(remainingFeet, maxStraightFeet)),
        );
        break;
      }
    }

    const defaultPassEndCoordinate = moveCoordinate(
      currentStartCoordinate,
      currentHeadingDegrees,
      safeStraightFeet,
    );
    const defaultHandleCoordinate = moveCoordinate(
      defaultPassEndCoordinate,
      currentHeadingDegrees + resolvedLocalTurnSideSign * 90,
      spreadWidthFeet,
    );
    const turnSegmentFeet = segmentLengthFeet(passEndCoordinate, nextLaneCoordinate);

    if (remainingFeet <= turnDistanceFeet + 0.1) {
      pushCoordinateIfDistinct(
        coordinates,
        moveCoordinate(currentStartCoordinate, currentHeadingDegrees, remainingFeet),
      );
      break;
    }

    pushCoordinateIfDistinct(coordinates, passEndCoordinate);
    turned = true;
    effectiveTurnSideSign = resolvedTurnSideSign;
    turnaroundHandles.push({
      index: turnIndex,
      coordinate: nextLaneCoordinate,
      baseCoordinate: defaultHandleCoordinate,
      passEndCoordinate,
      passHeadingDegrees: currentHeadingDegrees,
      minOffsetFeet: Math.max(-safeStraightFeet, -MAX_TURNAROUND_OFFSET_FEET),
      maxOffsetFeet: Math.min(maxStraightFeet - safeStraightFeet, MAX_TURNAROUND_OFFSET_FEET),
      offsetFeet: normalizedOffsetFeet,
    });
    remainingFeet -= turnDistanceFeet;

    if (remainingFeet <= turnSegmentFeet + 0.1) {
      pushCoordinateIfDistinct(
        coordinates,
        pointAlongSegment(passEndCoordinate, nextLaneCoordinate, remainingFeet),
      );
      break;
    }

    pushCoordinateIfDistinct(coordinates, nextLaneCoordinate);
    remainingFeet -= turnSegmentFeet;
    currentStartCoordinate = nextLaneCoordinate;
    currentHeadingDegrees = normalizeHeadingDegrees(currentHeadingDegrees + 180);
  }

  if (coordinates.length < 2) {
    const finalDistanceFeet = Math.min(
      clampedRequestedLengthFeet,
      Math.max(distanceInsideField(fieldBoundary, startCoordinate, headingDegrees) - halfWidthFeet, 0),
    );
    coordinates.push(moveCoordinate(startCoordinate, headingDegrees, Math.max(finalDistanceFeet, 1)));
  }

  const actualLineLengthFeet = polylineLengthFeet(coordinates);
  const centerline = asLineFeature(lineString(coordinates) as Feature<LineString>);
  const polygon = asPolygonFeature(
    turfBuffer(centerline, halfWidthFeet, { units: 'feet' }) as Feature<Polygon | MultiPolygon>,
  );
  const rotationPivotDistanceFeet = rotationHandleAnchorDistanceFeet !== null
    && actualLineLengthFeet >= rotationHandleAnchorDistanceFeet * 2
    ? rotationHandleAnchorDistanceFeet
    : actualLineLengthFeet / 2;
  const rotationPivot = coordinateAlongPolyline(coordinates, rotationPivotDistanceFeet);
  const rotationGuideHeadingDegrees = normalizeHeadingDegrees(
    headingDegrees + (turned ? effectiveTurnSideSign : 1) * 90,
  );
  const rotationHandle = moveCoordinate(
    rotationPivot,
    rotationGuideHeadingDegrees,
    ROTATION_HANDLE_DISTANCE_FEET,
  );

  return {
    centerline,
    polygon,
    lineLengthFeet: actualLineLengthFeet,
    rotationHandle,
    rotationGuideStart: rotationPivot,
    rotationPivot,
    rotationPivotDistanceFeet,
    startHandle: startCoordinate,
    turnaroundHandles,
    turned,
    turnSideSign: effectiveTurnSideSign,
  };
}

function parseOptionalNumber(value: string): number | null {
  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function clampAssignmentLoadCount(value: number, totalLoads: number): number {
  return Math.max(0, Math.min(totalLoads, Math.round(value)));
}

function defaultAssignmentLoadCount(group: LoadGroupSummary): number {
  return clampAssignmentLoadCount(
    group.unassignedLoads > 0 ? group.unassignedLoads : group.totalLoads,
    group.totalLoads,
  );
}

function isDateWithinRange(date: string, dateStart: string, dateEnd: string): boolean {
  if (dateStart && date < dateStart) {
    return false;
  }
  if (dateEnd && date > dateEnd) {
    return false;
  }
  return true;
}

function formatDateRangeLabel(dateStart: string, dateEnd: string): string {
  if (dateStart && dateEnd) {
    return dateStart === dateEnd ? dateStart : `${dateStart} – ${dateEnd}`;
  }
  if (dateStart) {
    return `${dateStart} –`;
  }
  if (dateEnd) {
    return `– ${dateEnd}`;
  }
  return 'All dates';
}

function fieldCenterLatLng(boundary: Feature<Polygon | MultiPolygon>): [number, number] {
  return coordinateToLatLng(center(boundary).geometry.coordinates as Coordinate);
}

function assignmentDraftRows(
  groups: LoadGroupSummary[],
  assignmentLoadCounts: Record<string, number>,
): Array<LoadGroupSummary & { selectedLoadCount: number }> {
  return groups.map(group => ({
    ...group,
    selectedLoadCount: clampAssignmentLoadCount(
      assignmentLoadCounts[group.loadGroupKey] ?? defaultAssignmentLoadCount(group),
      group.totalLoads,
    ),
  }));
}

function FitToField({
  fieldBoundary,
  fitKey,
}: {
  fieldBoundary: Feature<Polygon | MultiPolygon> | null;
  fitKey: number;
}) {
  const map = useMap();

  React.useEffect(() => {
    if (!fieldBoundary) {
      return;
    }

    const timer = window.setTimeout(() => {
      map.invalidateSize();
      const layer = L.geoJSON(fieldBoundary as GeoJsonObject);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [ 24, 24 ] });
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fieldBoundary, fitKey, map]);

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

function LoadModeLayer({
  geometry,
  lineColor,
  fillColor,
  onStartDrag,
  onRotationDragStart,
  onRotationDrag,
  onTurnaroundDrag,
}: {
  geometry: LoadLineGeometry;
  lineColor: string;
  fillColor: string;
  onStartDrag: (coordinate: Coordinate) => void;
  onRotationDragStart: () => void;
  onRotationDrag: (coordinate: Coordinate, persist: boolean) => void;
  onTurnaroundDrag: (index: number, coordinate: Coordinate) => void;
}) {
  const centerlineCoordinates = geometry.centerline.geometry.coordinates as Coordinate[];

  const startDragEvents = React.useMemo<L.LeafletEventHandlerFnMap>(() => ({
    drag: (event) => {
      const marker = event.target as L.Marker;
      onStartDrag(latLngToCoordinate(marker.getLatLng()));
    },
    dragend: (event) => {
      const marker = event.target as L.Marker;
      onStartDrag(latLngToCoordinate(marker.getLatLng()));
    },
  }), [onStartDrag]);

  const rotationDragEvents = React.useMemo<L.LeafletEventHandlerFnMap>(() => ({
    dragstart: () => {
      onRotationDragStart();
    },
    drag: (event) => {
      const marker = event.target as L.Marker;
      onRotationDrag(latLngToCoordinate(marker.getLatLng()), false);
    },
    dragend: (event) => {
      const marker = event.target as L.Marker;
      onRotationDrag(latLngToCoordinate(marker.getLatLng()), true);
    },
  }), [onRotationDrag, onRotationDragStart]);


  return (
    <React.Fragment>
      <LeafletPolygon
        positions={polygonFeatureToLeafletPositions(geometry.polygon)}
        pathOptions={{
          color: lineColor,
          weight: 2,
          opacity: 0.95,
          fillColor,
          fillOpacity: 0.75,
        }}
      />
      <Polyline
        positions={centerlineCoordinates.map(coordinateToLatLng)}
        pathOptions={{
          color: lineColor,
          weight: 3,
          opacity: 0.95,
        }}
      />
      <Polyline
        positions={[
          coordinateToLatLng(geometry.rotationGuideStart),
          coordinateToLatLng(geometry.rotationHandle),
        ]}
        pathOptions={{
          color: '#1976d2',
          weight: 2,
          opacity: 0.85,
          dashArray: '4 6',
        }}
      />
      <Marker
        position={coordinateToLatLng(geometry.startHandle)}
        icon={startHandleIcon}
        draggable
        eventHandlers={startDragEvents}
      />
      <Marker
        position={coordinateToLatLng(geometry.rotationHandle)}
        icon={rotationHandleIcon}
        draggable
        eventHandlers={rotationDragEvents}
      />
      {geometry.turnaroundHandles.map(handle => (
        <Marker
          key={handle.index}
          position={coordinateToLatLng(handle.coordinate)}
          icon={turnaroundHandleIcon}
          draggable
          eventHandlers={{
            drag: (event) => {
              const marker = event.target as L.Marker;
              onTurnaroundDrag(handle.index, latLngToCoordinate(marker.getLatLng()));
            },
            dragend: (event) => {
              const marker = event.target as L.Marker;
              onTurnaroundDrag(handle.index, latLngToCoordinate(marker.getLatLng()));
            },
          }}
        />
      ))}
    </React.Fragment>
  );
}

function LengthRoller({
  disabled,
  lineLengthFeet,
  onChangeLength,
}: {
  disabled: boolean;
  lineLengthFeet: number;
  onChangeLength: (nextLengthFeet: number) => void;
}) {
  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startY = event.clientY;
    const startLengthFeet = lineLengthFeet;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextLengthFeet = startLengthFeet + ((startY - moveEvent.clientY) * LENGTH_ROLLER_FEET_PER_PIXEL);
      onChangeLength(nextLengthFeet);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [disabled, lineLengthFeet, onChangeLength]);

  return (
    <Box
      onPointerDown={handlePointerDown}
      sx={{
        position: 'absolute',
        left: 0,
        top: 52,
        bottom: 24,
        width: '18px',
        borderRadius: '999px',
        backgroundImage: [
          'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.18))',
          'repeating-linear-gradient(180deg, rgba(255,255,255,0.95) 0px, rgba(255,255,255,0.95) 2px, rgba(25,118,210,0.22) 2px, rgba(25,118,210,0.22) 12px)',
        ].join(','),
        backgroundPosition: `center center, center ${Math.round(lineLengthFeet / 6)}px`,
        backgroundSize: '100% 100%, 100% 14px',
        border: '1px solid rgba(25, 118, 210, 0.65)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.16), inset 0 0 8px rgba(0, 0, 0, 0.18)',
        zIndex: 1000,
        touchAction: 'none',
        cursor: disabled ? 'default' : 'ns-resize',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '6px 1px',
          borderRadius: '999px',
          background: 'linear-gradient(90deg, rgba(255,255,255,0.72), transparent 35%, transparent 70%, rgba(0,0,0,0.15))',
          opacity: disabled ? 0.35 : 0.8,
        },
      }}
    />
  );
}

export const DrawModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const isLandscape = useMediaQuery('(orientation: landscape)');
  const modalOpen = state.draw.modalOpen;
  const isFieldHeadingPurpose = state.draw.purpose === 'fieldHeading';
  const isFieldBoundaryPurpose = state.draw.purpose === 'fieldBoundary';
  const showsRegionControls = !isFieldHeadingPurpose && !isFieldBoundaryPurpose;
  const groupedLoadsByKey = React.useMemo(
    () => summarizeLoadGroupsByKey(state.loads, state.regionAssignments, state.thisYear),
    [state.loads, state.regionAssignments, state.thisYear],
  );
  const selectedGroups = React.useMemo(
    () => state.draw.targetLoadGroupKeys
      .map(loadGroupKey => groupedLoadsByKey.get(loadGroupKey))
      .filter((group): group is LoadGroupSummary => !!group),
    [groupedLoadsByKey, state.draw.targetLoadGroupKeys],
  );
  const targetField = React.useMemo<FieldBoundary | null>(
    () => state.fields.find(field => field.name === state.draw.targetField) ?? null,
    [state.draw.targetField, state.fields],
  );
  const isPendingBoundaryField = React.useMemo(
    () => !!(targetField && state.pendingBoundaryFieldNames.includes(targetField.name)),
    [state.pendingBoundaryFieldNames, targetField],
  );
  const fitBoundary = React.useMemo(
    () => (targetField && !isPendingBoundaryField ? targetField.boundary : null),
    [isPendingBoundaryField, targetField],
  );
  const selectedSource = React.useMemo<Source | null>(() => {
    const uniqueSourceNames = [ ...new Set(selectedGroups.map(group => group.source).filter(Boolean)) ];
    const preferredSourceName = uniqueSourceNames.length === 1
      ? uniqueSourceNames[0]!
      : (state.load.source || uniqueSourceNames[0] || '');
    return state.sources.find(source => source.name === preferredSourceName) ?? null;
  }, [selectedGroups, state.load.source, state.sources]);
  const activeFieldRegions = React.useMemo(
    () => targetField
      ? state.regions.filter(region => region.field === targetField.name && !region.supersededByRegionId)
      : [],
    [state.regions, targetField],
  );
  const gpsCoordinate = React.useMemo<Coordinate>(
    () => [ state.currentGPS.lon, state.currentGPS.lat ],
    [state.currentGPS.lat, state.currentGPS.lon],
  );
  const seed = React.useMemo(
    () => targetField
      ? ((isFieldHeadingPurpose || isFieldBoundaryPurpose)
          ? deriveFieldHeadingSeed(targetField)
          : deriveLoadEditorSeed(targetField, activeFieldRegions, gpsCoordinate))
      : null,
    [activeFieldRegions, gpsCoordinate, isFieldBoundaryPurpose, isFieldHeadingPurpose, targetField],
  );
  const selectedDates = React.useMemo(
    () => selectedGroups.map(group => group.date).filter(Boolean).sort(),
    [selectedGroups],
  );
  const mapCenter = React.useMemo<[number, number]>(
    () => fitBoundary
      ? fieldCenterLatLng(fitBoundary)
      : [ state.mapView.center[0], state.mapView.center[1] ],
    [fitBoundary, state.mapView.center],
  );
  const regionLoadGroupKeysById = React.useMemo(() => {
    const nextMap = new Map<string, string[]>();
    for (const assignment of state.regionAssignments) {
      if (!assignment.regionId) {
        continue;
      }
      if (targetField && assignment.field !== targetField.name) {
        continue;
      }
      const existing = nextMap.get(assignment.regionId) ?? [];
      if (!existing.includes(assignment.loadGroupKey)) {
        existing.push(assignment.loadGroupKey);
      }
      nextMap.set(assignment.regionId, existing);
    }
    return nextMap;
  }, [state.regionAssignments, targetField]);

  const [fitKey, setFitKey] = React.useState(0);
  const [polygonCoordinates, setPolygonCoordinates] = React.useState<Coordinate[]>([]);
  const [polygonCurrentIndex, setPolygonCurrentIndex] = React.useState<number | null>(null);
  const [startCoordinate, setStartCoordinate] = React.useState<Coordinate | null>(null);
  const [headingDegrees, setHeadingDegrees] = React.useState(0);
  const [spreadWidthFeet, setSpreadWidthFeet] = React.useState(40);
  const [lineLengthFeet, setLineLengthFeet] = React.useState(500);
  const [headlandBufferFeet, setHeadlandBufferFeet] = React.useState(DEFAULT_HEADLAND_FEET);
  const [turnSideSign, setTurnSideSign] = React.useState<TurnSideSign>(1);
  const [turnaroundOffsetFeetByIndex, setTurnaroundOffsetFeetByIndex] = React.useState<number[]>([]);
  const [rotationHandleAnchorDistanceFeet, setRotationHandleAnchorDistanceFeet] = React.useState<number | null>(null);
  const [dateStart, setDateStart] = React.useState('');
  const [dateEnd, setDateEnd] = React.useState('');
  const [dateRangeModalOpen, setDateRangeModalOpen] = React.useState(false);
  const [dateRangeDraftStart, setDateRangeDraftStart] = React.useState('');
  const [dateRangeDraftEnd, setDateRangeDraftEnd] = React.useState('');
  const initializationKeyRef = React.useRef('');
  const rotationDragStateRef = React.useRef<{
    pivotCoordinate: Coordinate;
    pivotDistanceFeet: number;
    handleSideSign: TurnSideSign;
  } | null>(null);
  const fieldGroupsInRange = React.useMemo(
    () => showsRegionControls && targetField
      ? summarizeLoadGroups(state.loads, state.regionAssignments, state.thisYear).filter(group => (
        group.field === targetField.name
        && isDateWithinRange(group.date, dateStart, dateEnd)
      ))
      : [],
    [dateEnd, dateStart, showsRegionControls, state.loads, state.regionAssignments, state.thisYear, targetField],
  );
  const assignmentRows = React.useMemo(
    () => assignmentDraftRows(
      fieldGroupsInRange,
      state.draw.assignmentLoadCounts,
    ),
    [fieldGroupsInRange, state.draw.assignmentLoadCounts],
  );
  const visibleLoadTotal = React.useMemo(
    () => assignmentRows.reduce((sum, row) => sum + row.totalLoads, 0),
    [assignmentRows],
  );
  const modalTitle = isFieldBoundaryPurpose
    ? (isPendingBoundaryField ? 'Draw field boundary' : 'Edit field boundary')
    : (isFieldHeadingPurpose ? 'Default heading' : 'Draw');
  const modalSubtitle = targetField
    ? [
        targetField.name,
        isFieldBoundaryPurpose
          ? 'draw a polygon to set the field boundary'
          : (isFieldHeadingPurpose
              ? 'draw a load line to set the field default'
              : (visibleLoadTotal > 0 ? `${visibleLoadTotal} load${visibleLoadTotal === 1 ? '' : 's'}` : '')),
      ].filter(Boolean).join(' • ')
    : 'No field selected';
  const saveButtonLabel = isFieldBoundaryPurpose
    ? 'Save boundary'
    : (isFieldHeadingPurpose ? 'Save heading' : 'Save region');
  const dateRangeLabel = React.useMemo(
    () => formatDateRangeLabel(dateStart, dateEnd),
    [dateEnd, dateStart],
  );
  const selectedLoadTotal = React.useMemo(
    () => assignmentRows.reduce((sum, row) => sum + row.selectedLoadCount, 0),
    [assignmentRows],
  );
  const loadGroupColorMap = React.useMemo(
    () => buildLoadGroupColorMap([
      ...assignmentRows.map(group => group.loadGroupKey),
      ...[ ...regionLoadGroupKeysById.values() ].flat(),
    ]),
    [assignmentRows, regionLoadGroupKeysById],
  );
  const selectedAssignedLoadGroupKeys = React.useMemo(
    () => assignmentRows
      .filter(row => row.selectedLoadCount > 0)
      .map(row => row.loadGroupKey),
    [assignmentRows],
  );
  const draftRegionColor = React.useMemo(
    () => isFieldBoundaryPurpose
      ? '#0d47a1'
      : regionColorFromLoadGroups(selectedAssignedLoadGroupKeys, loadGroupColorMap),
    [isFieldBoundaryPurpose, loadGroupColorMap, selectedAssignedLoadGroupKeys],
  );
  const draftFillColor = React.useMemo(
    () => colorWithAlpha(draftRegionColor, isFieldBoundaryPurpose ? '33' : '55'),
    [draftRegionColor, isFieldBoundaryPurpose],
  );
  const polygonDraft = React.useMemo(
    () => buildPolygonDraftFromCoordinates(polygonCoordinates),
    [polygonCoordinates],
  );
  const activeFieldRegionVisuals = React.useMemo(
    () => activeFieldRegions.map(region => ({ region })),
    [activeFieldRegions],
  );

  React.useEffect(() => {
    if (!modalOpen || !targetField || !seed) {
      initializationKeyRef.current = '';
      return;
    }

    const nextInitializationKey = [
      state.draw.purpose,
      targetField.name,
      ...state.draw.targetLoadGroupKeys,
    ].join('|');
    if (initializationKeyRef.current === nextInitializationKey) {
      return;
    }

    initializationKeyRef.current = nextInitializationKey;
    const initialHeadingDegrees = normalizeHeadingDegrees(
      state.draw.headingDegrees ?? seed.headingDegrees ?? 0,
    );
    const initialSpreadWidthFeet = Math.max(selectedSource?.spreadWidthFeet ?? 40, 5);
    const initialLineLengthFeet = Math.max(selectedSource?.defaultLoadLengthFeet ?? 500, MIN_LINE_LENGTH_FEET);
    const initialTurnSideSign = latestFieldRegionSide(
      activeFieldRegions,
      targetField.name,
      seed.startCoordinate,
      initialHeadingDegrees,
    );
    const initialLoadGeometry = buildLoadLineGeometry({
      fieldBoundary: targetField.boundary,
      startCoordinate: seed.startCoordinate,
      headingDegrees: initialHeadingDegrees,
      lineLengthFeet: initialLineLengthFeet,
      spreadWidthFeet: initialSpreadWidthFeet,
      headlandBufferFeet: DEFAULT_HEADLAND_FEET,
      turnSideSign: initialTurnSideSign,
      turnaroundOffsetFeetByIndex: [],
      rotationHandleAnchorDistanceFeet: null,
    });
    const initialDateStart = selectedDates[0] || state.load.date || new Date().toISOString().split('T')[0] || '';
    const initialDateEnd = selectedDates[selectedDates.length - 1] || initialDateStart;
    const initialPolygonCoordinates = isFieldBoundaryPurpose && !isPendingBoundaryField
      ? editableBoundaryCoordinates(targetField.boundary)
      : [];

    setPolygonCoordinates(initialPolygonCoordinates);
    setPolygonCurrentIndex(initialPolygonCoordinates.length > 0 ? initialPolygonCoordinates.length - 1 : null);
    setStartCoordinate(seed.startCoordinate);
    setHeadingDegrees(initialHeadingDegrees);
    setSpreadWidthFeet(initialSpreadWidthFeet);
    setLineLengthFeet(initialLineLengthFeet);
    setHeadlandBufferFeet(DEFAULT_HEADLAND_FEET);
    setTurnSideSign(initialTurnSideSign);
    setTurnaroundOffsetFeetByIndex([]);
    setRotationHandleAnchorDistanceFeet(initialLoadGeometry.lineLengthFeet / 2);
    setDateStart(initialDateStart);
    setDateEnd(initialDateEnd);
    setFitKey(currentValue => currentValue + 1);
  }, [
    activeFieldRegions,
    isFieldBoundaryPurpose,
    isPendingBoundaryField,
    modalOpen,
    seed,
    selectedDates,
    selectedSource?.defaultLoadLengthFeet,
    selectedSource?.spreadWidthFeet,
    state.draw.headingDegrees,
    state.draw.purpose,
    state.draw.targetLoadGroupKeys,
    state.load.date,
    targetField,
  ]);

  React.useEffect(() => {
    if (!modalOpen) {
      setDateRangeModalOpen(false);
    }
  }, [modalOpen]);

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

  const loadGeometry = React.useMemo(() => {
    if (!targetField || !startCoordinate) {
      return null;
    }

    return buildLoadLineGeometry({
      fieldBoundary: targetField.boundary,
      startCoordinate,
      headingDegrees,
      lineLengthFeet,
      spreadWidthFeet,
      headlandBufferFeet,
      turnSideSign,
      turnaroundOffsetFeetByIndex,
      rotationHandleAnchorDistanceFeet,
    });
  }, [
    headlandBufferFeet,
    headingDegrees,
    lineLengthFeet,
    rotationHandleAnchorDistanceFeet,
    spreadWidthFeet,
    startCoordinate,
    targetField,
    turnSideSign,
    turnaroundOffsetFeetByIndex,
  ]);

  React.useEffect(() => {
    if (state.draw.mode === 'load' && loadGeometry?.turned && loadGeometry.turnSideSign !== turnSideSign) {
      setTurnSideSign(loadGeometry.turnSideSign);
    }
  }, [loadGeometry?.turnSideSign, loadGeometry?.turned, state.draw.mode, turnSideSign]);

  const polygonFitsField = React.useMemo(
    () => !!(polygonDraft && (isFieldBoundaryPurpose || (targetField && featureWithinFieldVertices(targetField.boundary, polygonDraft)))),
    [isFieldBoundaryPurpose, polygonDraft, targetField],
  );
  const loadGeometryFitsField = React.useMemo(
    () => !!(targetField && loadGeometry && featureWithinFieldVertices(targetField.boundary, loadGeometry.polygon)),
    [loadGeometry, targetField],
  );
  const hasDateRangeError = !!(dateStart && dateEnd && dateStart > dateEnd);
  const hasDateRangeDraftError = !!(
    dateRangeDraftStart
    && dateRangeDraftEnd
    && dateRangeDraftStart > dateRangeDraftEnd
  );
  const canSave = !state.draw.saving
    && !hasDateRangeError
    && !!targetField
    && (
      (state.draw.mode === 'load' && !!loadGeometry && loadGeometryFitsField && (isFieldHeadingPurpose || selectedLoadTotal > 0))
      || (state.draw.mode === 'polygon' && !!polygonDraft && polygonFitsField)
    );

  const handleClose = React.useCallback(() => {
    if (!state.draw.saving) {
      setDateRangeModalOpen(false);
      actions.closeDrawModal();
    }
  }, [actions, state.draw.saving]);

  const handleModeChange = React.useCallback((_: React.MouseEvent<HTMLElement>, nextMode: SpreadRegion['mode'] | null) => {
    if (!nextMode) {
      return;
    }
    actions.drawState({ mode: nextMode });
  }, [actions]);

  const applyHeading = React.useCallback((nextHeadingDegrees: number, persist: boolean) => {
    const normalizedHeading = normalizeHeadingDegrees(nextHeadingDegrees);
    setHeadingDegrees(normalizedHeading);
    if (persist) {
      actions.setDrawHeadingDegrees(normalizedHeading);
    }
  }, [actions]);

  const handleHeadingInputChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsedValue = parseOptionalNumber(event.target.value);
    if (parsedValue === null) {
      return;
    }
    applyHeading(parsedValue, true);
  }, [applyHeading]);

  const handleSpreadWidthChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsedValue = parseOptionalNumber(event.target.value);
    if (parsedValue === null) {
      return;
    }
    setSpreadWidthFeet(Math.max(5, roundToNearestFive(parsedValue)));
  }, []);

  const handleLineLengthChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsedValue = parseOptionalNumber(event.target.value);
    if (parsedValue === null) {
      return;
    }
    setLineLengthFeet(clamp(roundToNearestFive(parsedValue), MIN_LINE_LENGTH_FEET, MAX_LINE_LENGTH_FEET));
  }, []);

  const handleHeadlandBufferChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const parsedValue = parseOptionalNumber(event.target.value);
    if (parsedValue === null) {
      return;
    }
    const nextHeadlandBufferFeet = snapHeadlandBufferFeet(parsedValue);
    setHeadlandBufferFeet(nextHeadlandBufferFeet);
    setTurnaroundOffsetFeetByIndex([]);
  }, []);

  const handleRollerLengthChange = React.useCallback((nextLengthFeet: number) => {
    setLineLengthFeet(clamp(
      roundToNearestFive(nextLengthFeet),
      MIN_LINE_LENGTH_FEET,
      MAX_LINE_LENGTH_FEET,
    ));
  }, []);
  const handlePolygonPointAdd = React.useCallback((nextCoordinate: Coordinate) => {
    if (!targetField || (!isFieldBoundaryPurpose && !booleanPointInPolygon(point(nextCoordinate), targetField.boundary))) {
      return;
    }
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
    const currentCoordinate = polygonCoordinates[activeIndex]!;
    const nextExistingCoordinate = polygonCoordinates[(activeIndex + 1) % polygonCoordinates.length]!;
    if (
      segmentLengthFeet(currentCoordinate, nextCoordinate) <= 0.1
      || segmentLengthFeet(nextExistingCoordinate, nextCoordinate) <= 0.1
    ) {
      return;
    }

    const insertionIndex = activeIndex + 1;
    setPolygonCoordinates([
      ...polygonCoordinates.slice(0, insertionIndex),
      nextCoordinate,
      ...polygonCoordinates.slice(insertionIndex),
    ]);
    setPolygonCurrentIndex(insertionIndex);
  }, [isFieldBoundaryPurpose, polygonCoordinates, polygonCurrentIndex, targetField]);
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

  const handleStartDrag = React.useCallback((nextCoordinate: Coordinate) => {
    if (!targetField || !booleanPointInPolygon(point(nextCoordinate), targetField.boundary)) {
      return;
    }
    setStartCoordinate(nextCoordinate);
  }, [targetField]);
  const handleRotationDragStart = React.useCallback(() => {
    if (!loadGeometry) {
      return;
    }
    rotationDragStateRef.current = {
      pivotCoordinate: [ loadGeometry.rotationPivot[0], loadGeometry.rotationPivot[1] ],
      pivotDistanceFeet: loadGeometry.rotationPivotDistanceFeet,
      handleSideSign: loadGeometry.turned ? loadGeometry.turnSideSign : 1,
    };
  }, [loadGeometry]);

  const handleRotationDrag = React.useCallback((nextCoordinate: Coordinate, persist: boolean) => {
    const dragState = rotationDragStateRef.current;
    const pivotCoordinate = dragState?.pivotCoordinate ?? loadGeometry?.rotationPivot;
    const pivotDistanceFeet = dragState?.pivotDistanceFeet ?? loadGeometry?.rotationPivotDistanceFeet;
    const handleSideSign = dragState?.handleSideSign ?? (loadGeometry?.turned ? loadGeometry.turnSideSign : 1);
    if (!pivotCoordinate || pivotDistanceFeet === undefined || !targetField) {
      if (persist) {
        rotationDragStateRef.current = null;
      }
      return;
    }

    const distanceFeet = turfDistance(point(pivotCoordinate), point(nextCoordinate), { units: 'feet' });
    if (distanceFeet <= 1) {
      if (persist) {
        rotationDragStateRef.current = null;
      }
      return;
    }
    const handleBearingDegrees = turfBearing(point(pivotCoordinate), point(nextCoordinate));
    const nextHeadingDegrees = normalizeHeadingDegrees(handleBearingDegrees - (handleSideSign * 90));
    const nextStartCoordinate = moveCoordinate(
      pivotCoordinate,
      nextHeadingDegrees + 180,
      pivotDistanceFeet,
    );
    if (!booleanPointInPolygon(point(nextStartCoordinate), targetField.boundary)) {
      if (persist) {
        rotationDragStateRef.current = null;
      }
      return;
    }

    setStartCoordinate(nextStartCoordinate);
    applyHeading(nextHeadingDegrees, persist);
    if (persist) {
      rotationDragStateRef.current = null;
    }
  }, [applyHeading, loadGeometry, targetField]);

  const handleTurnaroundDrag = React.useCallback((index: number, nextCoordinate: Coordinate) => {
    if (!loadGeometry) {
      return;
    }
    const handle = loadGeometry.turnaroundHandles[index];
    if (!handle) {
      return;
    }
    const projections = projectionsFeetFromCoordinate(
      handle.baseCoordinate,
      nextCoordinate,
      handle.passHeadingDegrees,
    );
    if (Math.abs(projections.perpendicularFeet) > Math.max(spreadWidthFeet * 0.25, 1)) {
      const localTurnSideSign = normalizeTurnSideSign(projections.perpendicularFeet);
      const globalTurnSideSign = normalizeTurnSideSign(
        localTurnSideSign * (index % 2 === 0 ? 1 : -1),
      );
      setTurnSideSign(globalTurnSideSign);
    }
    setTurnaroundOffsetFeetByIndex(previous => {
      const next = [ ...previous ];
      next[index] = clamp(
        roundToNearestFive(projections.alongFeet),
        handle.minOffsetFeet,
        handle.maxOffsetFeet,
      );
      return next;
    });
  }, [loadGeometry, spreadWidthFeet]);

  const handleResetHeading = React.useCallback(() => {
    actions.revertDrawHeadingToFieldDefault();
    const fallbackHeading = normalizeHeadingDegrees(
      targetField?.defaultHeadingDegrees ?? seed?.headingDegrees ?? 0,
    );
    setHeadingDegrees(fallbackHeading);
  }, [actions, seed?.headingDegrees, targetField?.defaultHeadingDegrees]);

  const handleAssignmentLoadCountChange = React.useCallback((row: LoadGroupSummary, value: string) => {
    const parsedValue = Number.parseInt(value, 10);
    if (!Number.isFinite(parsedValue)) {
      return;
    }
    actions.setDrawAssignmentLoadCount(
      row.loadGroupKey,
      clampAssignmentLoadCount(parsedValue, row.totalLoads),
    );
  }, [actions]);
  const handleAssignmentToggle = React.useCallback((row: LoadGroupSummary, checked: boolean) => {
    actions.setDrawAssignmentLoadCount(
      row.loadGroupKey,
      checked ? defaultAssignmentLoadCount(row) : 0,
    );
  }, [actions]);
  const handleDateRangeModalOpen = React.useCallback(() => {
    setDateRangeDraftStart(dateStart);
    setDateRangeDraftEnd(dateEnd);
    setDateRangeModalOpen(true);
  }, [dateEnd, dateStart]);
  const handleDateRangeModalClose = React.useCallback(() => {
    setDateRangeModalOpen(false);
  }, []);
  const handleDateRangeApply = React.useCallback(() => {
    if (hasDateRangeDraftError) {
      return;
    }
    setDateStart(dateRangeDraftStart);
    setDateEnd(dateRangeDraftEnd);
    setDateRangeModalOpen(false);
  }, [dateRangeDraftEnd, dateRangeDraftStart, hasDateRangeDraftError]);

  const handleSave = React.useCallback(async () => {
    if (!targetField) {
      return;
    }

    if (isFieldHeadingPurpose) {
      if (!loadGeometry || !loadGeometryFitsField) {
        return;
      }

      actions.saveFieldHeadingFromDraw(Math.round(normalizeHeadingDegrees(headingDegrees)));
      return;
    }

    if (isFieldBoundaryPurpose) {
      if (!polygonDraft) {
        return;
      }

      actions.saveFieldBoundaryFromDraw(polygonDraft);
      return;
    }

    const assignments = assignmentRows
      .filter(row => row.selectedLoadCount > 0)
      .map(row => ({
        loadGroupKey: row.loadGroupKey,
        date: row.date,
        field: row.field,
        source: row.source,
        loadCount: row.selectedLoadCount,
      }));

    if (assignments.length < 1) {
      return;
    }

    if (state.draw.mode === 'load') {
      if (!loadGeometry || !loadGeometryFitsField) {
        return;
      }

      await actions.saveDrawRegion({
        field: targetField.name,
        mode: 'load',
        polygon: loadGeometry.polygon,
        centerline: loadGeometry.centerline,
        headingDegrees,
        spreadWidthFeet,
        dateStart: dateStart || undefined,
        dateEnd: dateEnd || undefined,
      }, assignments);
      return;
    }

    if (!polygonDraft || !polygonFitsField) {
      return;
    }

    await actions.saveDrawRegion({
      field: targetField.name,
      mode: 'polygon',
      polygon: polygonDraft,
      dateStart: dateStart || undefined,
      dateEnd: dateEnd || undefined,
    }, assignments);
  }, [
    actions,
    assignmentRows,
    dateEnd,
    dateStart,
    headingDegrees,
    loadGeometry,
    loadGeometryFitsField,
    polygonDraft,
    polygonFitsField,
    spreadWidthFeet,
    isFieldBoundaryPurpose,
    isFieldHeadingPurpose,
    state.draw.mode,
    targetField,
  ]);

  const validationMessage = state.draw.mode === 'load' && !loadGeometryFitsField
    ? 'Adjust the line so the buffered region stays inside the field boundary.'
    : '';

  return (
    <React.Fragment>
      <Modal open={modalOpen} onClose={handleClose}>
        <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(1400px, calc(100vw - 16px))',
        height: 'min(960px, calc(100vh - 16px))',
        bgcolor: 'background.paper',
        boxShadow: 24,
        borderRadius: 2,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: isLandscape ? 'minmax(0, 3fr) minmax(0, 2fr)' : 'minmax(0, 1fr)',
        gridTemplateRows: isLandscape ? 'minmax(0, 1fr)' : 'minmax(320px, 52vh) minmax(0, 1fr)',
      }}
        >
          <Box sx={{ position: 'relative', minHeight: 0, bgcolor: '#eef3f6' }}>
          {targetField ? (
            <MapContainer
              center={mapCenter}
              zoom={state.mapView.zoom}
              zoomControl={false}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                url={MANURE_MAP_TILE_URL}
                attribution={MANURE_MAP_TILE_ATTRIBUTION}
              />
              <FitToField fieldBoundary={fitBoundary} fitKey={fitKey} />
              {!isFieldBoundaryPurpose && fitBoundary && (
                <GeoJSON
                  data={fitBoundary as GeoJsonObject}
                  interactive={false}
                  style={{
                    color: '#0d47a1',
                    weight: 2.5,
                    opacity: 0.9,
                    fillOpacity: 0,
                  }}
                />
              )}
              {showsRegionControls && activeFieldRegionVisuals.map(({ region }) => (
                <GeoJSON
                  key={region.id || `${region.field}-${region.dateStart || ''}-${region.updatedAt || ''}`}
                  data={region.polygon as GeoJsonObject}
                  interactive={false}
                  style={{
                    color: EXISTING_SPREAD_REGION_BORDER_COLOR,
                    weight: 1.75,
                    opacity: 1,
                    fillColor: EXISTING_SPREAD_REGION_FILL_COLOR,
                    fillOpacity: 0.75,
                  }}
                />
              ))}
              {state.draw.mode === 'load' && loadGeometry && (
                <LoadModeLayer
                  geometry={loadGeometry}
                  lineColor={draftRegionColor}
                  fillColor={draftFillColor}
                  onStartDrag={handleStartDrag}
                  onRotationDragStart={handleRotationDragStart}
                  onRotationDrag={handleRotationDrag}
                  onTurnaroundDrag={handleTurnaroundDrag}
                />
              )}
              {state.draw.mode === 'polygon' && polygonCoordinates.length >= 3 && (
                <LeafletPolygon
                  positions={polygonCoordinates.map(coordinateToLatLng)}
                  interactive={false}
                  pathOptions={{
                    color: draftRegionColor,
                    weight: 2.5,
                    opacity: 0.9,
                    fillColor: draftFillColor,
                    fillOpacity: 0.4,
                  }}
                />
              )}
              {state.draw.mode === 'polygon' && !polygonDraft && polygonCoordinates.length >= 2 && (
                <Polyline
                  positions={polygonCoordinates.map(coordinateToLatLng)}
                  pathOptions={{
                    color: draftRegionColor,
                    weight: 3,
                    opacity: 0.95,
                  }}
                />
              )}
              {state.draw.mode === 'polygon' && polygonCoordinates.map((coordinate, index) => (
                <CircleMarker
                  key={`${coordinate[0]}-${coordinate[1]}-${index}`}
                  center={coordinateToLatLng(coordinate)}
                  radius={index === polygonCurrentIndex ? 6 : 5}
                  pathOptions={{
                    color: index === polygonCurrentIndex ? '#d32f2f' : draftRegionColor,
                    fillColor: index === polygonCurrentIndex ? '#d32f2f' : draftRegionColor,
                    fillOpacity: 0.95,
                    weight: 2,
                  }}
                  eventHandlers={{
                    click: (event) => {
                      event.originalEvent.stopPropagation();
                      setPolygonCurrentIndex(index);
                    },
                  }}
                />
              ))}
              <PolygonTapEditor active={state.draw.mode === 'polygon'} onAddCoordinate={handlePolygonPointAdd} />
            </MapContainer>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
              <Typography color="text.secondary">Choose a field before drawing.</Typography>
            </Box>
          )}

          {state.draw.mode === 'load' && (
            <React.Fragment>
              <Box sx={{
                position: 'absolute',
                top: 12,
                left: 24,
                zIndex: 1000,
                px: 1.25,
                py: 0.5,
                borderRadius: 1,
                bgcolor: 'rgba(255,255,255,0.88)',
                boxShadow: 1,
              }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {Math.round(loadGeometry?.lineLengthFeet ?? lineLengthFeet)} ft
                </Typography>
              </Box>
              <LengthRoller
                disabled={!targetField}
                lineLengthFeet={lineLengthFeet}
                onChangeLength={handleRollerLengthChange}
              />
            </React.Fragment>
          )}
          {state.draw.mode === 'polygon' && (
            <Tooltip title="Delete current point">
              <span>
                <IconButton
                  size="small"
                  onClick={handleDeleteCurrentPolygonPoint}
                  disabled={polygonCoordinates.length < 1}
                  sx={{
                    position: 'absolute',
                    top: 12,
                    right: 24,
                    zIndex: 1000,
                    bgcolor: 'rgba(255,255,255,0.88)',
                    boxShadow: 1,
                  }}
                >
                  <BackspaceIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>

        <Box sx={{
          minHeight: 0,
          overflow: 'auto',
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
        >
          <Stack spacing={0.5}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Typography variant="h6">{modalTitle}</Typography>
              {showsRegionControls && (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={state.draw.mode}
                  onChange={handleModeChange}
                  sx={{
                    '& .MuiToggleButton-root': {
                      px: 1.25,
                      color: 'text.secondary',
                      textTransform: 'none',
                    },
                    '& .MuiToggleButton-root.Mui-selected': {
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                    },
                    '& .MuiToggleButton-root.Mui-selected:hover': {
                      bgcolor: 'primary.dark',
                    },
                  }}
                >
                  <ToggleButton value="load">Load</ToggleButton>
                  <ToggleButton value="polygon">Polygon</ToggleButton>
                </ToggleButtonGroup>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.25 }}>
              {modalSubtitle}
            </Typography>
          </Stack>
          {showsRegionControls && (
            <Box
              sx={{
                overflowY: 'auto',
                maxHeight: isLandscape ? DRAW_MODAL_LOAD_LIST_MAX_HEIGHT_LANDSCAPE : DRAW_MODAL_LOAD_LIST_MAX_HEIGHT_PORTRAIT,
                flexShrink: 0,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <Table size="small">
                <TableBody>
                  {assignmentRows.map(row => (
                    <TableRow
                      key={row.loadGroupKey}
                      sx={{
                        '& > td': {
                          py: 0.25,
                          px: 0.5,
                        },
                      }}
                    >
                      <TableCell padding="checkbox" sx={{ pl: 0.25, pr: 0.25, width: 1 }}>
                        <Checkbox
                          size="small"
                          checked={row.selectedLoadCount > 0}
                          onChange={(_event, checked) => handleAssignmentToggle(row, checked)}
                          sx={{ p: 0.25 }}
                        />
                      </TableCell>
                      <TableCell sx={{ pl: 0, whiteSpace: 'nowrap' }}>{row.date}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.source}</TableCell>
                      <TableCell align="right" sx={{ width: 48, pr: 0.75 }}>
                        <TextField
                          size="small"
                          type="number"
                          value={row.selectedLoadCount}
                          hiddenLabel
                          variant="standard"
                          disabled={row.selectedLoadCount < 1}
                          onChange={event => handleAssignmentLoadCountChange(row, event.target.value)}
                          inputProps={{ min: 0, max: row.totalLoads, step: 1 }}
                          sx={{
                            width: 36,
                            '& .MuiInputBase-input': {
                              py: 0,
                              textAlign: 'right',
                            },
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {assignmentRows.length < 1 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography variant="body2" color="text.secondary">
                          No loads found in the selected date range.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {showsRegionControls && (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.25 }}>
                  {dateRangeLabel}
                </Typography>
                <Tooltip title="Change date range">
                  <span>
                    <IconButton size="small" color="primary" onClick={handleDateRangeModalOpen}>
                      <CalendarMonthIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            )}
            {validationMessage && (
              <Typography variant="body2" color="error">
                {validationMessage}
              </Typography>
            )}
            <Stack direction="row" spacing={1} alignItems="center">
              <Button size="small" variant="contained" onClick={() => void handleSave()} disabled={!canSave}>
                {state.draw.saving ? 'Saving…' : saveButtonLabel}
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="outlined" onClick={handleClose} disabled={state.draw.saving}>
                Cancel
              </Button>
            </Stack>
            {state.draw.mode === 'load' && (
              <Stack spacing={0.75} sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small"
                    margin="dense"
                    type="number"
                    label="Heading"
                    value={Math.round(headingDegrees)}
                    onChange={handleHeadingInputChange}
                    inputProps={{ step: 1, 'aria-label': 'Heading degrees' }}
                    sx={{ width: 112 }}
                  />
                  <Tooltip title="Rotate +90°">
                    <span>
                      <IconButton size="small" onClick={() => applyHeading(headingDegrees + 90, true)}>
                        <RotateRightIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Set to default heading">
                    <span>
                      <IconButton size="small" onClick={handleResetHeading}>
                        <RestartAltIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
                {isFieldHeadingPurpose ? (
                  <TextField
                    size="small"
                    margin="dense"
                    type="number"
                    label="Line ft"
                    value={lineLengthFeet}
                    onChange={handleLineLengthChange}
                    inputProps={{ step: 5, min: MIN_LINE_LENGTH_FEET }}
                    sx={{ maxWidth: 160 }}
                  />
                ) : (
                  <React.Fragment>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        size="small"
                        margin="dense"
                        type="number"
                        label="Width ft"
                        value={spreadWidthFeet}
                        onChange={handleSpreadWidthChange}
                        inputProps={{ step: 5, min: 5 }}
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        size="small"
                        margin="dense"
                        type="number"
                        label="Line ft"
                        value={lineLengthFeet}
                        onChange={handleLineLengthChange}
                        inputProps={{ step: 5, min: MIN_LINE_LENGTH_FEET }}
                        sx={{ flex: 1 }}
                      />
                    </Stack>
                    <TextField
                      size="small"
                      margin="dense"
                      type="number"
                      label="Turn buffer ft"
                      value={headlandBufferFeet}
                      onChange={handleHeadlandBufferChange}
                      inputProps={{ step: 5, min: 0 }}
                    />
                  </React.Fragment>
                )}
              </Stack>
            )}
          </Box>
          </Box>
        </Box>
      </Modal>
      <Modal open={modalOpen && dateRangeModalOpen} onClose={handleDateRangeModalClose}>
        <Box sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(420px, calc(100vw - 32px))',
          bgcolor: 'background.paper',
          boxShadow: 24,
          borderRadius: 2,
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
        >
          <Typography variant="h6">Date range</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Date start"
              type="date"
              value={dateRangeDraftStart}
              onChange={event => setDateRangeDraftStart(event.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label="Date end"
              type="date"
              value={dateRangeDraftEnd}
              onChange={event => setDateRangeDraftEnd(event.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
              error={hasDateRangeDraftError}
              helperText={hasDateRangeDraftError ? 'End date must be on or after start date.' : ' '}
            />
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" variant="outlined" onClick={handleDateRangeModalClose}>
              Cancel
            </Button>
            <Button size="small" variant="contained" onClick={handleDateRangeApply} disabled={hasDateRangeDraftError}>
              Apply
            </Button>
          </Stack>
        </Box>
      </Modal>
    </React.Fragment>
  );
});