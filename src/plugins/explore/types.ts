export interface ExploreAction {
  type: 'explore';
  query: string;
  path?: string;
  depth?: 'quick' | 'medium' | 'deep' | 'comprehensive';
}
