// server.ts - Main server file with Hono
import { routes } from './routes';
import connectToDatabase from './helper/databaseConnection';

// Use the single Hono instance from routes
const app = routes;
// Global error handler
app.onError((err, c) => {
  console.log('🔥 Server Error:', err);

  return c.json({
    success: false,
    error: {
      code: 500,
      message: "Internal Server Error",
      description: process.env.NODE_ENV !== "production" ? err.message : "Internal Server Error",
    },
  }, 200);
});

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 404,
      message: "Not Found",
      description: "The requested resource was not found",
    },
  }, 200);
});

// Initialize database connection before starting server
async function initializeDatabaseConnection() {
  try {
    await connectToDatabase();
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
  }
}

// Initialize the server
initializeDatabaseConnection();

export default {
  port: Number(process.env.PORT || 3000),
  development: process.env.NODE_ENV !== "production",
  fetch: app.fetch,
};
