# Frontend Authentication with Clerk

## How to Use the New Authentication System

### 1. Frontend Request Format

Your frontend should send requests like this:

```javascript
// Frontend code example
const syncUser = async (token, sessionId, userId) => {
  const response = await fetch('http://localhost:3000/api/user/sync/' + userId, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      sessionId: sessionId,
      userId: userId
    })
  });
  
  return response.json();
};
```

### 2. cURL Test Example

```bash
curl -X POST http://localhost:3000/api/user/sync/user_123456789 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -d '{
    "sessionId": "sess_123456789",
    "userId": "user_123456789"
  }'
```

### 3. What the Middleware Does

1. **Validates Input**: Checks for Authorization header, sessionId, and userId
2. **Extracts Token**: Gets the Bearer token from Authorization header
3. **Verifies Session**: Uses `clerkClient.sessions.getSession(sessionId)` to verify the session
4. **Validates User**: Ensures the session belongs to the specified user
5. **Fetches User Data**: Gets full user data from Clerk using `clerkClient.users.getUser(userId)`
6. **Sets Context**: Stores all authentication data in the request context

### 4. What the syncUser Function Does

1. **Gets Auth Data**: Retrieves authenticated user data from context
2. **Database Check**: Checks if user exists in your database
3. **Create/Update**: Either creates new user or updates existing user
4. **Returns Data**: Returns the synced user data with authentication info

### 5. Expected Response

```json
{
  "success": true,
  "data": {
    "message": "User synced successfully",
    "user": {
      "id": 1,
      "clerk_id": "user_123456789",
      "email": "user@example.com",
      "full_name": "John Doe",
      "raw": { /* full Clerk user object */ },
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    "auth": {
      "userId": "user_123456789",
      "sessionId": "sess_123456789",
      "authenticated": true
    }
  }
}
```

### 6. Error Responses

**Missing Data (400):**
```json
{
  "success": false,
  "error": {
    "code": 400,
    "message": "Bad Request",
    "description": "Missing required authentication data"
  }
}
```

**Invalid Session (401):**
```json
{
  "success": false,
  "error": {
    "code": 401,
    "message": "Unauthorized",
    "description": "Invalid session ID"
  }
}
```

### 7. Environment Variables Required

Make sure your `.env` file has:
```bash
CLERK_SECRET_KEY=sk_test_your_secret_key_here
DATABASE_URL=postgresql://username:password@localhost:5432/database_name
```

### 8. Database Schema

Make sure your database has the users table with the correct schema:
```bash
bun run db:push:force
```
