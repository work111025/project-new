// file: src/key-pool.js
const fs = require('fs');
const path = require('path');

const KEY_LOCK_DURATION = 2 * 60 * 1000; // 2 minutes
const KEY_ERROR_COOLDOWN = 5 * 60 * 1000; // 5 minutes

class KeyPoolManager {
    constructor() {
        this.keys = new Map();
        this.loadKeys();
    }

    loadKeys() {
        try {
            const keysPath = path.join(__dirname, '..', 'gemini-keys.json');
            if (fs.existsSync(keysPath)) {
                const { keys } = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
                if (Array.isArray(keys)) {
                    keys.forEach(key => {
                        if (key && !this.keys.has(key)) {
                            this.keys.set(key, {
                                status: 'available', // available, in_use, error
                                user: null,
                                lastUsed: 0,
                                errorSince: 0,
                            });
                        }
                    });
                    console.log(`KeyPoolManager: Loaded ${this.keys.size} API keys.`);
                }
            } else {
                console.error("KeyPoolManager: `gemini-keys.json` not found. The application will not be able to process requests.");
            }
        } catch (error) {
            console.error('KeyPoolManager: Error loading keys from `gemini-keys.json`:', error);
        }
    }

    getKeyForUser(userId) {
        const now = Date.now();
        let availableKey = null;

        // 1. Check if user already has an active key
        for (const [key, state] of this.keys.entries()) {
            if (state.user === userId && state.status === 'in_use') {
                state.lastUsed = now;
                return key;
            }
        }

        // 2. Find an available key
        for (const [key, state] of this.keys.entries()) {
            const isStale = now - state.lastUsed > KEY_LOCK_DURATION;
            const isErrorExpired = now - state.errorSince > KEY_ERROR_COOLDOWN;

            if (state.status === 'available' || (state.status === 'in_use' && isStale) || (state.status === 'error' && isErrorExpired)) {
                availableKey = key;
                break;
            }
        }

        // 3. Assign the available key
        if (availableKey) {
            const state = this.keys.get(availableKey);
            state.status = 'in_use';
            state.user = userId;
            state.lastUsed = now;
            state.errorSince = 0; // Clear previous error state
            return availableKey;
        }

        // 4. No keys available
        return null;
    }

    reportError(apiKey) {
        if (this.keys.has(apiKey)) {
            const state = this.keys.get(apiKey);
            state.status = 'error';
            state.user = null;
            state.errorSince = Date.now();
            console.warn(`KeyPoolManager: Key ending in ...${apiKey.slice(-4)} reported as faulty.`);
        }
    }
}

// Export a singleton instance
module.exports = new KeyPoolManager();