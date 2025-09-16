import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL

async function connectToDatabase() {
    const client = postgres(connectionString, { prepare: false })
    const db = drizzle({ client });
    console.log('Connected to database');
}

export default connectToDatabase;