# Fix Database Schema Mismatch

## Problem
Your database table doesn't have the columns defined in your Drizzle schema. The error shows:
```
PostgresError: column "clerk_id" does not exist
```

## Solution Options

### Option 1: Reset Database (Recommended for Development)
```bash
# This will drop all tables and recreate them with the correct schema
bun run db:reset
```

### Option 2: Generate and Apply Migrations
```bash
# Generate migration files based on your schema
bun run db:generate

# Apply the migrations to update your database
bun run db:migrate
```

### Option 3: Manual Database Fix
If you have important data, you can manually add the missing columns:

```sql
-- Connect to your database and run:
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255) NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS raw JSON;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
```

## After Fixing
1. Test the route: `curl -X GET http://localhost:3000/api/users`
2. You should see your users data or an empty array if no users exist
3. You can create a test user with: `curl -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d '{"clerk_id":"test123","email":"test@example.com","full_name":"Test User"}'`

## Your Current Schema
Your Drizzle schema defines these columns:
- `id` (integer, primary key, auto-generated)
- `clerk_id` (varchar, required, unique)
- `email` (varchar, required)
- `full_name` (varchar, optional)
- `raw` (json, optional)
- `created_at` (timestamp, auto-generated)
