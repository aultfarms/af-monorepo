import React from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, Snackbar, Typography } from '@mui/material';
import { context } from './state';
import { CropManager } from './CropManager';
import { FieldManager } from './FieldManager';
import { FieldModal } from './FieldModal';
import { IssuesModal } from './IssuesModal';
import { LoadingIndicator } from './LoadingIndicator';
import { Map } from './Map';
import { NavBar } from './NavBar';
import { OptionsManager } from './OptionsManager';
import { OperationPanel } from './OperationPanel';
import './App.css';

export const App = observer(() => {
  const { state, actions } = React.useContext(context);

  if (state.loading && !state.trelloAuthorized && !state.board) {
    return (
      <Box sx={{ minHeight: '100vh', position: 'relative' }}>
        <LoadingIndicator />
      </Box>
    );
  }

  if (!state.trelloAuthorized) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center' }}>
        <Box sx={{ maxWidth: 520 }}>
          <Typography variant="h4" gutterBottom>
            Field Work
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Log in with Trello to use the field work app.
          </Typography>
          {state.loadingError && (
            <Typography color="error" sx={{ mb: 2 }}>
              {state.loadingError}
            </Typography>
          )}
          <Button variant="contained" onClick={() => actions.loginWithTrello()}>
            Login with Trello
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <div className="main">
      <NavBar />
      {state.loadingError && (
        <div className="loading-error">
          {state.loadingError}
        </div>
      )}
      <Box className="content-shell">
        <div className="content">
          <div className="map-wrapper">
            <Map />
          </div>
          <div className="panel-wrapper">
            {state.mode === 'field_manager'
              ? <FieldManager />
              : state.mode === 'crops_manager'
                ? <CropManager />
                : state.mode === 'options_manager'
                  ? <OptionsManager />
                  : <OperationPanel />}
          </div>
        </div>
        {state.loading && <LoadingIndicator />}
      </Box>
      <FieldModal />
      <IssuesModal />
      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        open={state.snackbar.open}
        autoHideDuration={3500}
        onClose={(_, reason) => {
          if (reason !== 'clickaway') {
            actions.closeSnackbar();
          }
        }}
        message={state.snackbar.message}
      />
    </div>
  );
});
