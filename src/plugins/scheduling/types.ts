export interface ScheduleAction {
  type: 'schedule';
  cron: string;
  name: string;
  command?: string;
  prompt?: string;
}

export interface NotifyAction {
  type: 'notify';
  message: string;
  target?: string;
}
