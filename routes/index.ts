import { Hono } from 'hono';
import {
  getApiStatus,
  getApiNotFound
} from './api';
import {
  syncUser,
} from './users';
import { clerkMiddleware } from '@hono/clerk-auth';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { authorization } from '../middleware/auth';
import { queryOnDocument, uploadDocument } from './chat';

const app = new Hono();

// Middlewares
app.use('/api/*', clerkMiddleware({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY
}))
app.use('*', logger());
app.use('*', cors());

app.get('/api/status', getApiStatus);
app.post('/api/user/sync', authorization, syncUser);
app.post('/api/document/upload', uploadDocument);
app.post('/api/document/query', queryOnDocument);

// API wildcard fallback (must come last)
app.get('/api/*', getApiNotFound);

// Root route
app.get('/', (c) => {
  return c.json({
    success: true,
    data: {
      message: "API Server",
      version: "1.0.0",
      endpoints: {
        users: "/users",
        status: "/api/status"
      }
    }
  });
});

export { app as routes };