// file: src/index.js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./db');
const keyPool = require('./key-pool');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

// --- Application Constants & Setup ---
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.error("FATAL ERROR: ADMIN_KEY is not defined.");
  process.exit(1);
}

// A new, single prompt that instructs the model to perform both OCR and selection.
const COMBINED_KOREAN_SELECTION_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'korean-sentence-prompt.txt'), 'utf-8');


const app = express();
const appCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));
app.set('trust proxy', 1);

const apiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this key, please try again after an hour' },
  keyGenerator: (req) => req.body.key || req.headers['x-access-key'],
  standardHeaders: true,
  legacyHeaders: false,
});

const adminAuthMiddleware = (req, res, next) => {
  const providedAdminKey = req.headers['x-admin-key'];
  if (providedAdminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid admin key.' });
  }
  next();
};

const userAuthMiddleware = async (req, res, next) => {
  const providedKey = req.body.key || req.headers['x-access-key'];
  if (!providedKey) {
    return res.status(401).json({ error: 'Unauthorized: Access key is required.' });
  }
  try {
    const keyData = await db.findAndValidateKey(providedKey);
    if (!keyData) {
        return res.status(401).json({ error: 'Unauthorized: Invalid access key.' });
    }

    if (new Date() > new Date(keyData.expirationDate)) {
      return res.status(401).json({ error: 'Unauthorized: Access key has expired.' });
    }

    const LOCK_DURATION = 30 * 1000;
    const now = new Date();
    const lastUsed = keyData.lastUsedTime ? new Date(keyData.lastUsedTime) : null;
    const isLocked = lastUsed && (now - lastUsed) < LOCK_DURATION;

    if (isLocked) {
        const currentIp = req.ip;
        const currentUserAgent = req.headers['user-agent'];
        const isDifferentDevice = keyData.lastUsedIp !== currentIp || keyData.lastUsedUserAgent !== currentUserAgent;

        if (isDifferentDevice) {
            return res.status(429).json({ error: 'Another device is already logged in.' });
        }
    }

    const updatedKeyData = await db.incrementKeyUsage(keyData.keyHash, req.ip, req.headers['user-agent']);
    if (updatedKeyData) {
        appCache.set(providedKey, updatedKeyData);
    }
    
    req.keyData = updatedKeyData || keyData;
    req.providedKey = providedKey;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
};

// --- API Routes ---
app.post('/api/validate-key', userAuthMiddleware, (req, res) => {
  res.status(200).json({ success: true, message: 'Key is valid.' });
});

app.post('/api/process-image', apiRateLimiter, userAuthMiddleware, async (req, res) => {
    const apiKey = keyPool.getKeyForUser(req.providedKey);
    if (!apiKey) {
        return res.status(503).json({ error: 'All API resources are currently busy. Please try again in a few moments.' });
    }

    try {
        const { image, mimeType } = req.body;
        if (!image || !mimeType) {
            return res.status(400).json({ error: 'Image data and mimeType are required.' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        // Use a modern, fast, multimodal model. Gemini 1.5 Flash is ideal for this.
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

        const imagePart = {
            inlineData: {
                data: image,
                mimeType,
            },
        };

        // --- START: REFACTORED STREAMING IMPLEMENTATION ---
        // Combine the prompt and image into a single request.
        const streamingResult = await model.generateContentStream([COMBINED_KOREAN_SELECTION_PROMPT, imagePart]);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        // Stream each chunk directly to the client as it arrives.
        for await (const chunk of streamingResult.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
                res.write(chunkText);
            }
        }
        
        res.end(); // End the stream once the model is finished.
        // --- END: REFACTORED STREAMING IMPLEMENTATION ---

    } catch (error) {
        console.error(`Error processing image with key ...${apiKey.slice(-4)}:`, error);
        keyPool.reportError(apiKey);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to process image due to an API error. Please try again.' });
        } else {
            res.end();
        }
    }
});

// --- Admin Routes ---
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.post('/admin/api/cache/flush', adminAuthMiddleware, (req, res) => {
    try {
        const count = appCache.getStats().keys;
        appCache.flushAll();
        console.log(`Application cache flushed by admin. ${count} keys removed.`);
        res.status(200).json({ message: 'Application cache flushed successfully.' });
    } catch (error) {
        console.error('Failed to flush cache:', error);
        res.status(500).json({ error: 'Failed to flush cache.' });
    }
});

app.get('/admin/api/keys', adminAuthMiddleware, async (req, res) => {
  try {
    const keys = await db.getAllKeysForAdmin();
    res.json(keys);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve keys.' });
  }
});

app.post('/admin/api/keys', adminAuthMiddleware, async (req, res) => {
  try {
    const { name, validityDays } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Key name is required.' });
    }
    const days = parseInt(validityDays, 10);
    if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Validity must be a number between 1 and 365.' });
    }
    const { key } = await db.createKey(name.trim(), days);
    res.status(201).json({ message: 'Key created successfully.', key });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create key.' });
  }
});

app.delete('/admin/api/keys', adminAuthMiddleware, async (req, res) => {
    try {
        const { creationDate } = req.body;
        if (!creationDate) return res.status(400).json({ error: 'creationDate is required.' });
        const deleted = await db.deleteKeyByCreationDate(creationDate);
        if (deleted) {
            appCache.flushAll();
            console.log(`Key with creationDate ${creationDate} deleted. Cache flushed.`);
            res.status(200).json({ message: 'Key deleted successfully.' });
        } else {
            res.status(404).json({ error: 'Key not found.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete key.' });
    }
});

app.patch('/admin/api/keys/expiration', adminAuthMiddleware, async (req, res) => {
    try {
        const { creationDate, newExpirationDate } = req.body;
        if (!creationDate || !newExpirationDate) {
            return res.status(400).json({ error: 'creationDate and newExpirationDate are required.' });
        }
        const newDate = new Date(newExpirationDate);
        if (isNaN(newDate.getTime()) || newDate < new Date('2025-10-08T00:00:00.000Z')) {
            return res.status(400).json({ error: 'Invalid or past date provided.' });
        }
        const updated = await db.updateKeyExpiration(creationDate, newDate.toISOString());
        if (updated) res.status(200).json({ message: 'Expiration date updated successfully.' });
        else res.status(404).json({ error: 'Key not found.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update expiration date.' });
    }
});

app.patch('/admin/api/keys/name', adminAuthMiddleware, async (req, res) => {
    try {
        const { creationDate, newName } = req.body;
        if (!creationDate || !newName || typeof newName !== 'string' || newName.trim().length === 0) {
            return res.status(400).json({ error: 'creationDate and a non-empty newName are required.' });
        }
        const updated = await db.updateKeyName(creationDate, newName.trim());
        if (updated) {
            appCache.flushAll();
            res.status(200).json({ message: 'Name updated successfully.' });
        } else {
            res.status(404).json({ error: 'Key not found.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to update name.' });
    }
});

// --- Server Start ---
async function startServer() {
  await db.initDb();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Admin panel available at http://localhost:${PORT}/admin`);
    console.log(`Date: October 8, 2025`);
  });
}

// This condition prevents the server from starting when the file is imported for tests
if (require.main === module) {
  startServer();
}

module.exports = app;
