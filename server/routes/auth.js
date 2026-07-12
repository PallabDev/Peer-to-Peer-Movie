import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db } from "../db/index.js";
import { users, parties } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// 1. User Signup
router.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const cleanedEmail = email.trim().toLowerCase();
  try {
    // Check if user exists
    const existing = await db.select().from(users).where(eq(users.email, cleanedEmail));
    if (existing.length > 0) {
      return res.status(409).json({ error: "Email is already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // First user can be admin, others are standard pending users
    const allUsers = await db.select().from(users);
    const role = allUsers.length === 0 ? "admin" : "user";
    const hasAccess = role === "admin"; // Admin has access instantly

    await db.insert(users).values({
      email: cleanedEmail,
      password: hashedPassword,
      role,
      hasAccess
    });

    return res.json({
      message: role === "admin" 
        ? "Admin account created successfully. You can log in." 
        : "Account created successfully. Please wait for an administrator to approve your access."
    });
  } catch (err) {
    console.error("[AUTH ROUTE] Signup error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// 2. User Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const cleanedEmail = email.trim().toLowerCase();
  try {
    const userList = await db.select().from(users).where(eq(users.email, cleanedEmail));
    if (userList.length === 0) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = userList[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Access Check (non-admins must have hasAccess = true)
    if (user.role !== "admin" && !user.hasAccess) {
      return res.status(403).json({ error: "Your access has not been approved yet by an administrator." });
    }

    // Establish session
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.isGuest = false;

    return res.json({
      message: "Login successful.",
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error("[AUTH ROUTE] Login error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// 3. Guest Login (Anonymous join via invite link)
router.post("/guest", async (req, res) => {
  const { name, partyId } = req.body;
  if (!name || !partyId) {
    return res.status(400).json({ error: "Name and party ID are required." });
  }

  const cleanedName = name.trim();
  if (cleanedName.length < 2 || cleanedName.length > 20) {
    return res.status(400).json({ error: "Name must be between 2 and 20 characters." });
  }

  try {
    // Verify party exists
    const partyList = await db.select().from(parties).where(eq(parties.id, partyId));
    if (partyList.length === 0) {
      return res.status(404).json({ error: "Watch Party session not found or has expired." });
    }

    // Establish Guest Session
    req.session.userId = `guest-${crypto.randomBytes(8).toString("hex")}`;
    req.session.email = `${cleanedName} (Guest)`;
    req.session.role = "guest";
    req.session.isGuest = true;
    req.session.partyId = partyId;

    return res.json({
      message: "Joined watch party anonymously.",
      user: {
        id: req.session.userId,
        email: req.session.email,
        role: "guest",
        partyId
      }
    });
  } catch (err) {
    console.error("[AUTH ROUTE] Guest join error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// 4. Logout
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Could not log out." });
    }
    res.clearCookie("sid");
    return res.json({ message: "Logout successful." });
  });
});

// 5. Get Current User Profiler
router.get("/me", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  return res.json({
    user: {
      id: req.session.userId,
      email: req.session.email,
      role: req.session.role,
      isGuest: req.session.isGuest === true
    }
  });
});

// 6. Admin: Get all users
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const list = await db.select({
      id: users.id,
      email: users.email,
      role: users.role,
      hasAccess: users.hasAccess,
      createdAt: users.createdAt
    }).from(users);
    return res.json(list);
  } catch (err) {
    console.error("[AUTH ROUTE] Fetch users error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// 7. Admin: Toggle Access status
router.post("/users/:id/access", requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { hasAccess } = req.body;

  if (isNaN(userId) || typeof hasAccess !== "boolean") {
    return res.status(400).json({ error: "Invalid parameters." });
  }

  try {
    await db.update(users)
      .set({ hasAccess, updatedAt: new Date() })
      .where(eq(users.id, userId));

    return res.json({ message: "User access status updated successfully." });
  } catch (err) {
    console.error("[AUTH ROUTE] Toggle access error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
