export interface MaintenanceFlag {
  feature: string;
  reason: string;
  since: number; // timestamp
}

class Store {
  private flags: Map<string, MaintenanceFlag> = new Map();

  set(feature: string, reason: string) {
    this.flags.set(feature, { feature, reason, since: Date.now() });
  }

  clear(feature: string) {
    this.flags.delete(feature);
  }

  getAll(): MaintenanceFlag[] {
    return Array.from(this.flags.values());
  }
}

// globalThis singleton — same reasoning as lib/api/live-store.ts: pins one
// shared store per process so the admin toggle and the SSE/status readers
// never see different instances.
// NOTE: in-memory only. A flag set here does NOT survive a Render redeploy
// or restart — fine for "I'm actively debugging right now," not for a
// maintenance window you want to outlive a deploy.
const STORE_KEY = Symbol.for('tega.maintenance-store');
type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Store };

const g = globalThis as GlobalWithStore;
if (!g[STORE_KEY]) {
  g[STORE_KEY] = new Store();
}

export const MaintenanceStore: Store = g[STORE_KEY]!;
