export * from '../types.js';
import debug from 'debug';
import { type TrelloRESTFunction, type TrelloRequestFunction,
  assertTrelloBoards, assertTrelloBoard, assertTrelloOrgs, assertTrelloOrg,
  assertTrelloLists, assertTrelloList, assertTrelloCards, assertTrelloCard } from '../types.js';
import { getUniversalClient } from '../client.js';
const info = debug('af/trello#browser:info');

export * from '../index.js'; // export all the universal things

// dev key: 3ad06cb25802014a3f24f479e886771c
// URL to refresh client lib: https://api.trello.com/1/client.js?key=3ad06cb25802014a3f24f479e886771c
const devKey = '3ad06cb25802014a3f24f479e886771c';
//type BrowserTrelloRESTFunction = (path: string, params: TrelloRequestParams, success: TrelloSuccessCallback, err: TrelloRejectCallback) => void;

async function waitUntilLoaded(): Promise<void> { return; } // This library is always loaded

//-----------------------------------------------------------------
let token = '';

async function loadTokenFromStorageOrHash(): Promise<string> {
  await waitUntilLoaded();

  // Check localStorage for existing token
  try {
    token = localStorage.getItem('trello_token') || '';
  } catch (e) {
    info('Error reading trello_token from localStorage', e);
    token = '';
  }
  if (token) return token;

  // Check if we're getting here as a result of a previous redirect
  // that is now coming back to us with a token
  const hash = window.location.hash.slice(1);
  if (!hash) return '';

  const hashParams = new URLSearchParams(hash);
  const urlToken = hashParams.get('token') || '';
  const error = hashParams.get('error') || '';
  if (error) throw new Error('ERROR: User declined access or other Trello failure.  Error was: '+error);
  if (urlToken) {
    token = urlToken;
    try {
      localStorage.setItem('trello_token', token);
    } catch (e) {
      info('Error writing trello_token to localStorage', e);
    }

    // Strip the token (and any other fragment) from the URL so it is
    // not visible in the address bar once we have safely stored it.
    try {
      const { origin, pathname, search } = window.location;
      const cleanUrl = origin + pathname + search;
      window.history.replaceState(null, document.title, cleanUrl);
    } catch (e) {
      info('Error stripping Trello token fragment from URL', e);
    }

    return token;
  }
  info('WARNING: window.location.hash (', window.location.hash, ') has token, but it was not valid, retrying redirect.')
  return '';
}

async function authorize(): Promise<void> {
  info('Authorize started.')

  const found = await loadTokenFromStorageOrHash();
  if (found) return;

  const return_url = window.location.href.replace(/#.*$/, '');
  // Redirect browser to Trello authorization endpoint
  const newhref = 'https://api.trello.com/1/authorize'
    + '?return_url='+return_url
    + '&callback_method=fragment'
    + '&scope=read,write'
    + '&expiration=never'
    + '&name=Ault%20Farms%20Apps'
    + '&key='+devKey
    + '&response_type=fragment';
  window.location.href = newhref; // adds to browser history
  window.location.replace(newhref); // actually immediately redirects and stops execution
}

async function deauthorize(): Promise<void> {
  localStorage.removeItem('trello_token');
  await waitUntilLoaded();
};

export async function checkAuthorization(): Promise<boolean> {
  let currentToken = '';
  try {
    currentToken = await loadTokenFromStorageOrHash();
  } catch (e) {
    info('checkAuthorization: error while loading Trello token', e);
    return false;
  }

  if (!currentToken) return false;

  // Verify the token by making a lightweight call to the Trello API.
  const url = new URL('https://api.trello.com/1/members/me');
  url.searchParams.set('key', devKey);
  url.searchParams.set('token', currentToken);

  try {
    const resp = await fetch(url.toString(), { method: 'GET' });
    if (!resp.ok) {
      info('checkAuthorization: Trello token validation failed with status', resp.status);
      try {
        localStorage.removeItem('trello_token');
      } catch (e) {
        info('Error clearing invalid trello_token from localStorage', e);
      }
      token = '';
      return false;
    }

    // Token is valid; keep it in the module-level variable for future
    // requests made via request().
    token = currentToken;
    return true;
  } catch (e) {
    info('checkAuthorization: error while validating Trello token', e);
    // On network or other errors, treat as not authorized but do not
    // clear any existing token so a later retry can succeed.
    return false;
  }
}

const request: TrelloRequestFunction = async (method, path, params) => {
  await waitUntilLoaded();
  const stringParams: Record<string,string> = {};
  for (const [key,val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    stringParams[key] = ''+val;
  }
  if (path[0]!== '/') path = '/' + path;
  const url = new URL('https://api.trello.com/1'+path);
  url.searchParams.set('key', devKey);
  url.searchParams.set('token', token);

  const requestInit: RequestInit = {
    method: method.toUpperCase(),
  };

  if (method === 'get' || method === 'delete') {
    for (const [key, value] of Object.entries(stringParams)) {
      url.searchParams.set(key, value);
    }
  } else {
    requestInit.body = new URLSearchParams(stringParams);
  }

  const result = await fetch(url.toString(), requestInit);
  const responseText = await result.text();
  if (!result.ok) {
    let message = `${result.status} ${result.statusText}`;
    if (responseText) {
      try {
        const errorBody = JSON.parse(responseText) as { message?: string };
        if (typeof errorBody.message === 'string' && errorBody.message.trim()) {
          message = `${message}: ${errorBody.message}`;
        }
      } catch (e) {
        void e;
      }
    }
    throw new Error(message);
  }
  if (!responseText) {
    return [];
  }

  // Check if we have a card, list, board, or org:
  let body: unknown;
  try {
    body = JSON.parse(responseText);
  } catch (e) {
    void e;
    throw new Error(`ERROR: request did not return valid JSON for ${method.toUpperCase()} ${path}`);
  }
  try { assertTrelloOrgs(body);   return  body;  } catch(e: any) {};
  try { assertTrelloOrg(body);    return [body]; } catch(e: any) {};
  try { assertTrelloBoards(body); return  body;  } catch(e: any) {};
  try { assertTrelloBoard(body);  return [body]; } catch(e: any) {};
  try { assertTrelloLists(body);  return  body;  } catch(e: any) {};
  try { assertTrelloList(body);   return [body]; } catch(e: any) {};
  try { assertTrelloCards(body);  return  body;  } catch(e: any) {};
  try { assertTrelloCard(body);   return [body]; } catch(e: any) {};
  info('ERROR: did not return Org[], Board[], List[], or Card[],  Result was: ', body);
  throw new Error('ERROR: request did not return a valid Trello Org[], Board[], List[], or Card[]')
};

const get: TrelloRESTFunction = async (path,params) => request('get', path, params);
const put: TrelloRESTFunction = async (path,params) => request('put', path, params);
const post: TrelloRESTFunction = async (path,params) => request('post', path, params);
const del: TrelloRESTFunction = async (path,params) => request('delete', path, params);

const _client = getUniversalClient({
  waitUntilLoaded,
  authorize,
  deauthorize,
  request,
  get,
  put,
  post,
  delete: del, // delete is a reserved word
});
export function getClient() { return _client; }