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
  const { trelloDiagnostics } = state;
  const showAuthScreen = state.authScreenOpen || !state.board;
  const primaryAuthActionLabel = state.trelloAuthorized ? 'Logout' : 'Login with Trello';
  const primaryAuthAction = state.trelloAuthorized
    ? () => actions.logoutTrello()
    : () => actions.loginWithTrello();
  const authScreenMessage = state.board && state.authScreenOpen
    ? 'Review Trello login and Field Work board diagnostics.'
    : state.loadingError
      ? 'Field Work could not load its Trello data.'
      : 'Log in with Trello to use the field work app.';

  if (state.loading && !state.board) {
    return (
      <Box sx={{ minHeight: '100vh', position: 'relative' }}>
        <LoadingIndicator />
      </Box>
    );
  }
  if (showAuthScreen) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center' }}>
        <Box sx={{ maxWidth: 520 }}>
          <Typography variant="h4" gutterBottom>
            Field Work
          </Typography>
          <Typography sx={{ mb: 2 }}>
            {authScreenMessage}
          </Typography>
          {state.loadingError && (
            <Typography color="error" sx={{ mb: 2 }}>
              {state.loadingError}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', mb: 3 }}>
            <Button variant="contained" onClick={primaryAuthAction}>
              {primaryAuthActionLabel}
            </Button>
            <Button variant="outlined" onClick={() => actions.loadTrelloDiagnostics()}>
              Refresh Trello Diagnostics
            </Button>
            <Button color="warning" variant="outlined" onClick={() => actions.resetLocalCache()}>
              Reset local cache
            </Button>
            {state.board && (
              <Button variant="text" onClick={() => actions.closeAuthScreen()}>
                Back to app
              </Button>
            )}
          </Box>
          <Box sx={{ textAlign: 'left', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Trello diagnostics
            </Typography>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              <strong>Token storage key:</strong> {trelloDiagnostics.tokenStorageKey}
            </Typography>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              <strong>Token present:</strong> {trelloDiagnostics.tokenPresent ? 'Yes' : 'No'}
            </Typography>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              <strong>Expected organization:</strong> {trelloDiagnostics.expectedOrgName || '—'}
            </Typography>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              <strong>Expected board:</strong> {trelloDiagnostics.expectedBoardName || '—'}
            </Typography>
            {trelloDiagnostics.loading && (
              <Typography variant="body2" sx={{ mb: 1.5 }}>
                Loading Trello diagnostics…
              </Typography>
            )}
            {trelloDiagnostics.error && (
              <Typography color="error" variant="body2" sx={{ mb: 1.5 }}>
                {trelloDiagnostics.error}
              </Typography>
            )}
            <Typography variant="subtitle2">User</Typography>
            {trelloDiagnostics.user ? (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="body2"><strong>Username:</strong> {trelloDiagnostics.user.username || '—'}</Typography>
                <Typography variant="body2"><strong>Full name:</strong> {trelloDiagnostics.user.fullName || '—'}</Typography>
                <Typography variant="body2"><strong>Email:</strong> {trelloDiagnostics.user.email || '—'}</Typography>
                <Typography variant="body2"><strong>Profile:</strong> {trelloDiagnostics.user.url || '—'}</Typography>
              </Box>
            ) : (
              <Typography variant="body2" sx={{ mb: 1.5 }}>
                No Trello user details loaded.
              </Typography>
            )}
            <Typography variant="subtitle2">Organizations</Typography>
            {trelloDiagnostics.organizations.length > 0 ? (
              <Box component="ul" sx={{ mt: 0.5, mb: 1.5, pl: 3 }}>
                {trelloDiagnostics.organizations.map(org => (
                  <li key={org.id}>
                    <Typography variant="body2">
                      {org.displayName || org.name || org.id}
                      {org.id === trelloDiagnostics.defaultOrganizationId ? ' (default organization match)' : ''}
                    </Typography>
                  </li>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ mb: 1.5 }}>
                No organizations loaded.
              </Typography>
            )}
            <Typography variant="subtitle2">Boards in default organization</Typography>
            {trelloDiagnostics.defaultOrganizationFound ? (
              trelloDiagnostics.boardsInDefaultOrganization.length > 0 ? (
                <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 3 }}>
                  {trelloDiagnostics.boardsInDefaultOrganization.map(board => (
                    <li key={board.id}>
                      <Typography variant="body2">
                        {board.name || board.id}
                        {board.closed ? ' (closed)' : ''}
                      </Typography>
                    </li>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2">
                  The default organization was found, but no boards were returned.
                </Typography>
              )
            ) : (
              <Typography variant="body2">
                The default organization was not found in the Trello account.
              </Typography>
            )}
          </Box>
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
          <div className="map-wrapper" id="field-work-map">
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
