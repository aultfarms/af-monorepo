import React from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Button, Snackbar, Typography } from '@mui/material';
import { NavBar } from './NavBar';
import { Map } from './Map';
import { LoadForm } from './LoadForm';
import { FieldsForm } from './FieldsForm';
import { AccessManagementModal } from './AccessManagementModal';
import { HistoryModal } from './HistoryModal';
import { SourceManagementModal } from './SourceManagementModal';
import { DriverManagementModal } from './DriverManagementModal';
import { BottomLoadButton } from './BottomLoadButton';
import { LoadingIndicator } from './LoadingIndicator';
import { context } from './state';

import './App.css';

export const App = observer(() => {
  const { state, actions } = React.useContext(context);

  if (state.loading && state.auth.status === 'checking') {
    return <LoadingIndicator />;
  }

  if (state.auth.status === 'signed_out') {
    const hasError = !!(state.auth.error || state.loadingError);
    const canRetrySession = hasError && !!state.auth.email;
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center' }}>
        <Box sx={{ maxWidth: 480 }}>
          <Typography variant="h4" gutterBottom>
            Manure
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Sign in with an approved Google account to use the manure app.
          </Typography>
          {(state.auth.error || state.loadingError) && (
            <Typography color="error" sx={{ mb: 2 }}>
              {state.auth.error || state.loadingError}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="contained" color="primary" onClick={actions.startSignIn}>
              Sign in with Google
            </Button>
            {canRetrySession && (
              <Button variant="outlined" color="primary" onClick={() => void actions.retrySessionLoad()}>
                Retry
              </Button>
            )}
            {hasError && (
              <Button variant="outlined" color="primary" onClick={() => window.location.reload()}>
                Reload app
              </Button>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  if (state.auth.status === 'access_denied') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center' }}>
        <Box sx={{ maxWidth: 560 }}>
          <Typography variant="h4" gutterBottom>
            Access denied
          </Typography>
          <Typography sx={{ mb: 2 }}>
            {state.auth.email} is not currently on the manure access allowlist.
          </Typography>
          <Button variant="contained" color="primary" onClick={actions.signOut}>
            Use a different account
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
      <div className="content">
        {state.loading
          ? <LoadingIndicator />
          : (
              <React.Fragment>
                <div className="map-wrapper">
                  <Map />
                </div>
                <div className="form-wrapper">
                  {state.mode === 'loads' ? <LoadForm /> : <FieldsForm />}
                </div>
              </React.Fragment>
            )}
      </div>

      <AccessManagementModal />
      <HistoryModal />
      <SourceManagementModal />
      <DriverManagementModal />
      <div style={{ height: '3em' }} />
      <BottomLoadButton />
      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        open={state.snackbar.open}
        autoHideDuration={3000}
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
