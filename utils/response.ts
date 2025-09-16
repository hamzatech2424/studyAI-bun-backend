// utils/response.ts - Response utilities for Hono
import type { Context } from 'hono';

export function successResponseHelper(c: Context, data: unknown) {
  return c.json({
    success: true,
    data,
  });
}

export function errorResponseHelper(c: Context, error: unknown, code: number = 400) {
  console.log("@errorResponseLog", error);
  
  const errorMessage = error instanceof Error ? error.message : "Bad Request";
  
  return c.json({
    success: false,
    error: {
      code,
      message: errorMessage || "Bad Request",
      description: errorMessage || "Bad Request",
    },
  });
}

export function serverErrorHelper(c: Context, error: unknown, code: number = 500) {
  console.log("@ServerErrorLog:", error);
  
  const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
  
  return c.json({
    success: false,
    error: {
      code,
      message: "Internal Server Error",
      description: errorMessage,
    },
  });
}

