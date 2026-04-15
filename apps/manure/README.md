# Manure App
`apps/manure` is the browser UI for recording manure loads. The app stays React + TypeScript + MobX, but Firestore is now the system of record instead of direct in-browser Google Sheets access.

## Current architecture
The app is split into three layers:

- `apps/manure`
  - UI, MobX state, Firebase auth flow, map interactions, and form behavior.
- `libs/firebase`
  - Shared browser Firebase setup for this app and future apps.
  - Owns Firebase app initialization, Google sign-in, auth persistence, and Firestore cache setup.
- `libs/manure`
  - Shared manure domain types and Firestore repository logic.
  - Owns yearly collection layout, loading/saving manure data, and sheet-row conversion helpers for future sync tooling.

The app currently loads:

- current year fields
- current year sources
- current year drivers
- current year loads
- previous year loads for map/history context

## Firestore data model
The Firestore shape is year-scoped:

- `manureYears/{year}/fields/{fieldId}`
- `manureYears/{year}/sources/{sourceId}`
- `manureYears/{year}/drivers/{driverId}`
- `manureYears/{year}/loads/{loadId}`
- `manureAccess/{email}`
- optional `manureMeta/{document}`

`libs/manure/src/repository.ts` is the source of truth for those paths.

New years bootstrap automatically. If the current year has no `fields`, `sources`, or `drivers`, the repository copies those lookup collections from the previous year. Loads are not copied forward.

## Auth, allowlist, and roles
The web app uses Firebase Authentication with Google sign-in.

Access control is allowlist-based:

- every signed-in user is checked against `manureAccess/{email}`
- `enabled: true` is required for normal app access
- `admin: true` marks an admin user for future admin-only UI and access management
- `displayName` is optional UI metadata

Recommended document shape:

```json path=null start=null
{
  "enabled": true,
  "admin": false,
  "displayName": "Operator Name"
}
```

Firestore rules live in `firestore.rules`. The important behavior is:

- users can read their own `manureAccess` record after sign-in
- admins can read/write allowlist records
- manure year data requires a signed-in, email-verified, allowlisted user

## Offline behavior
Offline use is an explicit requirement.

`libs/firebase/src/browser.ts` always tries to initialize Firestore with persistent local cache and local auth persistence. If the browser cannot provide persistent cache, it falls back to memory cache instead of failing startup.

That gives the app these behaviors:

- cached reads continue working after reloads when persistent cache is available
- writes queue locally while offline and sync when connectivity returns
- auth state is kept locally in the browser

The current cache mode is exposed in the UI menu.

## Firebase config
The Firebase project currently targets `aultfarms-8ffd6`, with repo-level Firebase config in:

- `.firebaserc`
- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`

The browser config lives in `apps/manure/src/firebaseConfig.ts` and can be overridden with Vite env vars:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

These values are not secrets for a browser app. Security comes from Firebase Auth and Firestore rules, not from hiding the web config.

## Local development
From the repo root:

- install dependencies:
  - `yarn install`
- build shared libs used by the app:
  - `yarn workspace @aultfarms/firebase build`
  - `yarn workspace @aultfarms/manure build`
- run the manure app:
  - `yarn workspace manure dev`
- build the manure app:
  - `yarn workspace manure build`

Firebase emulator ports are currently configured as:

- Auth: `9099`
- Firestore: `8080`

## Yearly spreadsheet sync design
Firestore is the source of truth. Google Sheets exists for sync and operational export/import, not as the primary live backend.

The intended yearly spreadsheet model is:

- one spreadsheet per year, named `YYYY_Manure`
- one spreadsheet-bound Apps Script project per yearly spreadsheet
- a hidden `_meta` sheet in each spreadsheet stores at least:
  - `spreadsheetId`
  - `scriptId`
  - `year`
  - script/schema version metadata

`libs/manure/src/spreadsheet.ts` already contains the row-shape helpers that the future sync tooling should reuse so the sheet mapping stays aligned with the Firestore model.

## Planned sheet automation workflow
This workflow is the agreed target design. Parts of it are still to be implemented in the repo.

### In-sheet flow
Each yearly spreadsheet should expose a `Create next year` action that:

- copies the current spreadsheet
- renames it to the next `YYYY_Manure`
- lets the copied bound script initialize its own `_meta` values on first open

### Repo-side deployment flow
The repo should contain a shared Apps Script workspace, expected to become something like `utils/manure-sheet-sync`.

That utility should:

- hold the single local source tree for the Apps Script code
- discover yearly manure spreadsheets from a designated Drive folder
- read each spreadsheet’s hidden `_meta` sheet
- extract the bound `scriptId`
- fan out `clasp push` to every discovered bound script

The important point is that `clasp` is still the deployment mechanism, but yearly sheet/script IDs should be discovered automatically instead of being hand-maintained in repo config.

The intended command name for that repo-side fan-out is `deploy-manure-scripts`.

## Developer notes
- Keep comments minimal and intent-focused.
- Prefer adding manure-specific persistence logic in `libs/manure`, not inside React components.
- Prefer adding generic Firebase browser helpers in `libs/firebase`, not inside `apps/manure`.
- If sheet sync behavior changes, update both the Apps Script workspace and the row-mapping helpers in `libs/manure/src/spreadsheet.ts`.
