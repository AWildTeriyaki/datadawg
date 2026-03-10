"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { db } from "./firebaseConfig";
import { collection, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function Home() {
  const router = useRouter();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const fetchTournaments = async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(collection(db, "tournaments"));
        const list = ([]);
        snapshot.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setTournaments(list);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchTournaments();
  }, []);

  const handleCreate = async () => {
    const sanitized = newName.trim().toLowerCase().replace(/\s+/g, "_");
    if (!sanitized) { setError("Name cannot be empty."); return; }
    if (!/^[a-z0-9_]+$/.test(sanitized)) { setError("Use only letters, numbers, and underscores."); return; }
    if (tournaments.find((t) => t.id === sanitized)) { setError("A tournament with that name already exists."); return; }

    setCreating(true);
    setError("");
    try {
      await setDoc(doc(db, "tournaments", sanitized), {
        displayName: newName.trim(),
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, "tournaments", sanitized, "raw_matches", "_init"), { _init: true });
      await setDoc(doc(db, "tournaments", sanitized, "calculated", "_init"), { _init: true });
      router.push(`/${sanitized}`);
    } catch (err) {
      console.error(err);
      setError("Failed to create tournament. Are you offline?");
      setCreating(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>DATADAWG</h1>
        <p style={styles.subtitle}>Built by Dawgma, Made For FIRST©</p>
      </div>

      <div style={styles.content}>
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.sectionLabel}>EVENTS</h2>
            <button onClick={() => setShowModal(true)} style={styles.createBtn}>
              + New Event
            </button>
          </div>

          {loading ? (
            <div style={styles.center}><span style={{ color: "#999" }}>Loading...</span></div>
          ) : tournaments.length === 0 ? (
            <div style={styles.center}><p style={{ color: "#aaa", fontStyle: "italic" }}>No events yet. Create one to get started.</p></div>
          ) : (
            <div style={styles.list}>
              {tournaments.map((t) => (
                <button key={t.id} onClick={() => router.push(`/${t.id}`)} style={styles.eventRow}
                  onMouseEnter={e => Object.assign(e.currentTarget.style, { backgroundColor: "#800000", color: "#fff", borderColor: "#800000" })}
                  onMouseLeave={e => Object.assign(e.currentTarget.style, { backgroundColor: "#fff", color: "#111", borderColor: "#e0e0e0" })}>
                  <div>
                    <div style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 700, fontSize: 15 }}>{t.displayName || t.id}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, marginTop: 3, opacity: 0.5 }}>{t.id}</div>
                  </div>
                  <span style={{ fontSize: 20, opacity: 0.3 }}>›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div style={styles.overlay} onClick={() => setShowModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 6px", color: "#800000", fontFamily: "Norwester, sans-serif", fontSize: 22, letterSpacing: 1 }}>Create New Event</h3>
            <p style={{ margin: "0 0 18px", color: "#666", fontSize: 12, fontFamily: "Montserrat, sans-serif" }}>
              Name will also be used as Firebase collection ID  
            </p>
            <input autoFocus type="text" value={newName}
              onChange={e => { setNewName(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              placeholder="e.g. seneca_2026"
              style={styles.input} />
            {error && <p style={{ color: "#c00", fontSize: 12, margin: "6px 0 0", fontFamily: "Montserrat, sans-serif" }}>{error}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button onClick={() => setShowModal(false)} style={styles.cancelBtn}>Cancel</button>
              <button onClick={handleCreate} disabled={creating} style={styles.confirmBtn}>
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", backgroundColor: "#f4f4f4", fontFamily: "Montserrat, sans-serif" },
  header: { backgroundColor: "#800000", color: "#fff", padding: "56px 20px 40px", textAlign: "center" },
  title: { fontSize: "3.4rem", fontWeight: 400, margin: "0 0 8px", letterSpacing: 6, fontFamily: "Norwester, sans-serif" },
  subtitle: { margin: 0, opacity: 0.65, letterSpacing: 2, fontSize: "0.8rem", fontFamily: "Montserrat, sans-serif", fontWeight: 500 },
  content: { maxWidth: 640, margin: "36px auto", padding: "0 16px" },
  card: { backgroundColor: "#fff", borderRadius: 6, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", overflow: "hidden" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "2px solid #800000" },
  sectionLabel: { margin: 0, fontSize: "0.65rem", letterSpacing: 4, color: "#800000", fontFamily: "Montserrat, sans-serif", fontWeight: 700 },
  createBtn: { backgroundColor: "#800000", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "Montserrat, sans-serif", letterSpacing: 0.5 },
  center: { padding: 40, textAlign: "center" },
  list: { padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  eventRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", backgroundColor: "#fff", color: "#111", border: "1px solid #e0e0e0", borderRadius: 5, cursor: "pointer", textAlign: "left", transition: "all 0.12s ease", width: "100%", fontFamily: "Montserrat, sans-serif" },
  overlay: { position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modal: { backgroundColor: "#fff", borderRadius: 8, padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 16px 48px rgba(0,0,0,0.25)" },
  input: { width: "100%", padding: "11px 12px", border: "2px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box", fontFamily: "monospace", color: "#111" },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ddd", borderRadius: 4, backgroundColor: "#fff", color: "#111", cursor: "pointer", fontSize: 12, fontFamily: "Montserrat, sans-serif", fontWeight: 500 },
  confirmBtn: { padding: "9px 22px", backgroundColor: "#800000", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "Montserrat, sans-serif" },
};