import React from 'react';
import { observer } from 'mobx-react-lite';
import { context } from './state';
import {
  Typography,
  Box,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  FormLabel,
  InputLabel,
  ToggleButtonGroup,
  ToggleButton,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';

export const LoadForm = observer(() => {
  const { state, actions } = React.useContext(context);
  return (
    <Box sx={{ p: 2, width: '100%', height: '100%', boxSizing: 'border-box', bgcolor: '#f5f5f5', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography color="secondary" variant="h6" component="div">
          Loads: {state.load.loads}
        </Typography>
        <FormControlLabel
          control={(
            <Checkbox
              checked={state.draw.enabled}
              onChange={event => actions.setDrawEnabled(event.target.checked)}
            />
          )}
          label="Draw"
          sx={{ mr: 0 }}
        />
      </Box>
      <TextField
        label="Date"
        type="date"
        value={state.load.date}
        onChange={e => actions.load({ date: e.target.value })}
        fullWidth
        sx={{ mb: 2 }}
      />

      <FormControl fullWidth sx={{ mb: 2, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
        <InputLabel id="field-label">Field</InputLabel>
        <Select
          labelId="field-label"
          label="Field"
          value={state.load.field}
          sx={{ flexGrow: 1 }}
          onChange={e => actions.load({ field: e.target.value })}
        >
          {state.fields.map(f => (
            <MenuItem key={f.name} value={f.name}>{f.name}</MenuItem>
          ))}
        </Select>
        <IconButton
          aria-label="autoselect field"
          onClick={() => actions.autoselectField()}
          color="primary"
        >
          <TravelExploreIcon />
        </IconButton>
      </FormControl>

      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel id="source-label">Source</InputLabel>
        <Select
          labelId="source-label"
          label="Source"
          value={state.load.source}
          onChange={e => actions.load({ source: e.target.value })}
        >
          {state.sources.map(f => (
            <MenuItem key={f.name} value={f.name}>{f.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel id="driver-label">Driver</InputLabel>
        <Select
          labelId="driver-label"
          label="Driver"
          value={state.load.driver}
          onChange={e => actions.load({ driver: e.target.value })}
        >
          {state.drivers.map(f => (
            <MenuItem key={f.name} value={f.name}>{f.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl component="fieldset" fullWidth sx={{ mb: 2 }}>
        <FormLabel component="legend" sx={{ mb: 1 }}>GPS Mode</FormLabel>
        <ToggleButtonGroup
          value={state.gpsMode}
          exclusive
          color='primary'
          onChange={(_event, newmode) => newmode !== null && actions.gpsMode(newmode)}
          aria-label="gps mode"
          fullWidth
          sx={{ mb: 2 }}
        >
          <ToggleButton value="map" aria-label="map">Map</ToggleButton>
          <ToggleButton value="me" aria-label="me">Me</ToggleButton>
        </ToggleButtonGroup>
      </FormControl>

    </Box>
  );
});