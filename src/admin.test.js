// file: src/admin.test.js
const request = require('supertest');
const app = require('./index');
const fs = require('fs');
const path = require('path');

const ADMIN_KEY = 'test-admin-key';
process.env.ADMIN_KEY = ADMIN_KEY;

describe('Admin API Endpoints', () => {
    beforeAll(() => {
        // Ensure no test db file exists before starting
        const dbPath = path.join(__dirname, '..', 'test-db.json');
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
    });

    afterAll(() => {
        const dbPath = path.join(__dirname, '..', 'test-db.json');
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
    });

    describe('POST /admin/api/keys', () => {
        it('should return 401 without an admin key', async () => {
            const res = await request(app).post('/admin/api/keys');
            expect(res.statusCode).toEqual(401);
        });

        it('should return 401 with an invalid admin key', async () => {
            const res = await request(app)
                .post('/admin/api/keys')
                .set('X-Admin-Key', 'wrong-key');
            expect(res.statusCode).toEqual(401);
        });

        it('should create a new key with a valid admin key', async () => {
            const res = await request(app)
                .post('/admin/api/keys')
                .set('X-Admin-Key', ADMIN_KEY);
            expect(res.statusCode).toEqual(201);
            expect(res.body).toHaveProperty('key');
            expect(res.body.key).toMatch(/^sk-/);
        });
    });

    describe('GET /admin/api/keys', () => {
        it('should return 401 without an admin key', async () => {
            const res = await request(app).get('/admin/api/keys');
            expect(res.statusCode).toEqual(401);
        });

        it('should return a list of keys with a valid admin key', async () => {
            const res = await request(app)
                .get('/admin/api/keys')
                .set('X-Admin-Key', ADMIN_KEY);
            expect(res.statusCode).toEqual(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThan(0);
            expect(res.body[0]).not.toHaveProperty('keyHash');
            expect(res.body[0]).toHaveProperty('requestCount');
        });
    });
});