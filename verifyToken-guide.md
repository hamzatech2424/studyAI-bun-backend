# How to Use Clerk's verifyToken Function

## Overview

The `verifyToken` function from `@clerk/backend` is a standalone function that allows you to verify and decode Clerk JWT tokens. It's the most direct way to validate tokens and extract information from them.

## Basic Usage

```typescript
import { verifyToken } from '@clerk/backend';

const payload = await verifyToken(token, {
  secretKey: process.env.CLERK_SECRET_KEY!
});
```

## Function Signature

```typescript
verifyToken(token: string, options: VerifyTokenOptions): Promise<JwtPayload>
```

### Parameters:
- **token**: The JWT token string to verify
- **options**: Configuration object with the following properties:
  - **secretKey** (required): Your Clerk secret key
  - **audience** (optional): Expected audience claim
  - **issuer** (optional): Expected issuer claim

## Available Endpoints

### 1. Direct Token Verification
```bash
curl -X POST http://localhost:3000/api/token/verify-direct \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Token verified using verifyToken directly",
    "payload": {
      "userId": "user_123456789",
      "sessionId": "sess_123456789",
      "tokenType": "session",
      "organizationId": "org_123456789",
      "organizationRole": "admin",
      "expiresAt": "2024-01-01T00:00:00.000Z",
      "issuedAt": "2024-01-01T00:00:00.000Z",
      "issuer": "https://your-domain.clerk.accounts.dev",
      "audience": "your-app-id"
    }
  }
}
```

### 2. Full Token Validation (with user/session data)
```bash
curl -X POST http://localhost:3000/api/token/validate \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

### 3. Extract Token Information
```bash
curl -X POST http://localhost:3000/api/token/info \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

## Token Claims You Can Extract

### Standard JWT Claims:
- **sub** (subject): User ID
- **iss** (issuer): Token issuer (Clerk domain)
- **aud** (audience): Your app ID
- **exp** (expiration): Expiration timestamp
- **iat** (issued at): Issued timestamp
- **nbf** (not before): Not valid before timestamp
- **jti** (JWT ID): Unique token identifier

### Clerk-Specific Claims:
- **sid**: Session ID
- **org_id**: Organization ID (for org tokens)
- **org_role**: Organization role (for org tokens)
- **org_slug**: Organization slug (for org tokens)
- **type**: Token type (session, organization, etc.)

## Code Examples

### Basic Token Verification
```typescript
import { verifyToken } from '@clerk/backend';

const verifyBasicToken = async (token: string) => {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!
    });
    
    console.log('Token is valid:', payload);
    return { success: true, payload };
  } catch (error) {
    console.error('Token verification failed:', error);
    return { success: false, error: error.message };
  }
};
```

### Verify with Audience Check
```typescript
const verifyTokenWithAudience = async (token: string) => {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
      audience: process.env.CLERK_PUBLISHABLE_KEY
    });
    
    return { success: true, payload };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
```

### Verify with Issuer Check
```typescript
const verifyTokenWithIssuer = async (token: string) => {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
      issuer: `https://${process.env.CLERK_DOMAIN}`
    });
    
    return { success: true, payload };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
```

### Extract User Information
```typescript
const extractUserInfo = async (token: string) => {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!
    });
    
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      tokenType: payload.type,
      isExpired: payload.exp ? new Date() > new Date(payload.exp * 1000) : false,
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null
    };
  } catch (error) {
    return { error: error.message };
  }
};
```

### Check Organization Membership
```typescript
const checkOrganizationAccess = async (token: string) => {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!
    });
    
    if (payload.type !== 'organization') {
      return { error: 'Not an organization token' };
    }
    
    return {
      organizationId: payload.org_id,
      organizationRole: payload.org_role,
      organizationSlug: payload.org_slug,
      userId: payload.sub
    };
  } catch (error) {
    return { error: error.message };
  }
};
```

## Error Handling

### Common Errors:
- **Token expired**: Token has passed its expiration time
- **Invalid signature**: Token signature doesn't match
- **Invalid audience**: Token audience doesn't match expected value
- **Invalid issuer**: Token issuer doesn't match expected value
- **Malformed token**: Token is not a valid JWT

### Error Handling Example:
```typescript
const handleTokenVerification = async (token: string) => {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!
    });
    
    return { success: true, payload };
  } catch (error) {
    if (error.message.includes('expired')) {
      return { error: 'Token has expired', code: 'TOKEN_EXPIRED' };
    } else if (error.message.includes('signature')) {
      return { error: 'Invalid token signature', code: 'INVALID_SIGNATURE' };
    } else if (error.message.includes('audience')) {
      return { error: 'Invalid audience', code: 'INVALID_AUDIENCE' };
    } else {
      return { error: 'Token verification failed', code: 'VERIFICATION_FAILED' };
    }
  }
};
```

## Frontend Integration

### React Hook Example:
```typescript
import { useState, useEffect } from 'react';

const useTokenValidation = (token: string) => {
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const validateToken = async () => {
      try {
        const response = await fetch('/api/token/verify-direct', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        const result = await response.json();
        
        if (result.success) {
          setIsValid(true);
          setUserInfo(result.data.payload);
        } else {
          setIsValid(false);
          setError(result.error.message);
        }
      } catch (err) {
        setIsValid(false);
        setError('Network error');
      }
    };

    if (token) {
      validateToken();
    }
  }, [token]);

  return { isValid, userInfo, error };
};
```

## Security Best Practices

1. **Always verify tokens server-side** - Never trust client-side token validation
2. **Use HTTPS** - Always transmit tokens over secure connections
3. **Check expiration** - Always verify token expiration
4. **Validate audience** - Ensure token is intended for your application
5. **Store secret key securely** - Never expose your Clerk secret key
6. **Handle errors gracefully** - Don't expose sensitive error information

## Performance Considerations

- **verifyToken is fast** - It's a local operation that doesn't make API calls
- **Cache results** - Consider caching validation results for frequently used tokens
- **Batch validation** - Validate multiple tokens in parallel when possible
- **Monitor usage** - Track token validation frequency and performance
