import type { NextApiRequest, NextApiResponse } from 'next';

// Global state to simulate the WebSocket server
// Note: In serverless (Vercel), this state is per-instance and may reset.
// For a prototype, this works if traffic hits the same lambda instance.
interface SyncState {
    clients: Map<string, number>; // clientId -> last seen timestamp
    encounterStartTime: number | null;
    forcedState: string | null;
}

const globalState = globalThis as unknown as { __syncState: SyncState };
if (!globalState.__syncState) {
    globalState.__syncState = {
        clients: new Map(),
        encounterStartTime: null,
        forcedState: null
    };
}

const state = globalState.__syncState;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { clientId, type } = req.body;
        const now = Date.now();

        // Handle debug force overrides
        if (type === 'FORCE_SOLO') {
            state.forcedState = 'SOLO_ACTIVE';
            return res.json({ type: 'SOLO_ACTIVE' });
        } else if (type === 'FORCE_ENCOUNTER') {
            state.forcedState = 'ENCOUNTER_ACTIVE';
            return res.json({ type: 'ENCOUNTER_ACTIVE' });
        }

        // Clean up stale clients (not seen in > 5 seconds)
        for (const [id, lastSeen] of state.clients.entries()) {
            if (now - lastSeen > 5000) {
                state.clients.delete(id);
            }
        }

        // Update current client
        if (clientId) {
            state.clients.set(clientId, now);
        }

        // If forced state is active, return it
        if (state.forcedState) {
            return res.json({ type: state.forcedState });
        }

        const activeCount = state.clients.size;

        if (activeCount > 1) {
            // Multiple clients
            if (!state.encounterStartTime) {
                state.encounterStartTime = now;
            }

            const elapsed = now - state.encounterStartTime;
            if (elapsed >= 15000) {
                return res.json({ type: 'PROXIMITY_SUSTAINED' });
            } else {
                return res.json({ type: 'ENCOUNTER_ACTIVE' });
            }
        } else {
            // Solo
            state.encounterStartTime = null;
            return res.json({ type: 'SOLO_ACTIVE' });
        }
    } catch (err) {
        return res.status(500).json({ type: 'SOLO_ACTIVE' });
    }
}
