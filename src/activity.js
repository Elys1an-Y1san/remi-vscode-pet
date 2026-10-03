'use strict';

const STATES = new Set(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']);
const TASK_STATES = new Set(['running', 'waiting', 'review', 'failed']);

class Activities {
  constructor(changed = () => {}) { this.items = new Map(); this.actions = new Map(); this.changed = changed; }
  update(id, value, actions = {}) {
    if (typeof id !== 'string' || !id || !value || !TASK_STATES.has(value.state)) throw new TypeError('Invalid activity');
    const old = this.items.get(id);
    this.items.set(id, { id, title: String(value.title || '任务').slice(0, 160), body: String(value.body || '').slice(0, 400), state: value.state, updated: Date.now(), actions: Object.keys(actions).filter(k => ['open', 'cancel', 'approve', 'deny'].includes(k)) });
    this.actions.set(id, Object.fromEntries(Object.entries(actions).filter(([key, fn]) => ['open', 'cancel', 'approve', 'deny'].includes(key) && typeof fn === 'function')));
    // Never evict active tasks or a pending approval. Bound completed history only.
    const finished = [...this.items.values()].filter(x => !['running', 'waiting'].includes(x.state)).sort((a,b) => b.updated-a.updated);
    for (const item of finished.slice(20)) { this.items.delete(item.id); this.actions.delete(item.id); }
    this.changed(); return old;
  }
  dismiss(id) { const item = this.items.get(id); if (!item || ['running', 'waiting'].includes(item.state)) return false; this.items.delete(id); this.actions.delete(id); this.changed(); return true; }
  remove(id) { this.items.delete(id); this.actions.delete(id); this.changed(); }
  async act(id, action) { const fn = this.actions.get(id)?.[action]; if (typeof fn === 'function') await fn(); }
  snapshot() {
    const items = [...this.items.values()].sort((a,b) => b.updated-a.updated);
    const state = ['waiting', 'failed', 'running', 'review'].find(s => items.some(i => i.state === s)) || 'idle';
    return { state, items };
  }
}
module.exports = { Activities, STATES };
