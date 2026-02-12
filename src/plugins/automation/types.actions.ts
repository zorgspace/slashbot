export interface AutomationStatusAction {
  type: 'automation-status';
}

export interface AutomationListAction {
  type: 'automation-list';
}

export interface AutomationAddCronAction {
  type: 'automation-add-cron';
  name: string;
  expression: string;
  prompt: string;
  source?: string;
  targetId?: string;
}

export interface AutomationAddWebhookAction {
  type: 'automation-add-webhook';
  name: string;
  webhookName: string;
  prompt: string;
  secret?: string;
  source?: string;
  targetId?: string;
}

export interface AutomationRunAction {
  type: 'automation-run';
  selector: string;
}

export interface AutomationRemoveAction {
  type: 'automation-remove';
  selector: string;
}

export interface AutomationSetEnabledAction {
  type: 'automation-set-enabled';
  selector: string;
  enabled: boolean;
}

export type AutomationAction =
  | AutomationStatusAction
  | AutomationListAction
  | AutomationAddCronAction
  | AutomationAddWebhookAction
  | AutomationRunAction
  | AutomationRemoveAction
  | AutomationSetEnabledAction;
