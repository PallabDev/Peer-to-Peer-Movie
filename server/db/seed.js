import { db } from "./index.js";
import { users } from "./schema.js";
import bcrypt from "bcrypt";

async function seed() {
  try {
    console.log("Checking if users table is empty...");
    const existingUsers = db.select().from(users).all();
    
    if (existingUsers.length === 0) {
      console.log("No users found. Seeding initial admin user...");
      const hashedPassword = await bcrypt.hash("adminpassword123", 10);
      
      db.insert(users).values({
        email: "admin@example.com",
        password: hashedPassword,
        role: "admin",
        hasAccess: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }).run();
      
      console.log("=========================================");
      console.log("Initial admin user created successfully!");
      console.log("Email: admin@example.com");
      console.log("Password: adminpassword123");
      console.log("=========================================");
    } else {
      console.log(`Database already has ${existingUsers.length} user(s). Seeding skipped.`);
    }
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}

seed();
