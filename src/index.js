const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
let appInsights = require('applicationinsights');

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
dotenv.config({ path: envFile });

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
});

const db = admin.firestore();
const app = express();

appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
  .setAutoCollectRequests(true)
  .setAutoCollectPerformance(true, true)
  .setAutoCollectExceptions(true)
  .setAutoCollectDependencies(true)
  .setAutoCollectConsole(true, false)
  .setAutoCollectPreAggregatedMetrics(true)
  .setSendLiveMetrics(false)
  .setInternalLogging(false, true)
  .enableWebInstrumentation(false)
  .start();

const telemetryClient = appInsights.defaultClient;

// Middleware
app.use(cors());
app.use(express.json());

// Get all tasks
app.get('/tasks', async (req, res) => {
  try {
    const tasksSnapshot = await db.collection('tasks').orderBy('createdAt', 'desc').get();
    const tasks = [];
    
    tasksSnapshot.forEach(doc => {
      tasks.push({
        id: doc.id,
        ...doc.data()
      });
    });
    telemetryClient.trackEvent({ name: 'GetTasksSuccess', properties: { count: tasks.length } });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a task
app.post('/tasks', async (req, res) => {
  try {
    const { id, title } = req.body;
    
    const taskRef = db.collection('tasks').doc();
    const task = {
      id: id ?? taskRef.id,
      title,
      completed: false,
      createdAt: new Date().toISOString()
    };
    
    await taskRef.set(task);

    telemetryClient.trackEvent({ name: 'TaskCreated', properties: { id: task.id, title: task.title } });
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a task
app.patch('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const taskRef = db.collection('tasks').doc(id);
    const task = await taskRef.get();
    
    if (!task.exists) {
      telemetryClient.trackEvent({ name: 'TaskUpdateNotFound', properties: { id } });
      return res.status(404).json({ error: 'Task not found' });
    }
    
    await taskRef.update(updates);
    
    const updatedTask = await taskRef.get();
    telemetryClient.trackEvent({ name: 'TaskUpdated', properties: { id: updatedTask.id } });
    res.json({
      id: updatedTask.id,
      ...updatedTask.data()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a task
app.delete('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const taskRef = db.collection('tasks').doc(id);
    const task = await taskRef.get();
    
    if (!task.exists) {
      telemetryClient.trackEvent({ name: 'TaskDeleteNotFound', properties: { id } });
      return res.status(404).json({ error: 'Task not found' });
    }
    
    await taskRef.delete();

    telemetryClient.trackEvent({ name: 'TaskDeleted', properties: { id } });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server };