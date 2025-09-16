// types/hono.d.ts - Hono context variable types
import type { ContextVariableMap } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    clerkUser: {
      userId: string;
      sessionId: string;
      token?: string;
      userData?: any;
    } | undefined;
  }
}
