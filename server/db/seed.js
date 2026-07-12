import { db, pool } from "./index.js";
import { users } from "./schema.js";
import bcrypt from "bcrypt";

async function seed() {
  try {
    console.log("Checking if users table is empty...");
    const existingUsers = await db.select().from(users);

    if (existingUsers.length === 0) {
      const adminEmail = "watch@pallabdev.in";
      const adminPassword = "Watch12345";
      console.log(`No users found. Seeding initial admin user (${adminEmail})...`);
      const hashedPassword = await bcrypt.hash(adminPassword, 10);

      await db.insert(users).values({
        email: adminEmail,
        password: hashedPassword,
        role: "admin",
        hasAccess: true
      });

      console.log("=========================================");
      console.log("Initial admin user created successfully!");
      console.log(`Email: ${adminEmail}`);
      console.log(`Password: ${adminPassword}`);
      console.log("=========================================");
    } else {
      console.log(`Database already has ${existingUsers.length} user(s). Seeding skipped.`);
    }
  } catch (error) {
    console.error("Error seeding database:", error);
  } finally {
    await pool.end();
  }
}

seed();
