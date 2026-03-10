"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";

export default function TournamentHub() {
  const { tournament } = useParams();
  const router = useRouter();
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const snap = await getDoc(doc(db, "tournaments", tournament));
        if (snap.exists()) setMeta(snap.data());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    if (tournament) fetch();
  }, [tournament]);

  const displayName = meta?.displayName || tournament;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={() => router.push("/")} style={styles.backBtn}>← All Events</button>
        <div style={styles.badge}>CURRENT TOURNAMENT</div>
        <h1 style={styles.title}>{displayName}</h1>
        <p style={styles.id}>{tournament}</p>
      </div>

      <div style={styles.content}>
        {loading ? (
          <p style={{ color: "#999", textAlign: "center", paddingTop: 60, fontFamily: "Montserrat, sans-serif" }}>Loading...</p>
        ) : (
          <div style={styles.grid}>
            <button onClick={() => router.push(`/${tournament}/collecting`)} style={styles.modeCard}>
              <div style={styles.cardIcon}>📋</div>
              <div style={styles.cardLabel}>COLLECTING</div>
              <div style={styles.cardDesc}>Supports manual or QR code entry</div>
              <div style={styles.cardArrow}>→</div>
            </button>

            <button onClick={() => router.push(`/${tournament}/insight`)} style={styles.modeCard}>
              <div style={styles.cardIcon}>📊</div>
              <div style={styles.cardLabel}>INSIGHT</div>
              <div style={styles.cardDesc}>Display team data & tournament statistics</div>
              <div style={styles.cardArrow}>→</div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// styles
const styles = {
  page: { minHeight: "100vh", backgroundColor: "#f4f4f4", fontFamily: "Montserrat, sans-serif" },
  header: { backgroundColor: "#800000", color: "#fff", padding: "40px 20px 36px", textAlign: "center", position: "relative" },
  backBtn: { position: "absolute", left: 20, top: 20, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "8px 14px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontFamily: "Montserrat, sans-serif", fontWeight: 500 },
  badge: { display: "inline-block", border: "1px solid rgba(255,255,255,0.3)", padding: "3px 12px", fontSize: 9, letterSpacing: 4, marginBottom: 12, borderRadius: 2, fontFamily: "Montserrat, sans-serif", fontWeight: 600 },
  title: { fontSize: "2.8rem", fontWeight: 400, margin: "0 0 6px", letterSpacing: 5, fontFamily: "Norwester, sans-serif" },
  id: { margin: 0, fontFamily: "monospace", fontSize: 12, opacity: 0.55 },
  content: { maxWidth: 700, margin: "48px auto", padding: "0 16px" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
  modeCard: {
    backgroundColor: "#fff", border: "2px solid #e0e0e0", borderRadius: 8,
    padding: "36px 28px", cursor: "pointer", textAlign: "left",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)", transition: "all 0.15s ease",
    display: "flex", flexDirection: "column", fontFamily: "Montserrat, sans-serif",
  },
  cardIcon: { fontSize: 34, marginBottom: 16 },
  cardLabel: { fontSize: "0.65rem", fontWeight: 700, letterSpacing: 4, color: "#800000", marginBottom: 8, fontFamily: "Montserrat, sans-serif" },
  cardDesc: { fontSize: 13, color: "#555", lineHeight: 1.6, flex: 1, fontFamily: "Montserrat, sans-serif", fontWeight: 400 },
  cardArrow: { fontSize: 20, color: "#800000", marginTop: 16, opacity: 0.6 },
};