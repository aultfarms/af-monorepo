const LOAD_GROUP_COLOR_PALETTE = [
  '#1976d2',
  '#2e7d32',
  '#ed6c02',
  '#9c27b0',
  '#d32f2f',
  '#00838f',
  '#6d4c41',
  '#5e35b1',
  '#7b1fa2',
  '#1565c0',
];

export const MULTI_ASSIGNMENT_REGION_COLOR = '#5f6368';
export const UNASSIGNED_REGION_COLOR = '#cdbd63';
export const EXISTING_SPREAD_REGION_FILL_COLOR = '#fff3a3';
export const EXISTING_SPREAD_REGION_BORDER_COLOR = '#f08c00';

export function buildLoadGroupColorMap(loadGroupKeys: string[]): Record<string, string> {
  const uniqueKeys = [ ...new Set(loadGroupKeys.filter(Boolean)) ].sort();
  return Object.fromEntries(uniqueKeys.map((loadGroupKey, index) => [
    loadGroupKey,
    LOAD_GROUP_COLOR_PALETTE[index % LOAD_GROUP_COLOR_PALETTE.length]!,
  ]));
}

export function regionColorFromLoadGroups(
  loadGroupKeys: string[],
  loadGroupColorMap: Record<string, string>,
): string {
  const uniqueKeys = [ ...new Set(loadGroupKeys.filter(Boolean)) ];
  if (uniqueKeys.length === 1) {
    return loadGroupColorMap[uniqueKeys[0]!] || UNASSIGNED_REGION_COLOR;
  }
  if (uniqueKeys.length > 1) {
    return MULTI_ASSIGNMENT_REGION_COLOR;
  }
  return UNASSIGNED_REGION_COLOR;
}

export function colorWithAlpha(color: string, alpha: string): string {
  if (!color.startsWith('#')) {
    return color;
  }

  const normalizedColor = color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color;

  return `${normalizedColor}${alpha}`;
}
