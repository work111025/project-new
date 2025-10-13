const path = require('path');
const bcrypt = require('bcrypt');

let dbInstance = null;
const SALT_ROUNDS = 10;

/**
 * Initializes the database connection.
 * This function is idempotent and can be called multiple times safely.
 */
async function initDb() {
  if (dbInstance) {
    return;
  }
  const { Low } = await import('lowdb');
  const { JSONFile } = await import('lowdb/node');

  const dbPath = process.env.NODE_ENV === 'test' ? 'test-db.json' : 'db.json';
  const adapter = new JSONFile(path.join(__dirname, '..', dbPath));
  const db = new Low(adapter, { keys: [] });

  await db.read();
  db.data = db.data || { keys: [] };
  await db.write();
  dbInstance = db;
}

/**
 * A helper to ensure the database is initialized before performing an operation.
 */
async function getDb() {
  if (!dbInstance) {
    await initDb();
  }
  return dbInstance;
}

async function createKey(name, validityDays) {
  const db = await getDb();
  const key = `sk-${Math.random().toString(36).substring(2)}`;
  const keyHash = await bcrypt.hash(key, SALT_ROUNDS);
  const creationDate = new Date();
  const expirationDate = new Date(creationDate);
  expirationDate.setDate(creationDate.getDate() + validityDays);

  const keyData = {
    name: name || 'Untitled Key',
    keyHash,
    creationDate: creationDate.toISOString(),
    expirationDate: expirationDate.toISOString(),
    requestCount: 0,
    lastUsedIp: null,
    lastUsedTime: null,
    lastUsedUserAgent: null,
  };

  if (!db.data.keys) {
    db.data.keys = [];
  }
  db.data.keys.push(keyData);
  await db.write();
  return { key };
}

async function deleteKeyByCreationDate(creationDateISO) {
    const db = await getDb();
    if (!db.data.keys) return false;
    const initialLength = db.data.keys.length;
    db.data.keys = db.data.keys.filter(k => k.creationDate !== creationDateISO);
    if (db.data.keys.length < initialLength) {
        await db.write();
        return true;
    }
    return false;
}

async function updateKeyExpiration(creationDateISO, newExpirationDateISO) {
    const db = await getDb();
    if (!db.data.keys) return false;
    const keyIndex = db.data.keys.findIndex(k => k.creationDate === creationDateISO);
    if (keyIndex !== -1) {
        db.data.keys[keyIndex].expirationDate = newExpirationDateISO;
        await db.write();
        return true;
    }
    return false;
}

async function updateKeyName(creationDateISO, newName) {
    const db = await getDb();
    if (!db.data.keys) return false;
    const keyIndex = db.data.keys.findIndex(k => k.creationDate === creationDateISO);
    if (keyIndex !== -1) {
        db.data.keys[keyIndex].name = newName;
        await db.write();
        return true;
    }
    return false;
}

async function findAndValidateKey(key) {
  const db = await getDb();
  if (!db.data.keys) return null;
  for (const keyData of db.data.keys) {
    if (await bcrypt.compare(key, keyData.keyHash)) {
      return keyData;
    }
  }
  return null;
}

async function incrementKeyUsage(keyHash, ip, userAgent) {
  const db = await getDb();
  if (!db.data.keys) return null;
  const keyIndex = db.data.keys.findIndex(k => k.keyHash === keyHash);
  if (keyIndex !== -1) {
    const keyData = db.data.keys[keyIndex];
    keyData.requestCount += 1;
    keyData.lastUsedIp = ip;
    keyData.lastUsedUserAgent = userAgent;
    keyData.lastUsedTime = new Date().toISOString();
    await db.write();
    return keyData;
  }
  return null;
}

async function getAllKeysForAdmin() {
    const db = await getDb();
    await db.read();
    if (!db.data.keys) return [];
    return db.data.keys.map(({ keyHash, ...rest }) => rest);
}

module.exports = {
  initDb,
  createKey,
  deleteKeyByCreationDate,
  updateKeyExpiration,
  updateKeyName,
  findAndValidateKey,
  incrementKeyUsage,
  getAllKeysForAdmin,
};