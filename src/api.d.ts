export interface Activity {
  title: string;
  body?: string;
  state: 'running' | 'waiting' | 'review' | 'failed';
}
export interface RemiAPI {
  version: 1;
  updateActivity(id: string, value: Activity, actions?: Partial<Record<'open'|'cancel'|'approve'|'deny', () => void | Promise<void>>>): void;
  removeActivity(id: string): void;
  requestApproval(id: string, title: string, body: string): Promise<boolean>;
  animate(state: 'idle'|'running-right'|'running-left'|'waving'|'jumping'|'failed'|'waiting'|'running'|'review'): void;
  inspect(): {ready: boolean; visible: boolean; state: string; items: Activity[]};
}
