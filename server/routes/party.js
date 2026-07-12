import express from "express";
import crypto from "crypto";
import { db } from "../db/index.js";
import { parties, users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { activeRoomMembers } from "../sockets/chat.js";

const router = express.Router();

// 1. Create a Movie Party (Registered and approved users only)
router.post("/", requireAuth, async (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: "Party title is required." });
  }

  // Guests are not allowed to create movie parties
  if (req.session.isGuest) {
    return res.status(403).json({ error: "Guests are not authorized to create watch parties." });
  }

  const cleanedTitle = title.trim();
  const streamKey = crypto.randomBytes(8).toString("hex"); // e.g. "a1b2c3d4"

  try {
    const inserted = await db.insert(parties).values({
      title: cleanedTitle,
      hostId: req.session.userId,
      streamKey
    }).returning();

    const party = inserted[0];
    return res.json({
      message: "Movie watch party created successfully.",
      party: {
        id: party.id,
        title: party.title,
        streamKey: party.streamKey,
        whipUrl: `/whip/${party.streamKey}`, // Ingestion endpoint for WHIP
        hlsUrl: `/live/${party.streamKey}/index.m3u8` // Playback endpoint for HLS
      }
    });
  } catch (err) {
    console.error("[PARTY ROUTE] Create party error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// 2. Get all active Movie Parties (Lobby list)
router.get("/", requireAuth, async (req, res) => {
  try {
    const activeParties = await db.select({
      id: parties.id,
      title: parties.title,
      hostId: parties.hostId,
      hostEmail: users.email,
      createdAt: parties.createdAt
    })
    .from(parties)
    .leftJoin(users, eq(parties.hostId, users.id));

    // Append active viewer count to each party
    const list = activeParties.map(p => {
      const viewerSet = activeRoomMembers.get(p.id);
      return {
        ...p,
        viewerCount: viewerSet ? viewerSet.size : 0
      };
    });

    return res.json(list);
  } catch (err) {
    console.error("[PARTY ROUTE] Fetch parties error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// 3. Get specific Watch Party details (Theater entrance)
router.get("/:id", requireAuth, async (req, res) => {
  const partyId = req.params.id;

  try {
    const partyList = await db.select({
      id: parties.id,
      title: parties.title,
      hostId: parties.hostId,
      streamKey: parties.streamKey,
      hostEmail: users.email
    })
    .from(parties)
    .leftJoin(users, eq(parties.hostId, users.id))
    .where(eq(parties.id, partyId));

    if (partyList.length === 0) {
      return res.status(404).json({ error: "Movie Party session not found or has closed." });
    }

    const party = partyList[0];
    const isHost = req.session.userId === party.hostId;

    // Check Viewer Limit (Max 4 concurrent users in the room)
    const members = activeRoomMembers.get(partyId);
    const count = members ? members.size : 0;

    // If room is full and the requesting user is not already in the room and not the host
    if (count >= 4 && (!members || !members.has(req.session.userId)) && !isHost) {
      return res.status(429).json({ error: "This watch party is currently full (maximum 4 participants allowed)." });
    }

    return res.json({
      party: {
        id: party.id,
        title: party.title,
        isHost,
        // Expose stream key only to the host (for WHIP ingestion)
        whipUrl: isHost ? `/whip/${party.streamKey}` : null,
        hlsUrl: `/live/${party.streamKey}/index.m3u8`
      }
    });
  } catch (err) {
    console.error("[PARTY ROUTE] Fetch party details error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
