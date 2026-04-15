import React from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import { useDropzone } from 'react-dropzone';
import { context } from './state';

export const FieldManager = observer(() => {
  const { state, actions } = React.useContext(context);
  const selectedField = state.fieldDrafts.find(field => field.name === state.selectedManagerFieldName) || null;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/vnd.google-earth.kmz': ['.kmz'] },
    onDrop: (acceptedFiles) => {
      if (acceptedFiles[0]) {
        actions.importKMZ(acceptedFiles[0]);
      }
    },
  });

  return (
    <Box sx={{ p: 2, width: '100%', height: '100%', boxSizing: 'border-box', bgcolor: '#f5f5f5', overflow: 'auto' }}>
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <Button variant="contained" onClick={actions.addFieldDraft} sx={{ minHeight: 36 }}>
          New Field
        </Button>
        <Button variant="contained" color="secondary" disabled={!state.fieldDraftsDirty} onClick={actions.saveFieldDrafts} sx={{ minHeight: 36 }}>
          Save Fields
        </Button>
        <Box
          {...getRootProps()}
          sx={{
            minHeight: 36,
            px: 1.5,
            border: '1px dashed',
            borderColor: isDragActive ? 'primary.main' : '#9e9e9e',
            borderRadius: 1,
            bgcolor: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flex: '1 1 160px',
          }}
        >
          <input {...getInputProps()} />
          <Typography variant="button" color={isDragActive ? 'primary.main' : 'text.primary'}>
            {isDragActive ? 'Drop KMZ here' : 'Import KMZ'}
          </Typography>
        </Box>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Select a field, then use the map draw/edit toolbar to create or edit its polygon boundary.
      </Typography>
      {state.fieldDrafts.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'flex-start' }}>
          <FormControl fullWidth>
            <InputLabel id="field-manager-select-label">Field</InputLabel>
            <Select
              labelId="field-manager-select-label"
              label="Field"
              value={selectedField?.name || ''}
              onChange={(event) => actions.selectedManagerFieldName(event.target.value)}
            >
              {state.fieldDrafts.map(field => (
                <MenuItem key={field.name} value={field.name}>
                  {field.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <IconButton edge="end" onClick={() => selectedField && actions.moveMapToField(selectedField.name)} disabled={!selectedField} sx={{ mt: 0.5 }}>
            <GpsFixedIcon />
          </IconButton>
          <IconButton edge="end" onClick={() => selectedField && actions.deleteFieldDraft(selectedField.name)} disabled={!selectedField} sx={{ mt: 0.5 }}>
            <DeleteIcon />
          </IconButton>
        </Stack>
      )}

      {state.fieldDrafts.length < 1 && (
        <Typography sx={{ mb: 2 }} color="text.secondary">
          No fields loaded yet.
        </Typography>
      )}

      {selectedField && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {`${selectedField.acreage.toFixed(2)} ac${selectedField.boundary ? '' : ' • no boundary yet'}`}
          </Typography>
          <TextField
            label="Field name"
            value={selectedField.name}
            onChange={(event) => actions.fieldDraftName(selectedField.name, event.target.value)}
            fullWidth
          />
          <TextField
            label="Aliases"
            helperText="Comma-separated aliases"
            value={selectedField.aliases.join(', ')}
            onChange={(event) => actions.fieldDraftAliases(selectedField.name, event.target.value)}
            fullWidth
          />
          <TextField
            label="Acreage"
            type="number"
            value={selectedField.acreage}
            onChange={(event) => actions.fieldDraftAcreage(selectedField.name, +(event.target.value || '0'))}
            fullWidth
          />
          <Typography variant="body2" color="text.secondary">
            {selectedField.boundary
              ? 'Use the edit toolbar on the map to drag, add, or delete polygon vertices.'
              : 'Use the polygon draw tool on the map to create this field boundary.'}
          </Typography>
        </Stack>
      )}
    </Box>
  );
});
