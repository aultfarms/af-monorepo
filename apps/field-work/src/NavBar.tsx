import React from 'react';
import { observer } from 'mobx-react-lite';
import { AppBar, IconButton, Menu, MenuItem, Toolbar, Tooltip, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import RefreshIcon from '@mui/icons-material/Refresh';
import { context } from './state';

export const NavBar = observer(() => {
  const { state, actions } = React.useContext(context);
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const issueCount = state.issues.length;
  const modeLabel = state.mode === 'field_manager'
    ? ' • Field Manager'
    : state.mode === 'crops_manager'
      ? ' • Crops Manager'
      : state.mode === 'options_manager'
        ? ' • Options Manager'
      : '';
  const contextLabel = state.mode === 'field_manager'
      ? (state.selectedManagerFieldName || 'No field selected')
      : state.mode === 'crops_manager'
        ? (state.selectedCropName || 'No crop/template selected')
        : (state.selectedOperationName || 'No operation selected');

  return (
    <AppBar position="static">
      <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <img alt="Ault Farms" src="/field-work/aultfarms_logo.png" width="75" />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {`Field Work${modeLabel}`}
        </Typography>
        <Typography variant="body2" sx={{ display: { xs: 'none', md: 'block' } }}>
          {contextLabel}
        </Typography>
        <Tooltip title="Locate me">
          <IconButton color="inherit" onClick={actions.locateMeOnMap}>
            <GpsFixedIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Refresh board">
          <IconButton color="inherit" onClick={() => actions.loadBoard(true)}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Menu">
          <IconButton color="inherit" onClick={(event) => setAnchorEl(event.currentTarget)}>
            <MenuIcon />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          <MenuItem disabled={state.mode === 'operations'} onClick={() => { actions.mode('operations'); setAnchorEl(null); }}>
            Operations
          </MenuItem>
          <MenuItem disabled={state.mode === 'field_manager'} onClick={() => { actions.mode('field_manager'); setAnchorEl(null); }}>
            Field Manager
          </MenuItem>
          <MenuItem disabled={state.mode === 'crops_manager'} onClick={() => { actions.mode('crops_manager'); setAnchorEl(null); }}>
            Crops Manager
          </MenuItem>
          <MenuItem disabled={state.mode === 'options_manager'} onClick={() => { actions.mode('options_manager'); setAnchorEl(null); }}>
            Options Manager
          </MenuItem>
          <MenuItem onClick={() => { actions.showAllFieldsOnMap(); setAnchorEl(null); }}>
            Fit all fields
          </MenuItem>
          <MenuItem onClick={() => { actions.loadBoard(true); setAnchorEl(null); }}>
            Refresh board
          </MenuItem>
          <MenuItem onClick={() => { actions.openIssuesModal(); setAnchorEl(null); }}>
            {`Issues${issueCount > 0 ? ` (${issueCount})` : ''}`}
          </MenuItem>
          <MenuItem onClick={() => { void actions.openAuthScreen(); setAnchorEl(null); }}>
            Login/Logout
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
});
