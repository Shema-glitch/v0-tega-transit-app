export interface LiveVehicle {
  vehicleId: string;
  routeId: string;
  clientId: string;
  lat: number;
  lng: number;
  speedKmh: number;
  lastPing: number; // timestamp
  heading?: number;
  // Broadcaster-submitted vehicle info
  plate?: string;
  occupancy?: string;
  operator?: string;
  driver?: string;
}

export interface DiagnosticStatus {
  status: 'healthy' | 'stale' | 'speed_anomaly';
  reason?: string;
  lastPingTime?: string;
}

export interface ActiveIncident {
  vehicleId: string;
  routeId: string;
  clientId: string;
  incidentType: string;
  lat: number;
  lng: number;
  destinationStopId?: string;
  reportedAt: number;
}

class Store {
  private vehicles: Map<string, LiveVehicle> = new Map();
  private incidents: Map<string, ActiveIncident> = new Map();
  private viewers: Map<string, Set<string>> = new Map(); // routeId → Set of clientId

  ingest(ping: Omit<LiveVehicle, 'lastPing'>) {
    this.vehicles.set(ping.vehicleId, {
      ...ping,
      lastPing: Date.now()
    });
  }

  // Viewer tracking: a client is "viewing" a route when their SSE is connected
  addViewer(routeId: string, clientId: string) {
    if (!this.viewers.has(routeId)) {
      this.viewers.set(routeId, new Set());
    }
    this.viewers.get(routeId)!.add(clientId);
  }

  removeViewer(routeId: string, clientId: string) {
    const set = this.viewers.get(routeId);
    if (set) {
      set.delete(clientId);
      if (set.size === 0) this.viewers.delete(routeId);
    }
  }

  getViewerCount(routeId: string): number {
    return this.viewers.get(routeId)?.size || 0;
  }

  getAllViewerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [routeId, set] of this.viewers.entries()) {
      counts[routeId] = set.size;
    }
    return counts;
  }

  getVehicles(): LiveVehicle[] {
    this.cleanup(); // Clean before returning
    return Array.from(this.vehicles.values());
  }

  reportIncident(incident: Omit<ActiveIncident, 'reportedAt'>) {
    this.incidents.set(incident.vehicleId, {
      ...incident,
      reportedAt: Date.now()
    });
  }

  getIncidents(): ActiveIncident[] {
    this.cleanup();
    return Array.from(this.incidents.values());
  }

  getDiagnostics(): Record<string, DiagnosticStatus> {
    const now = Date.now();
    const diags: Record<string, DiagnosticStatus> = {};
    
    this.vehicles.forEach(v => {
      const ageMs = now - v.lastPing;
      if (ageMs > 120_000) { // 2 minutes stale
        diags[v.vehicleId] = { status: 'stale', reason: `No ping in ${Math.round(ageMs/1000)} seconds`, lastPingTime: new Date(v.lastPing).toISOString() };
      } else if (v.speedKmh > 120) {
        diags[v.vehicleId] = { status: 'speed_anomaly', reason: `Impossible speed: ${v.speedKmh} km/h`, lastPingTime: new Date(v.lastPing).toISOString() };
      } else {
        diags[v.vehicleId] = { status: 'healthy', lastPingTime: new Date(v.lastPing).toISOString() };
      }
    });
    return diags;
  }
  
  cleanup() {
    const now = Date.now();
    for (const [id, v] of this.vehicles.entries()) {
      if (now - v.lastPing > 300_000) { // 5 minutes completely dead, remove from store
        this.vehicles.delete(id);
      }
    }
    for (const [id, inc] of this.incidents.entries()) {
      if (now - inc.reportedAt > 900_000) { // 15 minutes expiry for incidents
        this.incidents.delete(id);
      }
    }
  }
}

export const LiveVehicleStore = new Store();
