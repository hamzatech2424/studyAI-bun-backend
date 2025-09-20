import { successResponseHelper, errorResponseHelper } from '../utils/response';
import { usersTable } from '../modals/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

// Users collection
const syncUser = async (c: any) => {
  try {
    const clerkUser = c.get('clerkUser');
    if (!clerkUser) {
      return c.json({
        success: false,
        error: {
          code: 401,
          message: "Unauthorized",
          description: "Authentication required"
        }
      }, 401);
    }

    // Check if user exists in database
    const existingUser = await db.select().from(usersTable)
      .where(eq(usersTable.clerk_id, clerkUser.userId));
    let user;
    
    if (existingUser.length > 0) {
      // Update existing user
      user = await db.update(usersTable)
        .set({
          email: clerkUser.userData.emailAddresses[0]?.emailAddress || '',
          first_name: clerkUser.userData.firstName || '',
          last_name: clerkUser.userData.lastName || '',
          raw: clerkUser.userData
        })
        .where(eq(usersTable.clerk_id, clerkUser.userId))
        .returning();
    } else {
      // Create new user
      user = await db.insert(usersTable).values({
        clerk_id: clerkUser.userId,
        email: clerkUser.userData.emailAddresses[0]?.emailAddress || '',
        first_name: clerkUser.userData.firstName || '',
        last_name: clerkUser.userData.lastName || '',
        raw: clerkUser.userData
      }).returning();
    }

    return successResponseHelper(c, {
      message: "User synced successfully",
      user: user[0],
      auth: {
        userId: clerkUser.userId,
        authenticated: true
      }
    });
  } catch (error) {
    console.log("Error in syncUser:", error);
    return errorResponseHelper(c, error);
  }
};

export { syncUser };