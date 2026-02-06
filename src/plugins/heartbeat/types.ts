export interface HeartbeatAction {
  type: 'heartbeat';
  prompt?: string;
}

export interface HeartbeatUpdateAction {
  type: 'heartbeat-update';
  content: string;
}
