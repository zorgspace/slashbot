export interface SayAction {
  type: 'say';
  message: string;
  target?: string;
}

export interface EndAction {
  type: 'end';
  message: string;
}

export interface ContinueAction {
  type: 'continue';
}
