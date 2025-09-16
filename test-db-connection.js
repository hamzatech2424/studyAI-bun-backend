// Test database connection and schema
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { usersTable } from './modals/schema.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL environment variable is not set');
  process.exit(1);
}

console.log('🔗 Testing database connection...');

try {
  const client = postgres(connectionString, { prepare: false });
  const db = drizzle(client);
  
  // Test basic connection
  console.log('✅ Database connection established');
  
  // Test if users table exists and has correct structure
  console.log('🔍 Checking users table structure...');
  
  const result = await client`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'users'
    ORDER BY ordinal_position;
  `;
  
  console.log('📋 Current users table structure:');
  console.table(result);
  
  // Test selecting from users table
  console.log('👥 Testing user selection...');
  const users = await db.select().from(usersTable);
  console.log(`✅ Found ${users.length} users in database`);
  console.log('Users:', users);
  
  await client.end();
  console.log('✅ Database test completed successfully');
  
} catch (error) {
  console.error('❌ Database test failed:', error.message);
  console.error('Full error:', error);
  process.exit(1);
}
