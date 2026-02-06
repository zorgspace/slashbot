export interface FetchAction {
  type: 'fetch';
  url: string;
  prompt?: string;
}

export interface SearchAction {
  type: 'search';
  query: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
}
