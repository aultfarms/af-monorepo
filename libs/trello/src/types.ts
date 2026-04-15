
export type TrelloAuthorizeParams = {
  type: 'redirect',
  name: string,
  persist: true,
  scope: { read?: 'true' | 'false', write?: 'true' | 'false' },
  expiration: string | 'never',
  success: () => void,
  error: (err: any) => void,
};

export type TrelloRequestParams = {
  fields?: string, // name, id, closed, cards
  name?: string, // for posting new lists/boards/etc.
  idList?: string, // for posting or updating cards
  desc?: string, // for posting new cards only
  closed?: boolean, // for archiving cards
  pos?: "top" | "bottom" | number, // to position new cards
};

export type TrelloLabel = {
  // there are other things in labels, but the color is all I care about
  color: string,
};

export type TrelloCard = {
  id: string,
  idList: string,
  name: string,
  closed: boolean,
  dateLastActivity: string,
  desc: string,
  idBoard: string,
  labels: string[],
  pos: number,
};
export function assertTrelloCard(o: any): asserts o is TrelloCard {
  if (!o) throw new Error('Card cannot be falsey');
  if (typeof o !== 'object') throw new Error('Card must be an object');
  if (typeof o.id !== 'string') throw new Error('Card must have id');
  if (typeof o.name !== 'string') throw new Error('Card must have name');
  if (typeof o.idBoard !== 'string') throw new Error('Card must have idBoard');
  if (typeof o.pos !== 'number') throw new Error('Card must have pos as a number');
  if (typeof o.closed !== 'boolean') throw new Error('Card must have closed as boolean');
  if (typeof o.dateLastActivity !== 'string') throw new Error('Card must have dateLastActivity');
  if (typeof o.desc !== 'string') throw new Error('Card must have desc');
  if (!Array.isArray(o.labels)) throw new Error('Card must have array of labels, even if empty');
  for(const [index, l] of (o.labels as string[]).entries()) {
    if (typeof l !== 'object') throw new Error(`Label ${index} is not an object, it is ${JSON.stringify(l)}`);
    if (typeof l['color'] !== 'string') throw new Error(`Label ${index} does not have a color key that is a string`);
  }
}
export function assertTrelloCards(o: any): asserts o is TrelloCard[] {
  if (!o) throw new Error('Card list cannot be falsey');
  if (!Array.isArray(o)) throw new Error('Card list must be an array');
  for (const i of (o as any[])) {
    assertTrelloCard(i);
  }
}



export type TrelloList = {
  id: string,
  idBoard: string,
  pos?: number,
  name: string,
  cards?: TrelloCard[],
};
export function assertTrelloList(o: any): asserts o is TrelloList {
  if (!o) throw new Error('List cannot be falsey');
  if (typeof o !== 'object') throw new Error('List must be an object');
  if (typeof o.id !== 'string') throw new Error('List must have id');
  if (typeof o.name !== 'string') throw new Error('List must have name');
  if (typeof o.idBoard !== 'string') throw new Error('List must have idBoard');
  if ('pos' in o && typeof o.pos !== 'number') throw new Error('pos of list must be a number if it is there');
  if ('cards' in o) {
    if (!o.cards) throw new Error('Cards should exist on list, even if list of cards is empty');
    if (!Array.isArray(o.cards)) throw new Error('Cards list must be an array');
    for (const c of (o.cards as any[])) {
      assertTrelloCard(c);
    }
  }
}
export function assertTrelloLists(o: any): asserts o is TrelloList[] {
  if (!o) throw new Error('Lists array cannot be falsey');
  if (!Array.isArray(o)) throw new Error('Lists array must be an array');
  for (const i of (o as TrelloList[])) {
    assertTrelloList(i);
  }
}



export type TrelloBoard = {
  id: string,
  name: string,
};
export function assertTrelloBoard(o: any): asserts o is TrelloBoard {
  if (!o) throw new Error('Board cannot be falsey');
  if (typeof o !== 'object') throw new Error('Board must be an object');
  if (typeof o.id !== 'string') throw new Error('Board must have id');
  if (typeof o.name !== 'string') throw new Error('Board must have name');
}
export function assertTrelloBoards(o: any): asserts o is TrelloBoard[] {
  if (!o) throw new Error('Board list cannot be falsey');
  if (!Array.isArray(o)) throw new Error('Board list must be an array');
  for (const i of (o as any[])) {
    assertTrelloBoard(i);
  }
}


export type TrelloOrg = {
  id: string,
  name: string,
  displayName: string,
};
export function assertTrelloOrg(o: any): asserts o is TrelloOrg {
  if (!o) throw new Error('Org cannot be falsey');
  if (typeof o !== 'object') throw new Error('Org must be an object');
  if (typeof o.id !== 'string') throw new Error('Org must have id');
  if (typeof o.name !== 'string') throw new Error('Org must have name');
}
export function assertTrelloOrgs(o: any): asserts o is TrelloOrg[] {
  if (!o) throw new Error('Org list cannot be falsey');
  if (!Array.isArray(o)) throw new Error('Org list must be an array');
  for (const i of (o as any[])) {
    assertTrelloOrg(i);
  }
}


export type TrelloRequestResponse = TrelloCard[] | TrelloList [] | TrelloBoard[];

export type TrelloSuccessCallback = (response: TrelloRequestResponse) => any;
export type TrelloRejectCallback = (err: any) => void;
export type TrelloRESTFunction = 
  (path: string, params: TrelloRequestParams) 
  => Promise<TrelloRequestResponse>;

export type TrelloRequestFunction = (
  method: 'get' | 'put' | 'post' | 'delete', 
  path: string, 
  params: TrelloRequestParams
) => Promise<TrelloRequestResponse>;

export type PlatformSpecificTrelloLib = {
  waitUntilLoaded: () => Promise<void>,
  authorize: () => Promise<void>,
  deauthorize: () => Promise<void>,
  request: TrelloRequestFunction,
  get: TrelloRESTFunction,
  put: TrelloRESTFunction,
  post: TrelloRESTFunction,
  delete: TrelloRESTFunction,
};
