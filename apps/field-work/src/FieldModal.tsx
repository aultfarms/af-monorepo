import React from 'react';
import { observer } from 'mobx-react-lite';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { context } from './state';

export const FieldModal = observer(() => {
  const { state, actions } = React.useContext(context);
  const operation = state.board?.operations.find(candidate => candidate.name === state.selectedOperationName) || null;
  const fieldState = operation?.fieldStateByName[state.fieldModal.fieldName] || null;
  const optionGroups = Object.entries(operation?.metadata.optionsByType || {});

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

            {state.fieldModal.action === 'complete' && (
              <>
                <TextField
                  label="Date"
                  type="date"
                  value={state.fieldModal.date}
                  onChange={(event) => actions.fieldModalDate(event.target.value)}
                  fullWidth
                />
                {optionGroups.map(([typeKey, options]) => (
                  <FormControl key={typeKey} fullWidth>
                    <InputLabel id={`${typeKey}-label`}>{options[0]?.type || typeKey}</InputLabel>
                    <Select
                      labelId={`${typeKey}-label`}
                      label={options[0]?.type || typeKey}
                      value={state.fieldModal.values[typeKey] || ''}
                      onChange={(event) => actions.fieldModalValue(typeKey, event.target.value)}
                    >
                      {options.map(option => (
                        <MenuItem key={`${typeKey}-${option.name}`} value={option.name}>
                          {option.name}{option.description ? ` — ${option.description}` : ''}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ))}
                <TextField
                  label="Note"
                  value={state.fieldModal.note}
                  onChange={(event) => actions.fieldModalNote(event.target.value)}
                  fullWidth
                />
              </>
            )}

            {state.fieldModal.action === 'uncomplete' && (
              <>
                <Typography>
                  Completed on {fieldState.completion?.date || 'unknown date'}.
                </Typography>
                {fieldState.completion?.rawPairs.map((pair, index) => (
                  <Typography key={`${pair.key}-${pair.value}-${index}`} variant="body2" color="text.secondary">
                    {`${pair.key}: ${pair.value}`}
                  </Typography>
                ))}
              </>
            )}

            {state.fieldModal.action === 'include' && (
              <Typography>
                This field is outside the operation crop/template filter. Add it to INCLUDE for this operation?
              </Typography>
            )}

            {state.fieldModal.action === 'remove_exclude' && (
              <Typography>
                This field is currently excluded from the operation. Remove it from EXCLUDE?
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={actions.closeFieldModal}>Cancel</Button>
        {state.fieldModal.action === 'complete' && (
          <Button color="warning" onClick={actions.excludeFromFieldModal}>
            Exclude
          </Button>
        )}
        {state.fieldModal.action && (
          <Button variant="contained" onClick={actions.submitFieldModal}>
            {state.fieldModal.action === 'complete' && 'Complete'}
            {state.fieldModal.action === 'uncomplete' && 'Un-complete'}
            {state.fieldModal.action === 'include' && 'Include'}
            {state.fieldModal.action === 'remove_exclude' && 'Remove exclusion'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
});
