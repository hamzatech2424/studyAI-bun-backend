import type { Context, Next } from 'hono';
import clerkClient from '../helper/clerkClient';
import { getAuth } from '@hono/clerk-auth'

export const authorization = async (c: Context, next: Next) => {
  try {
    const auth = getAuth(c);
    console.log("🔍 Auth object:", auth);
    console.log("🔍 Is authenticated:", auth?.isAuthenticated);
    console.log("🔍 User ID:", auth?.userId);

    if (!auth?.userId) {
      return c.json({
        success: false,
        error: "Unauthorized",
        message: "No valid session token found. Please send a valid Authorization header with Bearer token."
      }, 401);
    }

    const clerkUserData = await clerkClient.users.getUser(auth.userId);

    c.set('clerkUser', {
      userId: auth.userId,
      sessionId: auth.sessionId,
      token: (await auth.getToken()) || undefined,
      userData: clerkUserData
    });

    console.log('✅ Authorization successful for user:', auth.userId);
    await next();
  } catch (error) {
    console.error('❌ Authorization error:', error);
    return c.json({
      success: false,
      error: "Authorization failed",
      message: error instanceof Error ? error.message : "Invalid authentication data"
    }, 401);
  }
}; 