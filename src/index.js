import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import appInsights from "applicationinsights";

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env';
dotenv.config({ path: envFile });

// Configure Application Insights (only in production and development, not in tests)
let telemetryClient = null;
if (process.env.NODE_ENV !== 'test' && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true, false)
    .setAutoCollectPreAggregatedMetrics(true)
    .setSendLiveMetrics(process.env.NODE_ENV === 'production')
    .setInternalLogging(false, process.env.NODE_ENV === 'development')
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
    .enableWebInstrumentation(false)
    .start();

  telemetryClient = appInsights.defaultClient;
  telemetryClient.context.tags[telemetryClient.context.keys.cloudRole] = "taskflow-api";

  console.log('✅ Application Insights configured successfully');
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const app = express();

// Security Middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parser with size limits
app.use(express.json({ limit: '10kb' }));

// Input validation middleware
const validateTaskInput = (req, res, next) => {
  const { title } = req.body;

  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required and must be a string' });
  }

  if (title.trim().length === 0 || title.length > 500) {
    return res.status(400).json({ error: 'Title must be between 1 and 500 characters' });
  }

  // Sanitize title
  req.body.title = title.trim();
  next();
};

// Sanitize update data
const sanitizeUpdateData = (updates) => {
  const allowedFields = ['title', 'completed'];
  const sanitized = {};

  for (const key of Object.keys(updates)) {
    if (allowedFields.includes(key)) {
      if (key === 'title' && typeof updates[key] === 'string') {
        sanitized[key] = updates[key].trim().substring(0, 500);
      } else if (key === 'completed' && typeof updates[key] === 'boolean') {
        sanitized[key] = updates[key];
      }
    }
  }

  return sanitized;
};

const formatTaskData = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    title: data.title,
    completed: data.completed,
    createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt
  };
};

app.get('/tasks', async (req, res) => {
  const startTime = Date.now();
  try {
    // Pagination
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    let query = db.collection('tasks').orderBy('createdAt', 'desc');

    if (offset > 0) {
      const offsetSnapshot = await query.limit(offset).get();
      const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }
    }

    const tasksSnapshot = await query.limit(limit).get();
    const tasks = [];

    tasksSnapshot.forEach(doc => {
      tasks.push(formatTaskData(doc));
    });

    if (telemetryClient) {
      telemetryClient.trackMetric({
        name: 'tasks_fetched',
        value: tasks.length
      });
      telemetryClient.trackDependency({
        target: 'Firestore',
        name: 'GET tasks',
        data: 'collection(tasks).get()',
        duration: Date.now() - startTime,
        resultCode: 200,
        success: true,
        dependencyTypeName: 'Firestore'
      });
    }

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);

    if (telemetryClient) {
      telemetryClient.trackException({
        exception: error,
        properties: {
          operation: 'GET /tasks',
          limit,
          offset
        }
      });
    }

    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.post('/tasks', validateTaskInput, async (req, res) => {
  const startTime = Date.now();
  try {
    const { title } = req.body;

    const taskRef = db.collection('tasks').doc();
    const task = {
      id: taskRef.id,
      title,
      completed: false,
      createdAt: FieldValue.serverTimestamp()
    };

    await taskRef.set(task);

    const createdTask = await taskRef.get();

    if (telemetryClient) {
      telemetryClient.trackEvent({
        name: 'TaskCreated',
        properties: {
          taskId: createdTask.id
        }
      });
      telemetryClient.trackDependency({
        target: 'Firestore',
        name: 'CREATE task',
        data: 'collection(tasks).doc().set()',
        duration: Date.now() - startTime,
        resultCode: 201,
        success: true,
        dependencyTypeName: 'Firestore'
      });
    }

    res.status(201).json(formatTaskData(createdTask));
  } catch (error) {
    console.error('Error creating task:', error);

    if (telemetryClient) {
      telemetryClient.trackException({
        exception: error,
        properties: {
          operation: 'POST /tasks',
          title: req.body.title
        }
      });
    }

    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.patch('/tasks/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;

    // Validate ID format
    if (!id || typeof id !== 'string' || id.length > 100) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const sanitizedUpdates = sanitizeUpdateData(req.body);

    if (Object.keys(sanitizedUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const taskRef = db.collection('tasks').doc(id);
    const task = await taskRef.get();

    if (!task.exists) {
      if (telemetryClient) {
        telemetryClient.trackEvent({
          name: 'TaskNotFound',
          properties: { operation: 'UPDATE', taskId: id }
        });
      }
      return res.status(404).json({ error: 'Task not found' });
    }

    await taskRef.update(sanitizedUpdates);

    const updatedTask = await taskRef.get();

    if (telemetryClient) {
      telemetryClient.trackEvent({
        name: 'TaskUpdated',
        properties: {
          taskId: id,
          updatedFields: Object.keys(sanitizedUpdates)
        }
      });
      telemetryClient.trackDependency({
        target: 'Firestore',
        name: 'UPDATE task',
        data: `collection(tasks).doc(${id}).update()`,
        duration: Date.now() - startTime,
        resultCode: 200,
        success: true,
        dependencyTypeName: 'Firestore'
      });
    }

    res.json(formatTaskData(updatedTask));
  } catch (error) {
    console.error('Error updating task:', error);

    if (telemetryClient) {
      telemetryClient.trackException({
        exception: error,
        properties: {
          operation: 'PATCH /tasks/:id',
          taskId: req.params.id
        }
      });
    }

    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/tasks/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;

    // Validate ID format
    if (!id || typeof id !== 'string' || id.length > 100) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const taskRef = db.collection('tasks').doc(id);
    const task = await taskRef.get();

    if (!task.exists) {
      if (telemetryClient) {
        telemetryClient.trackEvent({
          name: 'TaskNotFound',
          properties: { operation: 'DELETE', taskId: id }
        });
      }
      return res.status(404).json({ error: 'Task not found' });
    }

    await taskRef.delete();

    if (telemetryClient) {
      telemetryClient.trackEvent({
        name: 'TaskDeleted',
        properties: { taskId: id }
      });
      telemetryClient.trackDependency({
        target: 'Firestore',
        name: 'DELETE task',
        data: `collection(tasks).doc(${id}).delete()`,
        duration: Date.now() - startTime,
        resultCode: 204,
        success: true,
        dependencyTypeName: 'Firestore'
      });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting task:', error);

    if (telemetryClient) {
      telemetryClient.trackException({
        exception: error,
        properties: {
          operation: 'DELETE /tasks/:id',
          taskId: req.params.id
        }
      });
    }

    res.status(500).json({ error: 'Failed to delete task' });
  }
});


app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});


app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: 'Internal server error'
  });
});

const PORT = process.env.PORT || 3000;

let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (telemetryClient) {
      telemetryClient.trackEvent({
        name: 'ServerStarted',
        properties: {
          port: PORT,
          environment: process.env.NODE_ENV || 'production'
        }
      });
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    if (telemetryClient) {
      telemetryClient.trackEvent({
        name: 'ServerShutdown',
        properties: { signal: 'SIGTERM' }
      });
      telemetryClient.flush();
    }
    server.close(() => {
      console.log('HTTP server closed');
    });
  });
}

export { app, server, telemetryClient };