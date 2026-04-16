import React from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { context } from './state';

export const OptionsManager = observer(() => {
  const { state, actions } = React.useContext(context);
  const operations = state.board?.operations || [];
  const operation = operations.find(candidate => candidate.name === state.selectedOperationName) || null;
  const operationSelectValue = operation ? state.selectedOperationName : '';

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
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel id="options-manager-operation-label">Operation</InputLabel>
        <Select
          labelId="options-manager-operation-label"
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

      {!operation && (
        <Typography color="text.secondary">
          Select an operation to manage its completion options.
        </Typography>
      )}

      {operation && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={actions.addOptionDraft}>
              New Option
            </Button>
            <Button variant="contained" color="secondary" disabled={!state.optionDraftsDirty} onClick={actions.saveOptionDrafts}>
              Save Options
            </Button>
          </Stack>

          <Typography variant="body2" color="text.secondary">
            Each option becomes a completion selector for this operation. Options with the same type share one drop-down.
          </Typography>

          {state.optionDrafts.length < 1 && (
            <Typography color="text.secondary">
              No options configured yet.
            </Typography>
          )}

          {state.optionDrafts.map(option => (
            <Box key={option.key} sx={{ p: 1.5, bgcolor: '#ffffff', borderRadius: 1 }}>
              <Stack spacing={1.5}>
                <TextField
                  label="Type"
                  value={option.type}
                  onChange={(event) => actions.optionDraftType(option.key, event.target.value)}
                  fullWidth
                />
                <TextField
                  label="Name"
                  value={option.name}
                  onChange={(event) => actions.optionDraftName(option.key, event.target.value)}
                  fullWidth
                />
                <TextField
                  label="Description"
                  value={option.description}
                  onChange={(event) => actions.optionDraftDescription(option.key, event.target.value)}
                  fullWidth
                />
                <Stack direction="row" justifyContent="flex-end">
                  <Button color="error" onClick={() => actions.deleteOptionDraft(option.key)}>
                    Delete
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
});
