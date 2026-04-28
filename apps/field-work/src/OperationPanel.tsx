import React from 'react';
import { observer } from 'mobx-react-lite';
import { Add as AddIcon, Edit as EditIcon } from '@mui/icons-material';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, IconButton, InputLabel, List, ListItem, ListItemButton, ListItemText, MenuItem, Select, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { context } from './state';

function percentLabel(value: number): string {
  return `${value.toFixed(1)}%`;
}

function normalizeCropName(value: string): string {
  return value.trim().toLowerCase();
}

export const OperationPanel = observer(() => {
  const { state, actions } = React.useContext(context);
  const operations = state.board?.operations || [];
  const operation = operations.find(candidate => candidate.name === state.selectedOperationName) || null;
  const operationSelectValue = operation ? state.selectedOperationName : '';
  const cropLists = state.board?.cropLists || [];
  const cropListByName = new Map(cropLists.map(crop => [ normalizeCropName(crop.crop), crop ]));
  const missingCropFilters = operation?.metadata.crops.filter(cropName => !cropListByName.has(normalizeCropName(cropName))) || [];
  const cropTemplateOptions = [
    ...cropLists.map(crop => ({
      name: crop.crop,
      isTemplate: crop.isTemplate,
      missing: false,
    })),
    ...missingCropFilters.map(cropName => ({
      name: cropName,
      isTemplate: false,
      missing: true,
    })),
  ];
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editorMode, setEditorMode] = React.useState<'create' | 'edit'>('create');
  const [editorName, setEditorName] = React.useState('');
  const [editorCropNames, setEditorCropNames] = React.useState<string[]>([]);
  const completedFieldStates = operation
    ? operation.fieldStates
      .filter(fieldState => fieldState.status === 'completed' && !!fieldState.completion)
      .sort((left, right) =>
        (right.completion?.date || '').localeCompare(left.completion?.date || '')
        || (right.completion?.dateLastActivity || '').localeCompare(left.completion?.dateLastActivity || '')
        || left.field.name.localeCompare(right.field.name),
      )
    : [];

  const openCreateEditor = () => {
    setEditorMode('create');
    setEditorName('');
    setEditorCropNames([]);
    setEditorOpen(true);
  };

  const openEditEditor = () => {
    if (!operation) {
      return;
    }
    setEditorMode('edit');
    setEditorName(operation.name);
    setEditorCropNames(operation.metadata.crops);
    setEditorOpen(true);
  };

  const handleShowFieldOnMap = (event: React.MouseEvent<HTMLButtonElement>, fieldName: string) => {
    event.preventDefault();
    event.stopPropagation();
    actions.showFieldOnMap(fieldName);
  };

  return (
    <Box
      sx={{
        p: 2,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        bgcolor: '#f5f5f5',
        overflow: 'auto',
        '@media (orientation: portrait)': {
          height: 'auto',
          overflow: 'visible',
        },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'flex-start' }}>
        <FormControl fullWidth>
          <InputLabel id="operation-label">Operation</InputLabel>
          <Select
            labelId="operation-label"
            label="Operation"
            value={operationSelectValue}
            onChange={(event) => actions.selectedOperationName(event.target.value)}
          >
            <MenuItem value="">
              <em>Select an operation</em>
            </MenuItem>
            {operations.map(candidate => (
              <MenuItem key={candidate.name} value={candidate.name}>
                {candidate.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tooltip title="Create operation">
          <span>
            <IconButton color="primary" onClick={openCreateEditor} sx={{ mt: 0.5 }}>
              <AddIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Edit operation">
          <span>
            <IconButton color="primary" disabled={!operation} onClick={openEditEditor} sx={{ mt: 0.5 }}>
              <EditIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {!operation && (
        <Typography color="text.secondary">
          Select an operation to activate the map and completion controls.
        </Typography>
      )}

      {operation && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {operation.metadata.crops.length > 0
              ? `Crop/template filter: ${operation.metadata.crops.join(', ')}`
              : 'Crop/template filter: all fields'}
          </Typography>
          {missingCropFilters.length > 0 && (
            <Typography variant="body2" color="warning.main">
              {`Missing crop/template filters: ${missingCropFilters.join(', ')}`}
            </Typography>
          )}

          <Stack direction="row" spacing={2}>
            <Box sx={{ flex: 1, p: 1.5, bgcolor: '#e8f5e9', borderRadius: 1 }}>
              <Typography variant="subtitle2" color="success.main">
                Completed
              </Typography>
              <Typography variant="h6">
                {operation.acreage.completed.toFixed(2)} ac
              </Typography>
              <Typography variant="body2">
                {percentLabel(operation.acreage.completedPercent)}
              </Typography>
            </Box>
            <Box sx={{ flex: 1, p: 1.5, bgcolor: '#ffebee', borderRadius: 1 }}>
              <Typography variant="subtitle2" color="error.main">
                Planned
              </Typography>
              <Typography variant="h6">
                {operation.acreage.planned.toFixed(2)} ac
              </Typography>
              <Typography variant="body2">
                {percentLabel(operation.acreage.plannedPercent)}
              </Typography>
            </Box>
          </Stack>

          <Box sx={{ p: 1.5, bgcolor: '#ffffff', borderRadius: 1 }}>
            <Typography variant="subtitle2">
              Eligible total
            </Typography>
            <Typography variant="h6">
              {operation.acreage.total.toFixed(2)} ac
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" color="success.main" sx={{ mb: 1 }}>
              Completed fields
            </Typography>
            <List dense disablePadding>
              {completedFieldStates
                .map(fieldState => (
                  <ListItem
                    key={`completed-${fieldState.field.name}`}
                    disablePadding
                    secondaryAction={(
                      <Tooltip title={`Show ${fieldState.field.name} on map`}>
                        <IconButton edge="end" aria-label={`Show ${fieldState.field.name} on map`} onClick={(event) => handleShowFieldOnMap(event, fieldState.field.name)}>
                          <GpsFixedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  >
                    <ListItemButton sx={{ pr: 7 }} onClick={() => actions.openFieldModal(fieldState.field.name)}>
                      <ListItemText
                        primary={fieldState.field.name}
                        secondaryTypographyProps={{ component: 'div' }}
                        secondary={(
                          <Stack spacing={0.25}>
                            <Typography variant="body2" color="text.secondary">
                              {`Completed ${fieldState.completion?.date || ''}`}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {`${fieldState.field.acreage.toFixed(2)} ac`}
                            </Typography>
                            {fieldState.completion?.rawPairs.length ? (
                              <Typography variant="body2" color="text.secondary">
                                {fieldState.completion.rawPairs.map(pair => `${pair.key}: ${pair.value}`).join(' • ')}
                              </Typography>
                            ) : null}
                          </Stack>
                        )}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              {completedFieldStates.length < 1 && (
                <Typography variant="body2" color="text.secondary">
                  No completed fields yet.
                </Typography>
              )}
            </List>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" color="error.main" sx={{ mb: 1 }}>
              Planned fields
            </Typography>
            <List dense disablePadding>
              {operation.fieldStates
                .filter(fieldState => fieldState.status === 'planned')
                .map(fieldState => (
                  <ListItem
                    key={`planned-${fieldState.field.name}`}
                    disablePadding
                    secondaryAction={(
                      <Tooltip title={`Show ${fieldState.field.name} on map`}>
                        <IconButton edge="end" aria-label={`Show ${fieldState.field.name} on map`} onClick={(event) => handleShowFieldOnMap(event, fieldState.field.name)}>
                          <GpsFixedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  >
                    <ListItemButton sx={{ pr: 7 }} onClick={() => actions.openFieldModal(fieldState.field.name)}>
                      <ListItemText
                        primary={fieldState.field.name}
                        secondary={`${fieldState.field.acreage.toFixed(2)} ac`}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              {operation.plannedFieldNames.length < 1 && (
                <Typography variant="body2" color="text.secondary">
                  No planned fields remain.
                </Typography>
              )}
            </List>
          </Box>
        </Stack>
      )}

      <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          {editorMode === 'create' ? 'Create Operation' : 'Edit Operation'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Operation name"
              value={editorName}
              onChange={(event) => setEditorName(event.target.value)}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel id="operation-crop-filter-label">Crop/template filter</InputLabel>
              <Select
                multiple
                labelId="operation-crop-filter-label"
                label="Crop/template filter"
                value={editorCropNames}
                onChange={(event) => setEditorCropNames(typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)}
                renderValue={(selected) => {
                  const values = selected as string[];
                  return values.length > 0 ? values.join(', ') : 'All fields';
                }}
              >
                {cropTemplateOptions.map(option => (
                  <MenuItem key={`${option.name}-${option.missing ? 'missing' : 'known'}`} value={option.name}>
                    <Checkbox checked={editorCropNames.some(name => normalizeCropName(name) === normalizeCropName(option.name))} />
                    <ListItemText primary={option.missing ? `Missing: ${option.name}` : `${option.name}${option.isTemplate ? ' (template)' : ''}`} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              Changing the crop/template filter does not alter INCLUDE or EXCLUDE cards, and recorded completion cards stay on the list. Out-of-filter or excluded completion cards are ignored in calculations.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditorOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              const didSave = await actions.saveOperationDefinition({
                operation: editorMode === 'edit' ? operation || undefined : undefined,
                name: editorName,
                cropNames: editorCropNames,
              });
              if (didSave) {
                setEditorOpen(false);
              }
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});
