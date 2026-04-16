import React from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { context } from './state';

export const CropManager = observer(() => {
  const { state, actions } = React.useContext(context);
  const selectedCrop = state.cropDrafts.find(crop => crop.name === state.selectedCropName) || null;
  const boardFields = state.board?.fields || [];
  const selectedFieldNames = new Set(selectedCrop?.fieldNames || []);
  const selectedAcres = boardFields.reduce((sum, field) => sum + (selectedFieldNames.has(field.name) ? field.acreage : 0), 0);
  const templateChoices = state.cropDrafts.filter(crop => crop.name !== selectedCrop?.name);
  const [templateModalOpen, setTemplateModalOpen] = React.useState(false);
  const [templateCropName, setTemplateCropName] = React.useState('');
  const [templateInverse, setTemplateInverse] = React.useState(false);

  React.useEffect(() => {
    if (!templateChoices.find(crop => crop.name === templateCropName)) {
      setTemplateCropName(templateChoices[0]?.name || '');
    }
  }, [templateChoices, templateCropName]);

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
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={actions.addCropDraft}>
          New Crop/Template
        </Button>
        <Button
          variant="contained"
          disabled={!selectedCrop || templateChoices.length < 1}
          onClick={() => {
            setTemplateCropName(templateChoices[0]?.name || '');
            setTemplateInverse(false);
            setTemplateModalOpen(true);
          }}
        >
          Template
        </Button>
        <Button variant="contained" color="secondary" disabled={!state.cropDraftsDirty} onClick={actions.saveCropDrafts}>
          Save Crops/Templates
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Select a crop/template, then use the list or tap fields on the map to toggle membership.
      </Typography>

      {state.cropDrafts.length < 1 && (
        <Typography color="text.secondary">
          No crops/templates loaded yet.
        </Typography>
      )}

      {state.cropDrafts.length > 0 && (
        <Stack spacing={2}>
          <FormControl fullWidth>
            <InputLabel id="crop-manager-select-label">Crop/template</InputLabel>
            <Select
              labelId="crop-manager-select-label"
              label="Crop/template"
              value={selectedCrop?.name || ''}
              onChange={(event) => actions.selectedCropName(event.target.value)}
            >
              {state.cropDrafts.map(crop => (
                <MenuItem key={crop.name} value={crop.name}>
                  {`${crop.name}${crop.isTemplate ? ' (template)' : ''}`}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selectedCrop && (
            <>
              <TextField
                label="Crop/template name"
                value={selectedCrop.name}
                onChange={(event) => actions.cropDraftName(selectedCrop.name, event.target.value)}
                fullWidth
              />
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={selectedCrop.isTemplate}
                    onChange={(event) => actions.cropDraftTemplate(selectedCrop.name, event.target.checked)}
                  />
                )}
                label="Template instead of crop"
              />
              <Typography variant="body2" color="text.secondary">
                {`${selectedCrop.fieldNames.length} field${selectedCrop.fieldNames.length === 1 ? '' : 's'} • ${selectedAcres.toFixed(2)} ac`}
              </Typography>

              {boardFields.length < 1 ? (
                <Typography color="text.secondary">
                  No fields loaded yet.
                </Typography>
              ) : (
                <Box sx={{ p: 1, bgcolor: '#ffffff', borderRadius: 1 }}>
                  <Stack spacing={0.5}>
                    {boardFields.map(field => (
                      <FormControlLabel
                        key={field.name}
                        control={
                          <Checkbox
                            checked={selectedFieldNames.has(field.name)}
                            onChange={() => actions.toggleCropDraftField(selectedCrop.name, field.name)}
                          />
                        }
                        label={`${field.name} (${field.acreage.toFixed(2)} ac)`}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </>
          )}
        </Stack>
      )}

      <Dialog open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          Template
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <FormControl fullWidth>
              <InputLabel id="crop-template-select-label">Crop/template</InputLabel>
              <Select
                labelId="crop-template-select-label"
                label="Crop/template"
                value={templateCropName}
                onChange={(event) => setTemplateCropName(event.target.value)}
              >
                {templateChoices.map(crop => (
                  <MenuItem key={crop.name} value={crop.name}>
                    {`${crop.name}${crop.isTemplate ? ' (template)' : ''}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={<Checkbox checked={templateInverse} onChange={(event) => setTemplateInverse(event.target.checked)} />}
              label="Inverse"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateModalOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!selectedCrop || !templateCropName}
            onClick={() => {
              if (selectedCrop && templateCropName) {
                actions.applyCropTemplate(selectedCrop.name, templateCropName, templateInverse);
              }
              setTemplateModalOpen(false);
            }}
          >
            Update
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
});
