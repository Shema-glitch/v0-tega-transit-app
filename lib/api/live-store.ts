export interface LiveVehicle {
  vehicleId: string;
  routeId: string;
  clientId: string;
  lat: number;
  lng: number;
  speedKmh: number;
  lastPing: number; // timestamp
  heading?: number;
}

export interface DiagnosticStatus {
  status: 'healthy' | 'stale' | 'speed_anomaly';
  reason?: string;
  lastPingTime?: string;
}

class Store {
  private vehicles: Map<string, LiveVehicle> = new Map();

  ingest(ping: Omit<LiveVehicle, 'lastPing'>) {
    this.vehicles.set(ping.vehicleId, {
      ...ping,
      lastPing: Date.now()
    });
  }

  getVehicles(): LiveVehicle[] {
    this.cleanup(); // Clean before returning
    return Array.from(this.vehicles.values());
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
  }
}

export const LiveVehicleStore = new Store();
