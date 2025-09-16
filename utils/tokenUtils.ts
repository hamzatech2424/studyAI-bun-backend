// utils/tokenUtils.ts - Clerk token utilities
import clerkClient from '../helper/clerkClient';

// Token validation result interface
export interface TokenValidationResult {
  isValid: boolean;
  userId?: string;
  sessionId?: string;
  session?: any;
  user?: any;
  error?: string;
  tokenInfo?: {
    type: string;
    issuer: string;
    audience: string;
    expiresAt?: Date;
    issuedAt?: Date;
  };
}

// Validate a Clerk token and extract information
export const validateToken = async (token: string): Promise<TokenValidationResult> => {
  try {
    console.log('Validating token:', token.substring(0, 20) + '...');

    // Try to verify the token with Clerk
    const verifiedToken = await clerkClient.verifyToken(token);
    
    if (!verifiedToken) {
      return {
        isValid: false,
        error: 'Token verification failed'
      };
    }

    // Extract token information
    const tokenInfo = {
      type: verifiedToken.type || 'unknown',
      issuer: verifiedToken.iss || 'unknown',
      audience: verifiedToken.aud || 'unknown',
      expiresAt: verifiedToken.exp ? new Date(verifiedToken.exp * 1000) : undefined,
      issuedAt: verifiedToken.iat ? new Date(verifiedToken.iat * 1000) : undefined
    };

    // Get session information if available
    let session = null;
    let sessionId = null;
    let userId = null;
    let user = null;

    if (verifiedToken.sub) {
      userId = verifiedToken.sub;
      
      // Try to get user data
      try {
        user = await clerkClient.users.getUser(userId);
      } catch (error) {
        console.log('Could not fetch user data:', error);
      }

      // Try to get session data if session ID is available
      if (verifiedToken.sid) {
        sessionId = verifiedToken.sid;
        try {
          session = await clerkClient.sessions.getSession(sessionId);
        } catch (error) {
          console.log('Could not fetch session data:', error);
        }
      }
    }

    return {
      isValid: true,
      userId,
      sessionId,
      session,
      user,
      tokenInfo
    };

  } catch (error) {
    console.error('Token validation error:', error);
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

// Extract basic token information without full validation
export const extractTokenInfo = (token: string) => {
  try {
    // JWT tokens have 3 parts separated by dots
    const parts = token.split('.');
    
    if (parts.length !== 3) {
      return {
        isValid: false,
        error: 'Invalid token format'
      };
    }

    // Decode the payload (second part)
    const payload = JSON.parse(atob(parts[1]));
    
    return {
      isValid: true,
      userId: payload.sub,
      sessionId: payload.sid,
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
      issuedAt: payload.iat ? new Date(payload.iat * 1000) : null,
      issuer: payload.iss,
      audience: payload.aud,
      type: payload.type || 'unknown'
    };
  } catch (error) {
    return {
      isValid: false,
      error: 'Could not decode token'
    };
  }
};

// Check if token is expired
export const isTokenExpired = (token: string): boolean => {
  const tokenInfo = extractTokenInfo(token);
  
  if (!tokenInfo.isValid || !tokenInfo.expiresAt) {
    return true;
  }
  
  return new Date() > tokenInfo.expiresAt;
};

// Get token age in minutes
export const getTokenAge = (token: string): number | null => {
  const tokenInfo = extractTokenInfo(token);
  
  if (!tokenInfo.isValid || !tokenInfo.issuedAt) {
    return null;
  }
  
  const now = new Date();
  const ageMs = now.getTime() - tokenInfo.issuedAt.getTime();
  return Math.floor(ageMs / (1000 * 60)); // Convert to minutes
};

// Get time until token expires in minutes
export const getTimeUntilExpiry = (token: string): number | null => {
  const tokenInfo = extractTokenInfo(token);
  
  if (!tokenInfo.isValid || !tokenInfo.expiresAt) {
    return null;
  }
  
  const now = new Date();
  const timeUntilExpiry = tokenInfo.expiresAt.getTime() - now.getTime();
  return Math.floor(timeUntilExpiry / (1000 * 60)); // Convert to minutes
};

// Validate token and get session
export const validateTokenAndGetSession = async (token: string, sessionId?: string) => {
  const validation = await validateToken(token);
  
  if (!validation.isValid) {
    return validation;
  }

  // If sessionId is provided, verify it matches the token
  if (sessionId && validation.sessionId !== sessionId) {
    return {
      isValid: false,
      error: 'Session ID does not match token'
    };
  }

  return validation;
};
