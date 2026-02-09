export interface SkillAction {
  type: 'skill';
  name: string;
  args?: string;
}

export interface SkillInstallAction {
  type: 'skill-install';
  url: string;
  name?: string;
}
