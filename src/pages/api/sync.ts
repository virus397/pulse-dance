import type { NextApiRequest, NextApiResponse } from 'next';

// Global state to simulate the WebSocket server
// Note: In serverless (Vercel), this state is per-instance and may reset.
// For a prototype, this works if traffic hits the same lambda instance.
interface SyncState {
    clients: Map<string, number>; // clientId -> last seen timestamp
    encounterStartTime: number | null;
    forcedState: string | null;
}

// Use a more robust global object for Next.js dev server hot-reloading
const globalForSync = global as unknown as { 
    activeClients: Record<string, number>;
    encounterStartTime: number | null;
    forcedState: string | null;
};

if (!globalForSync.activeClients) {
    globalForSync.activeClients = {};
    globalForSync.encounterStartTime = null;
    globalForSync.forcedState = null;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { clientId, type, action } = req.body;
        const now = Date.now();

        // Handle debug force overrides
        if (type === 'FORCE_SOLO') {
            globalForSync.forcedState = 'SOLO_ACTIVE';
            return res.json({ type: 'SOLO_ACTIVE', activeCount: Object.keys(globalForSync.activeClients).length });
        } else if (type === 'FORCE_ENCOUNTER') {
            globalForSync.forcedState = 'ENCOUNTER_ACTIVE';
            return res.json({ type: 'ENCOUNTER_ACTIVE', activeCount: Object.keys(globalForSync.activeClients).length });
        }

        // Handle client explicitly leaving
        if (action === 'leave' && clientId) {
            delete globalForSync.activeClients[clientId];
        }

        // Clean up stale clients (not seen in > 10 seconds)
        for (const id in globalForSync.activeClients) {
            if (now - globalForSync.activeClients[id] > 10000) {
                delete globalForSync.activeClients[id];
            }
        }

        // Update current client timestamp if they are just pinging
        if (clientId && action !== 'leave') {
            globalForSync.activeClients[clientId] = now;
        }

        const activeCount = Object.keys(globalForSync.activeClients).length;

        // If forced state is active, return it immediately with count
        if (globalForSync.forcedState) {
            return res.json({ type: globalForSync.forcedState, activeCount });
        }

        // Normal state logic
        if (activeCount > 1) {
            // Multiple clients
            if (!globalForSync.encounterStartTime) {
                globalForSync.encounterStartTime = now;
            }

            const elapsed = now - globalForSync.encounterStartTime;
            if (elapsed >= 15000) {
                return res.json({ type: 'PROXIMITY_SUSTAINED', activeCount });
            } else {
                return res.json({ type: 'ENCOUNTER_ACTIVE', activeCount });
            }
        } else {
            // Solo
            globalForSync.encounterStartTime = null;
            return res.json({ type: 'SOLO_ACTIVE', activeCount });
        }
    } catch (err) {
        console.error('API Sync Error:', err);
        return res.status(500).json({ type: 'SOLO_ACTIVE', activeCount: 0 });
    }
}
