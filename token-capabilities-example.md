# Clerk Token Capabilities

## What You Can Do With Clerk Tokens

### 1. **Token Validation**
Validate if a token is valid and get full user/session information:

```bash
curl -X POST http://localhost:3000/api/token/validate \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Token validation result",
    "validation": {
      "isValid": true,
      "userId": "user_123456789",
      "sessionId": "sess_123456789",
      "session": {
        "id": "sess_123456789",
        "userId": "user_123456789",
        "status": "active",
        "expireAt": 1640995200000
      },
      "user": {
        "id": "user_123456789",
        "emailAddresses": [...],
        "firstName": "John",
        "lastName": "Doe"
      },
      "tokenInfo": {
        "type": "session",
        "issuer": "https://clerk.your-domain.com",
        "audience": "your-app-id",
        "expiresAt": "2024-01-01T00:00:00.000Z",
        "issuedAt": "2024-01-01T00:00:00.000Z"
      }
    }
  }
}
```

### 2. **Extract Token Information**
Get basic token information without full validation:

```bash
curl -X POST http://localhost:3000/api/token/info \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Token information",
    "tokenInfo": {
      "isValid": true,
      "userId": "user_123456789",
      "sessionId": "sess_123456789",
      "expiresAt": "2024-01-01T00:00:00.000Z",
      "issuedAt": "2024-01-01T00:00:00.000Z",
      "issuer": "https://clerk.your-domain.com",
      "audience": "your-app-id",
      "type": "session"
    },
    "expired": false,
    "ageMinutes": 30,
    "timeUntilExpiryMinutes": 1430
  }
}
```

### 3. **Validate Token with Session**
Validate token and verify it matches a specific session:

```bash
curl -X POST http://localhost:3000/api/token/session \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "sess_123456789"}'
```

## Token Information You Can Extract

### **Basic Token Data:**
- ✅ **User ID** (`sub` claim)
- ✅ **Session ID** (`sid` claim)
- ✅ **Token Type** (session, organization, etc.)
- ✅ **Issuer** (Clerk domain)
- ✅ **Audience** (your app ID)
- ✅ **Expiration Time** (`exp` claim)
- ✅ **Issued At** (`iat` claim)

### **Derived Information:**
- ✅ **Token Age** (how long ago it was issued)
- ✅ **Time Until Expiry** (how much time left)
- ✅ **Is Expired** (boolean check)
- ✅ **Token Format** (valid JWT structure)

### **Full Validation Data:**
- ✅ **User Object** (complete Clerk user data)
- ✅ **Session Object** (complete session information)
- ✅ **Session Status** (active, expired, etc.)
- ✅ **User Permissions** (if applicable)

## Frontend Usage Examples

### **Check Token Validity:**
```javascript
const checkToken = async (token) => {
  const response = await fetch('/api/token/validate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const result = await response.json();
  return result.data.validation.isValid;
};
```

### **Get Token Age:**
```javascript
const getTokenAge = async (token) => {
  const response = await fetch('/api/token/info', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const result = await response.json();
  return result.data.ageMinutes;
};
```

### **Check if Token is Expired:**
```javascript
const isTokenExpired = async (token) => {
  const response = await fetch('/api/token/info', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const result = await response.json();
  return result.data.expired;
};
```

### **Extract User ID from Token:**
```javascript
const getUserIdFromToken = async (token) => {
  const response = await fetch('/api/token/info', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const result = await response.json();
  return result.data.tokenInfo.userId;
};
```

## Use Cases

### **1. Token Refresh Logic:**
```javascript
const shouldRefreshToken = async (token) => {
  const response = await fetch('/api/token/info', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const result = await response.json();
  const timeUntilExpiry = result.data.timeUntilExpiryMinutes;
  
  // Refresh if less than 5 minutes left
  return timeUntilExpiry < 5;
};
```

### **2. User Session Management:**
```javascript
const getUserSession = async (token) => {
  const response = await fetch('/api/token/validate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const result = await response.json();
  return {
    user: result.data.validation.user,
    session: result.data.validation.session,
    isValid: result.data.validation.isValid
  };
};
```

### **3. Security Checks:**
```javascript
const validateUserAccess = async (token, requiredUserId) => {
  const response = await fetch('/api/token/validate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const result = await response.json();
  const tokenUserId = result.data.validation.userId;
  
  return tokenUserId === requiredUserId;
};
```

## Token Types

Clerk supports different token types:

- **Session Token**: For user authentication
- **Organization Token**: For organization-specific access
- **API Token**: For server-to-server communication
- **Webhook Token**: For webhook verification

## Security Considerations

1. **Never expose tokens** in client-side code
2. **Validate tokens server-side** before trusting them
3. **Check expiration** before using tokens
4. **Verify session status** for active sessions
5. **Use HTTPS** for all token transmission

## Error Handling

```javascript
const handleTokenError = (error) => {
  if (error.message.includes('expired')) {
    // Redirect to login
    window.location.href = '/login';
  } else if (error.message.includes('invalid')) {
    // Clear stored token
    localStorage.removeItem('clerk_token');
  }
};
```
