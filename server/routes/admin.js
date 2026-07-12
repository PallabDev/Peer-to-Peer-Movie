import express from "express";
import bcrypt from "bcrypt";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq, like, or, and, ne } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

// Apply admin access middleware to all routes in this router
router.use(requireAdmin);

// View and Search users
router.get("/users", async (req, res) => {
  const { search } = req.query;

  try {
    let allUsers;
    if (search && search.trim() !== "") {
      const searchPattern = `%${search.trim().toLowerCase()}%`;
      allUsers = db.select({
        id: users.id,
        email: users.email,
        role: users.role,
        hasAccess: users.hasAccess,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })
      .from(users)
      .where(like(users.email, searchPattern))
      .all();
    } else {
      allUsers = db.select({
        id: users.id,
        email: users.email,
        role: users.role,
        hasAccess: users.hasAccess,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })
      .from(users)
      .all();
    }

    return res.json(allUsers);
  } catch (error) {
    logger.error("Admin view users error", error);
    return res.status(500).json({ error: "Failed to retrieve users." });
  }
});

// Create user
router.post("/users", async (req, res) => {
  const { email, password, role, hasAccess } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const cleanEmail = email.trim().toLowerCase();
  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  try {
    // Check if email already exists
    const existing = db.select().from(users).where(eq(users.email, cleanEmail)).all();
    if (existing.length > 0) {
      return res.status(409).json({ error: "Email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.insert(users).values({
      email: cleanEmail,
      password: hashedPassword,
      role: role === "admin" ? "admin" : "user",
      hasAccess: hasAccess === true || hasAccess === 1 || role === "admin", // Admin has access by default
      createdAt: new Date(),
      updatedAt: new Date()
    }).run();

    logger.info(`Admin created user: ${cleanEmail} (Role: ${role})`);
    return res.status(201).json({ message: "User created successfully." });
  } catch (error) {
    logger.error("Admin create user error", error);
    return res.status(500).json({ error: "Failed to create user." });
  }
});

// Delete user
router.delete("/users/:id", async (req, res) => {
  const targetId = parseInt(req.params.id, 10);

  if (isNaN(targetId)) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  // Prevent deleting oneself
  if (targetId === req.user.id) {
    return res.status(400).json({ error: "You cannot delete your own admin account." });
  }

  try {
    const targetUser = db.select().from(users).where(eq(users.id, targetId)).all();
    if (targetUser.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const email = targetUser[0].email;

    db.delete(users).where(eq(users.id, targetId)).run();
    logger.info(`Admin deleted user: ${email}`);
    return res.json({ message: "User deleted successfully." });
  } catch (error) {
    logger.error("Admin delete user error", error);
    return res.status(500).json({ error: "Failed to delete user." });
  }
});

// Update role, hasAccess, or reset password
router.patch("/users/:id", async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { role, hasAccess, password } = req.body;

  if (isNaN(targetId)) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  try {
    const targetUserList = db.select().from(users).where(eq(users.id, targetId)).all();
    if (targetUserList.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const targetUser = targetUserList[0];
    const updates = { updatedAt: new Date() };

    if (role !== undefined) {
      // Prevent admin from removing their own admin role to avoid lockout
      if (targetId === req.user.id && role !== "admin") {
        return res.status(400).json({ error: "You cannot change your own admin role." });
      }
      updates.role = role === "admin" ? "admin" : "user";
    }

    if (hasAccess !== undefined) {
      // Prevent admin from revoking their own access
      if (targetId === req.user.id && !hasAccess) {
        return res.status(400).json({ error: "You cannot disable access for your own account." });
      }
      updates.hasAccess = hasAccess === true || hasAccess === 1;
    }

    if (password !== undefined && password.trim() !== "") {
      updates.password = await bcrypt.hash(password, 10);
      logger.info(`Admin reset password for user: ${targetUser.email}`);
    }

    db.update(users).set(updates).where(eq(users.id, targetId)).run();
    logger.info(`Admin updated user details for: ${targetUser.email}`);

    return res.json({ message: "User updated successfully." });
  } catch (error) {
    logger.error("Admin update user error", error);
    return res.status(500).json({ error: "Failed to update user." });
  }
});

export default router;
