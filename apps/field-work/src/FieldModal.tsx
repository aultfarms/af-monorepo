import React from 'react';
import { observer } from 'mobx-react-lite';
import { AddCircleOutline as AddCircleOutlineIcon, RemoveCircleOutline as RemoveCircleOutlineIcon } from '@mui/icons-material';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { context } from './state';

export const FieldModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const operation = state.board?.operations.find(candidate => candidate.name === state.selectedOperationName) || null;
  const fieldState = operation?.fieldStateByName[state.fieldModal.fieldName] || null;
  const optionGroups = Object.entries(operation?.metadata.optionsByType || {});
  const statusLabel = state.fieldModal.status === 'started'
    ? 'Started'
    : state.fieldModal.status === 'completed'
      ? 'Completed'
      : state.fieldModal.status === 'planned'
        ? 'Planned'
        : '';

  return (
    <Dialog open={state.fieldModal.open} onClose={actions.closeFieldModal} fullWidth maxWidth="sm">
      <DialogTitle>
        {state.fieldModal.fieldName || 'Field'}
      </DialogTitle>
      <DialogContent>
        {fieldState && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {operation?.name}
            </Typography>

            {state.fieldModal.mode === 'record' && (
              <>
                {statusLabel && (
                  <Typography variant="body2" color="text.secondary">
                    {statusLabel}{fieldState.completion?.date ? ` on ${fieldState.completion.date}` : ''}
                  </Typography>
                )}
                <TextField
                  label="Date"
                  type="date"
                  value={state.fieldModal.date}
                  onChange={(event) => actions.fieldModalDate(event.target.value)}
                  fullWidth
                />
                {optionGroups.map(([typeKey, options]) => (state.fieldModal.values[typeKey] || []).map((value, index, values) => {
                  const label = `${options[0]?.type || typeKey}${values.length > 1 ? ` ${index + 1}` : ''}`;
                  const labelId = `${typeKey}-${index}-label`;
                  const valueIsKnown = options.some(option => option.name === value);

                  return (
                    <Stack key={`${typeKey}-${index}`} direction="row" spacing={1} alignItems="center">
                      <FormControl fullWidth>
                        <InputLabel id={labelId}>{label}</InputLabel>
                        <Select
                          labelId={labelId}
                          label={label}
                          value={value}
                          onChange={(event) => actions.fieldModalValue(typeKey, index, event.target.value)}
                        >
                          {!valueIsKnown && value && (
                            <MenuItem value={value}>
                              {`${value} — missing option`}
                            </MenuItem>
                          )}
                          {options.map(option => (
                            <MenuItem key={`${typeKey}-${option.name}`} value={option.name}>
                              {option.name}{option.description ? ` — ${option.description}` : ''}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Tooltip title={`Add another ${options[0]?.type || typeKey}`}>
                        <IconButton onClick={() => actions.duplicateFieldModalValue(typeKey, index)}>
                          <AddCircleOutlineIcon />
                        </IconButton>
                      </Tooltip>
                      {values.length > 1 && (
                        <Tooltip title={`Remove ${options[0]?.type || typeKey}`}>
                          <IconButton onClick={() => actions.removeFieldModalValue(typeKey, index)}>
                            <RemoveCircleOutlineIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  );
                }))}
                <TextField
                  label="Note"
                  value={state.fieldModal.note}
                  onChange={(event) => actions.fieldModalNote(event.target.value)}
                  fullWidth
                />
              </>
            )}
            {state.fieldModal.mode === 'include' && (
              <Typography>
                This field is outside the operation crop/template filter. Add it to INCLUDE for this operation?
              </Typography>
            )}
            {state.fieldModal.mode === 'remove_exclude' && (
              <Typography>
                This field is currently excluded from the operation. Remove it from EXCLUDE?
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={actions.closeFieldModal}>Cancel</Button>
        {state.fieldModal.mode === 'record' && state.fieldModal.status === 'planned' && (
          <>
            <Button color="warning" onClick={() => actions.submitFieldModal('exclude')}>
              Exclude
            </Button>
            <Button color="warning" variant="contained" onClick={() => actions.submitFieldModal('start')}>
              Start
            </Button>
            <Button variant="contained" onClick={() => actions.submitFieldModal('complete')}>
              Complete
            </Button>
          </>
        )}
        {state.fieldModal.mode === 'record' && state.fieldModal.status === 'started' && (
          <>
            <Button onClick={() => actions.submitFieldModal('unstart')}>
              Un-start
            </Button>
            <Button color="warning" variant="contained" onClick={() => actions.submitFieldModal('save_started')}>
              Save started
            </Button>
            <Button variant="contained" onClick={() => actions.submitFieldModal('complete')}>
              Complete
            </Button>
          </>
        )}
        {state.fieldModal.mode === 'record' && state.fieldModal.status === 'completed' && (
          <>
            <Button onClick={() => actions.submitFieldModal('uncomplete')}>
              Un-complete
            </Button>
            <Button color="warning" variant="contained" onClick={() => actions.submitFieldModal('start')}>
              Started
            </Button>
            <Button variant="contained" onClick={() => actions.submitFieldModal('save_completed')}>
              Save completed
            </Button>
          </>
        )}
        {state.fieldModal.mode === 'include' && (
          <Button variant="contained" onClick={() => actions.submitFieldModal('include')}>
            Include
          </Button>
        )}
        {state.fieldModal.mode === 'remove_exclude' && (
          <Button variant="contained" onClick={() => actions.submitFieldModal('remove_exclude')}>
            Remove exclusion
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});
