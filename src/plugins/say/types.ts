export interface SayAction {
  type: 'say';
  message: string;
  target?: string;
}

export interface ContinueAction {
  type: 'continue';
}
