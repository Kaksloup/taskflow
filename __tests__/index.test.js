import { afterAll, describe, expect, it } from '@jest/globals';
const { default: request } = await import('supertest');
const { app, server } = await import('../src/index.js');

describe('🚀 API Tasks - Tests Approfondis', () => {

    afterAll((done) => {
        if (server) {
            server.close(done);
        } else {
            done();
        }
    });

    describe('GET /tasks', () => {
        it('✅ Récupérer toutes les tâches avec succès', async () => {
            const res = await request(app).get('/tasks');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body[0].title).toBe('Mock Task');
        });
    });

    describe('POST /tasks', () => {
        it('✅ Créer une tâche avec génération d\'ID', async () => {
            const res = await request(app)
              .post('/tasks')
              .send({ title: 'Apprendre Jest' });

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body.completed).toBe(false);
        });

        it('❌ Rejeter une tâche sans title', async () => {
            const res = await request(app)
              .post('/tasks')
              .send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Title is required and must be a string');
        });

        it('❌ Rejeter un title trop long', async () => {
            const res = await request(app)
              .post('/tasks')
              .send({ title: 'a'.repeat(501) });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Title must be between 1 and 500 characters');
        });
    });

    describe('PATCH /tasks/:id', () => {
        it('✅ Modifier partiellement une tâche', async () => {
            const res = await request(app)
              .patch('/tasks/1') // ID 1 est mocké comme existant
              .send({ completed: true });

            expect(res.status).toBe(200);
            expect(res.body.completed).toBe(true);
        });

        it('❌ Retourner 404 si la tâche n’existe pas', async () => {
            const res = await request(app)
              .patch('/tasks/999') // ID 999 simulé comme inexistant
              .send({ title: 'New' });
            expect(res.status).toBe(404);
        });
    });

    describe('DELETE /tasks/:id', () => {
        it('✅ Supprimer une tâche existante', async () => {
            const res = await request(app).delete('/tasks/1');
            expect(res.status).toBe(204);
        });
    });

});