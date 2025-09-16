// routes/api.ts - General API routes
import { successResponseHelper, errorResponseHelper } from '../utils/response';

// API status
const getApiStatus = (c: any) => {
  return successResponseHelper(c, { 
    status: "ok", 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
};

// Wildcard fallback for unmatched API routes
const getApiNotFound = (c: any) => {
  return errorResponseHelper(c, "The requested API resource was not found", 404);
};


export { getApiStatus, getApiNotFound };