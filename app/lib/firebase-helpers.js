/**
 * lib/firebase-helpers.js
 * Clean, reusable Firestore helpers for the scouting app.
 * All functions are offline-safe (Firebase SDK queues writes when offline).
 */

import { db } from "../app/firebaseConfig";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";

// ─── Registry (tournament list) ───────────────────────────────────────────────

export async function listTournaments() {
  const snapshot = await getDocs(collection(db, "tournaments"));
  const list = [];
  snapshot.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function registerTournament(id, displayName) {
  await setDoc(doc(db, "tournaments", id), {
    displayName,
    createdAt: serverTimestamp(),
  });
  // Seed empty subcollections with placeholder docs
  await setDoc(doc(db, "tournaments", id, "raw_matches", "_init"), { _init: true });
  await setDoc(doc(db, "tournaments", id, "calculated", "_init"), { _init: true });
}

// ─── Raw Matches ──────────────────────────────────────────────────────────────

/**
 * Get all raw match entries for a tournament.
 * Returns array of { docId, ...data } sorted by matchNumber, teamNumber.
 */
export async function getRawMatches(tournamentId) {
  const snapshot = await getDocs(collection(db, "tournaments", tournamentId, "raw_matches"));
  const results = [];
  snapshot.forEach((d) => {
    if (d.id === "_init") return;
    results.push({ docId: d.id, ...d.data() });
  });
  results.sort((a, b) => {
    const mDiff = (a.metadata?.matchNumber || 0) - (b.metadata?.matchNumber || 0);
    return mDiff !== 0 ? mDiff : (a.metadata?.teamNumber || 0) - (b.metadata?.teamNumber || 0);
  });
  return results;
}

/**
 * Save (upsert) a single raw match entry.
 * Doc ID format: m{matchNumber}_t{teamNumber}
 */
export async function saveRawMatch(tournamentId, matchData) {
  const { teamNumber, matchNumber } = matchData.metadata;
  const docId = `m${matchNumber}_t${teamNumber}`;
  await setDoc(doc(db, "tournaments", tournamentId, "raw_matches", docId), {
    ...matchData,
    updatedAt: serverTimestamp(),
  });
  return docId;
}

/**
 * Delete a raw match entry by its doc ID.
 */
export async function deleteRawMatch(tournamentId, docId) {
  await deleteDoc(doc(db, "tournaments", tournamentId, "raw_matches", docId));
}

/**
 * Check if a specific team+match combo already exists.
 * Returns the existing doc ID or null.
 */
export async function checkDuplicateMatch(tournamentId, teamNumber, matchNumber) {
  const docId = `m${matchNumber}_t${teamNumber}`;
  const snap = await getDoc(doc(db, "tournaments", tournamentId, "raw_matches", docId));
  return snap.exists() ? docId : null;
}

// ─── Calculated (aggregated per-team stats) ───────────────────────────────────

/**
 * Get calculated stats for all teams in a tournament.
 */
export async function getCalculated(tournamentId) {
  const snapshot = await getDocs(collection(db, "tournaments", tournamentId, "calculated"));
  const results = [];
  snapshot.forEach((d) => {
    if (d.id === "_init") return;
    results.push({ teamId: d.id, ...d.data() });
  });
  return results;
}

/**
 * Save calculated stats for a team.
 * Doc ID format: team{teamNumber}
 */
export async function saveCalculated(tournamentId, teamNumber, stats) {
  const docId = `team${teamNumber}`;
  await setDoc(doc(db, "tournaments", tournamentId, "calculated", docId), {
    ...stats,
    teamNumber,
    updatedAt: serverTimestamp(),
  });
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

/**
 * Recalculate and save aggregated stats for all teams in a tournament.
 * Call this after saving/deleting matches to keep calculated/ in sync.
 */
export async function recalculateTournament(tournamentId) {
  const matches = await getRawMatches(tournamentId);

  // Group by team
  const byTeam = {};
  matches.forEach((m) => {
    const team = m.metadata?.teamNumber;
    if (!team) return;
    if (!byTeam[team]) byTeam[team] = [];
    byTeam[team].push(m);
  });

  // Calculate per-team
  for (const [team, teamMatches] of Object.entries(byTeam)) {
    const n = teamMatches.length;

    const avg = (getter) => teamMatches.reduce((s, m) => s + (getter(m) || 0), 0) / n;
    const count = (getter) => teamMatches.filter(getter).length;
    const pct = (getter) => Math.round((count(getter) / n) * 100);

    const stats = {
      matchCount: n,
      avgAutoFuel:    avg(m => m.auto?.fuel),
      avgTeleopFuel:  avg(m => m.teleop?.fuel),
      climbPct:       pct(m => m.auto?.autoClimb),
      l1Pct:          pct(m => m.endgame?.l1),
      l2Pct:          pct(m => m.endgame?.l2),
      l3Pct:          pct(m => m.endgame?.l3),
      defensePlayPct: pct(m => m.defense?.playDefense),
      defendedPct:    pct(m => m.defense?.wasDefended),
      penaltyPct:     pct(m => m.additionalInfo?.penalty),
      deadBotPct:     pct(m => m.additionalInfo?.deadBot),
    };

    await saveCalculated(tournamentId, team, stats);
  }
}