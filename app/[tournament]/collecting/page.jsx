"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "../../firebaseConfig";
import { collection, doc, setDoc, getDocs, deleteDoc, serverTimestamp } from "firebase/firestore";

// column defs for table
const COLUMNS = [
  { key: "teamNumber",  label: "Team #",      type: "int",    category: "Event Info",      width: 80  },
  { key: "matchNumber", label: "Match #",     type: "int",    category: "Event Info",      width: 80  },
  { key: "autoClimb",  label: "Climb",        type: "bool",   category: "Auto",            width: 60  },
  { key: "autoFuel",   label: "Fuel",         type: "int",    category: "Auto",            width: 60  },
  { key: "playDefense",label: "Play Defense", type: "bool",   category: "Defense",         width: 90  },
  { key: "wasDefended",label: "Was Defended", type: "bool",   category: "Defense",         width: 95  },
  { key: "passed",     label: "Passed",       type: "bool",   category: "Defense",         width: 65  },
  { key: "teleopFuel", label: "Fuel",         type: "int",    category: "Teleop",          width: 60  },
  { key: "l1",         label: "L1",           type: "bool",   category: "Endgame",         width: 50  },
  { key: "l2",         label: "L2",           type: "bool",   category: "Endgame",         width: 50  },
  { key: "l3",         label: "L3",           type: "bool",   category: "Endgame",         width: 50  },
  { key: "penalty",    label: "Penalty",      type: "bool",   category: "Additional Info", width: 70  },
  { key: "deadBot",    label: "Dead Bot",     type: "bool",   category: "Additional Info", width: 72  },
  { key: "alliance",   label: "Alliance",     type: "bool",   category: "Additional Info", width: 72  },
  { key: "notes",      label: "Notes",        type: "string", category: "Additional Info", width: 200 },
  { key: "scoutName",  label: "Scout Name",   type: "string", category: "Additional Info", width: 120 },
];

const CATEGORIES = [...new Set(COLUMNS.map(c => c.category))];
const EMPTY_ROW = () => Object.fromEntries(COLUMNS.map(c => [c.key, ""]));
const INITIAL_ROWS = 60;
const NUM_COLS = COLUMNS.length;
 
// helpers
function parseQRString(str) {
  const parts = str.trim().split(",");
  if (parts.length < NUM_COLS) return null;
  const row = {};
  COLUMNS.forEach((col, i) => { row[col.key] = parts[i]?.trim() ?? ""; });
  return row;
}

function looksLikeQR(str) {
  return str.includes(",") && str.split(",").length >= NUM_COLS;
}

// TSV to 2D array
function parseTSV(str) {
  return str.split("\n").map(line => line.replace(/\r$/, "").split("\t"));
}

function looksLikeTSV(str) {
  return str.includes("\t");
}

function rowToFirestore(row) {
  return {
    metadata:       { teamNumber: parseInt(row.teamNumber) || 0, matchNumber: parseInt(row.matchNumber) || 0, scoutName: row.scoutName || "" },
    auto:           { autoClimb: row.autoClimb === "1", fuel: parseInt(row.autoFuel) || 0 },
    defense:        { playDefense: row.playDefense === "1", wasDefended: row.wasDefended === "1", passed: row.passed === "1" },
    teleop:         { fuel: parseInt(row.teleopFuel) || 0 },
    endgame:        { l1: row.l1 === "1", l2: row.l2 === "1", l3: row.l3 === "1" },
    additionalInfo: { penalty: row.penalty === "1", deadBot: row.deadBot === "1", alliance: row.alliance === "1", notes: row.notes || "" },
    updatedAt:      serverTimestamp(),
  };
}

function firestoreToRow(docId, data) {
  return {
    _docId:      docId,
    teamNumber:  String(data.metadata?.teamNumber  ?? ""),
    matchNumber: String(data.metadata?.matchNumber ?? ""),
    autoClimb:   data.auto?.autoClimb    ? "1" : "0",
    autoFuel:    String(data.auto?.fuel  ?? ""),
    playDefense: data.defense?.playDefense ? "1" : "0",
    wasDefended: data.defense?.wasDefended ? "1" : "0",
    passed:      data.defense?.passed      ? "1" : "0",
    teleopFuel:  String(data.teleop?.fuel  ?? ""),
    l1:          data.endgame?.l1 ? "1" : "0",
    l2:          data.endgame?.l2 ? "1" : "0",
    l3:          data.endgame?.l3 ? "1" : "0",
    penalty:     data.additionalInfo?.penalty  ? "1" : "0",
    deadBot:     data.additionalInfo?.deadBot  ? "1" : "0",
    alliance:    data.additionalInfo?.alliance ? "1" : "0",
    notes:       data.additionalInfo?.notes    ?? "",
    scoutName:   data.metadata?.scoutName      ?? "",
  };
}

function docIdFromRow(row) { return `m${row.matchNumber}_t${row.teamNumber}`; }
function isRowEmpty(row)   { return COLUMNS.every(c => !row[c.key]); }

function ensureTail(arr, min = 10) {
  const trailing = arr.slice(-min).filter(isRowEmpty).length;
  if (trailing < min) return [...arr, ...Array.from({ length: min - trailing }, EMPTY_ROW)];
  return arr;
}

function normSel(sel) {
  if (!sel) return null;
  return {
    r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2),
    c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2),
  };
}

function inSel(sel, r, c) {
  if (!sel) return false;
  const n = normSel(sel);
  return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
}

export default function CollectingPage() {
  const { tournament } = useParams();
  const router = useRouter();

  const [rows, setRows]         = useState(() => Array.from({ length: INITIAL_ROWS }, EMPTY_ROW));
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);
 
  const [sel, setSel]           = useState(null);   
  const [editCell, setEditCell] = useState(null);  /// current cell (cell being edited)
  const [editValue, setEditValue] = useState("");

  const rowsRef       = useRef(rows);
  const qrBufRef      = useRef("");
  const qrTimerRef    = useRef(null);
  const processingRef = useRef(false);
  const inputRef      = useRef(null);   
  const tableWrapRef  = useRef(null);   
  const isDragging    = useRef(false);

  const setRowsSync = useCallback((updater) => {
    setRows(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      rowsRef.current = next;
      return next;
    });
  }, []);

  // load data
  useEffect(() => {
    if (!tournament) return;
    (async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(collection(db, "tournaments", tournament, "raw_matches"));
        const loaded = [];
        snapshot.forEach(d => {
          if (d.id === "_init") return;
          loaded.push(firestoreToRow(d.id, d.data()));
        });
        loaded.sort((a, b) => {
          const m = (parseInt(a.matchNumber) || 0) - (parseInt(b.matchNumber) || 0);
          return m !== 0 ? m : (parseInt(a.teamNumber) || 0) - (parseInt(b.teamNumber) || 0);
        });
        setRowsSync(ensureTail(loaded, INITIAL_ROWS));
      } catch (err) {
        console.error(err);
        showToast("error", "Failed to load — working offline.");
      } finally {
        setLoading(false);
      }
    })();
  }, [tournament]);

  // toast
  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  // firestore funcs
  const saveRow = useCallback(async (row) => {
    const team = row.teamNumber?.trim(), match = row.matchNumber?.trim();
    if (!team || !match) return;
    try {
      await setDoc(doc(db, "tournaments", tournament, "raw_matches", `m${match}_t${team}`), rowToFirestore(row));
    } catch (err) {
      console.error(err);
      showToast("error", "Save failed. Will retry when online.");
    }
  }, [tournament]);

  const deleteRowDoc = useCallback(async (docId) => {
    if (!docId) return;
    try { await deleteDoc(doc(db, "tournaments", tournament, "raw_matches", docId)); }
    catch (err) { console.error(err); }
  }, [tournament]);

  // prevent duplicates
  const isDuplicate = useCallback((team, match) => {
    if (!team || !match) return false;
    return rowsRef.current.some(r => {
      const rt = r.teamNumber?.trim(), rm = r.matchNumber?.trim();
      return rt && rm && rt === team && rm === match;
    });
  }, []);

  const isDuplicateExcluding = useCallback((team, match, excludeIdx) => {
    if (!team || !match) return false;
    return rowsRef.current.some((r, i) => {
      if (i === excludeIdx) return false;
      const rt = r.teamNumber?.trim(), rm = r.matchNumber?.trim();
      return rt && rm && rt === team && rm === match;
    });
  }, []);

  const commitEdit = useCallback((rowIdx, colKey, value) => {
    setRowsSync(prev => {
      const updated = [...prev];
      updated[rowIdx] = { ...updated[rowIdx], [colKey]: value };
      return ensureTail(updated);
    });

    const row = { ...rowsRef.current[rowIdx], [colKey]: value };
    if (isRowEmpty(row)) {
      if (row._docId) deleteRowDoc(row._docId);
      return;
    }
    const team = row.teamNumber?.trim(), match = row.matchNumber?.trim();
    if (!team || !match) return;
    if (isDuplicateExcluding(team, match, rowIdx)) {
      showToast("error", `⚠ Team ${team} already entered for Match ${match}`);
      return;
    }
    const newDocId = docIdFromRow(row);
    if (row._docId && row._docId !== newDocId) deleteRowDoc(row._docId);
    const newRow = { ...row, _docId: newDocId };
    setRowsSync(prev => { const u = [...prev]; u[rowIdx] = newRow; return u; });
    saveRow(newRow);
  }, [setRowsSync, deleteRowDoc, isDuplicateExcluding, saveRow]);

  const openEdit = useCallback((rowIdx, colIdx) => {
    const col = COLUMNS[colIdx];
    setEditCell({ row: rowIdx, col: colIdx });
    setEditValue(rowsRef.current[rowIdx]?.[col.key] ?? "");
    setSel({ r1: rowIdx, c1: colIdx, r2: rowIdx, c2: colIdx });
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, []);

  const closeEdit = useCallback(() => {
    if (!editCell) return;
    const col = COLUMNS[editCell.col];
    commitEdit(editCell.row, col.key, editValue);
    setEditCell(null);
  }, [editCell, editValue, commitEdit]);

  // mouse events
  const handleCellMouseDown = useCallback((e, rowIdx, colIdx) => {
    if (editCell) closeEdit();
    e.preventDefault(); 
    isDragging.current = true;
    setSel({ r1: rowIdx, c1: colIdx, r2: rowIdx, c2: colIdx });
    tableWrapRef.current?.focus();
  }, [editCell, closeEdit]);

  const handleCellMouseEnter = useCallback((rowIdx, colIdx) => {
    if (!isDragging.current) return;
    setSel(prev => prev ? { ...prev, r2: rowIdx, c2: colIdx } : null);
  }, []);

  const handleCellMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleCellDoubleClick = useCallback((rowIdx, colIdx) => {
    openEdit(rowIdx, colIdx);
  }, [openEdit]);

  // keyboard events for selection, editing, copy/paste, and deletion
  const handleTableKeyDown = useCallback((e) => {
    if (editCell) return;
    if (!sel) return;

    const n = normSel(sel);

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setRowsSync(prev => {
        const updated = prev.map((row, ri) => {
          if (ri < n.r1 || ri > n.r2) return row;
          const newRow = { ...row };
          COLUMNS.forEach((col, ci) => {
            if (ci >= n.c1 && ci <= n.c2) newRow[col.key] = "";
          });
          return newRow;
        });

        updated.forEach((row, ri) => {
          if (ri < n.r1 || ri > n.r2) return;
          if (isRowEmpty(row)) {
            if (row._docId) deleteRowDoc(row._docId);
          } else {
            const team = row.teamNumber?.trim(), match = row.matchNumber?.trim();
            if (team && match) saveRow(row);
          }
        });
        return ensureTail(updated);
      });
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      const current = rowsRef.current;
      const tsv = [];
      for (let r = n.r1; r <= n.r2; r++) {
        const rowVals = [];
        for (let c = n.c1; c <= n.c2; c++) {
          rowVals.push(current[r]?.[COLUMNS[c].key] ?? "");
        }
        tsv.push(rowVals.join("\t"));
      }
      navigator.clipboard?.writeText(tsv.join("\n"));
      showToast("success", `Copied ${n.r2 - n.r1 + 1} row(s)`);
      return;
    }

    //  navigation helpers
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
      e.preventDefault();
      setSel(prev => {
        if (!prev) return prev;
        let { r2, c2 } = prev;
        if (e.key === "ArrowUp")    r2 = Math.max(0, r2 - 1);
        if (e.key === "ArrowDown")  r2 = Math.min(rowsRef.current.length - 1, r2 + 1);
        if (e.key === "ArrowLeft")  c2 = Math.max(0, c2 - 1);
        if (e.key === "ArrowRight") c2 = Math.min(NUM_COLS - 1, c2 + 1);
        return { r1: r2, c1: c2, r2, c2 };
      });
      return;
    }

    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      openEdit(n.r1, n.c1);
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      openEdit(n.r1, n.c1);
      setEditValue(e.key);
    }
  }, [editCell, sel, setRowsSync, deleteRowDoc, saveRow, openEdit]);

  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest("[data-table]")) {
        closeEdit();
        setSel(null);
      }
    };
    const handleMouseUp = () => { isDragging.current = false; };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [closeEdit]);

  // QR scanner + TSV paste handlers
  const handleTSVPaste = useCallback((text) => {
    if (!sel) return;
    const anchor = normSel(sel);
    const startRow = anchor.r1;
    const startCol = anchor.c1;
    const grid = parseTSV(text).filter(r => r.some(v => v.trim() !== ""));

    setRowsSync(prev => {
      const updated = [...prev];

      while (updated.length < startRow + grid.length + 10) {
        updated.push(EMPTY_ROW());
      }
      const rowsToSave = [];
      grid.forEach((rowVals, ri) => {
        const targetIdx = startRow + ri;
        const base = { ...updated[targetIdx] };
        const oldDocId = base._docId;

        rowVals.forEach((val, ci) => {
          const targetCol = startCol + ci;
          if (targetCol < NUM_COLS) base[COLUMNS[targetCol].key] = val.trim();
        });

        if (isRowEmpty(base)) {
          // delete doc if row becomes empty
          if (oldDocId) deleteRowDoc(oldDocId);
          updated[targetIdx] = EMPTY_ROW();
        } else {
          const team  = base.teamNumber?.trim();
          const match = base.matchNumber?.trim();
          if (team && match) {
            const newDocId = `m${match}_t${team}`;
            if (oldDocId && oldDocId !== newDocId) deleteRowDoc(oldDocId);
            base._docId = newDocId;
          }
          updated[targetIdx] = base;
          if (base.teamNumber?.trim() && base.matchNumber?.trim()) {
            rowsToSave.push(base);
          }
        }
      });

      setTimeout(() => {
        rowsToSave.forEach(row => saveRow(row));
        showToast("success", `Pasted ${rowsToSave.length} row(s) · saving to Firebase`);
      }, 0);

      return ensureTail(updated);
    });
  }, [sel, setRowsSync, deleteRowDoc, saveRow]);

  const handleQRScan = useCallback((raw) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setTimeout(() => { processingRef.current = false; }, 100);

    const parsed = parseQRString(raw);
    if (!parsed) { showToast("error", `Invalid format: "${raw.substring(0, 40)}"`); return; }

    const current   = rowsRef.current;
    const emptyIdx  = current.findIndex(isRowEmpty);
    const targetIdx = emptyIdx !== -1 ? emptyIdx : current.length;

    if (isDuplicate(parsed.teamNumber?.trim(), parsed.matchNumber?.trim())) {
      showToast("error", `⚠ Team ${parsed.teamNumber} already entered for Match ${parsed.matchNumber}`);
      return;
    }

    const newRow  = { ...parsed, _docId: docIdFromRow(parsed) };
    const updated = [...current];
    if (targetIdx >= updated.length) updated.push(EMPTY_ROW());
    updated[targetIdx] = newRow;

    setRowsSync(ensureTail(updated));
    saveRow(newRow);
    showToast("success", `✓ Team ${parsed.teamNumber} · Match ${parsed.matchNumber}`);
  }, [isDuplicate, saveRow, setRowsSync]);

  useEffect(() => {
    const onPaste = (e) => {
      const text = (e.clipboardData?.getData("text") ?? "").trim();
      // handle qr string
      if (editCell) {
        if (looksLikeQR(text)) { e.preventDefault(); handleQRScan(text); }
        return;
      }
      e.preventDefault();
      if (looksLikeQR(text)) { handleQRScan(text); return; }
      if (looksLikeTSV(text)) { handleTSVPaste(text); return; }
    };
    const onKeyDown = (e) => {
      if (editCell) return;  
      if (e.key === "Enter") {
        const buf = qrBufRef.current.trim();
        qrBufRef.current = "";
        clearTimeout(qrTimerRef.current);
        if (looksLikeQR(buf)) { e.preventDefault(); handleQRScan(buf); }
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key.length === 1) {
        qrBufRef.current += e.key;
        clearTimeout(qrTimerRef.current);
        qrTimerRef.current = setTimeout(() => { qrBufRef.current = ""; }, 500);
      }
    };
    window.addEventListener("paste",   onPaste,   { capture: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("paste",   onPaste,   { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleQRScan, handleTSVPaste, editCell]);

  // render
  const categoryCounts = CATEGORIES.map(cat => ({
    cat, count: COLUMNS.filter(c => c.category === cat).length,
  }));

  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={() => router.push(`/${tournament}`)} style={s.backBtn}>← Back</button>
        <div>
          <div style={s.badge}>COLLECTING</div>
          <h1 style={s.title}>{tournament}</h1>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
          {loading ? "Loading..." : `${rows.filter(r => !isRowEmpty(r)).length} entries found`}
        </div>
      </div>

      {/* table */}
      <div
        ref={tableWrapRef}
        data-table
        tabIndex={0}
        style={s.tableWrap}
        onKeyDown={handleTableKeyDown}
        onMouseLeave={() => { isDragging.current = false; }}
      >
        <table style={s.table} cellSpacing={0} cellPadding={0}>
          <thead>
            <tr>
              <th style={{ ...s.th, ...s.rowNumTh }}>#</th>
              {categoryCounts.map(({ cat, count }) => (
                <th key={cat} colSpan={count} style={s.catTh}>{cat}</th>
              ))}
            </tr>
            <tr>
              <th style={{ ...s.th, ...s.rowNumTh }}></th>
              {COLUMNS.map(col => (
                <th key={col.key} style={{ ...s.th, minWidth: col.width }}>{col.label}</th>
              ))}
            </tr>
            <tr>
              <th style={{ ...s.typeTh, ...s.rowNumTh }}></th>
              {COLUMNS.map(col => (
                <th key={col.key} style={s.typeTh}>{col.type}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const empty = isRowEmpty(row);
              return (
                <tr key={rowIdx} style={rowIdx % 2 === 0 ? s.rowEven : s.rowOdd}>
                  <td style={s.rowNumCell}>{rowIdx + 1}</td>
                  {COLUMNS.map((col, colIdx) => {
                    const isEdit     = editCell?.row === rowIdx && editCell?.col === colIdx;
                    const isSelected = inSel(sel, rowIdx, colIdx);
                    return (
                      <td
                        key={col.key}
                        style={{
                          ...s.td,
                          minWidth: col.width,
                          ...(col.key === "matchNumber" ? s.highlightCell : {}),
                          ...(isSelected ? s.selectedTd : {}),
                          ...(isEdit ? s.editTd : {}),
                          position: "relative",
                        }}
                        onMouseDown={e => handleCellMouseDown(e, rowIdx, colIdx)}
                        onMouseEnter={() => handleCellMouseEnter(rowIdx, colIdx)}
                        onMouseUp={handleCellMouseUp}
                        onDoubleClick={() => handleCellDoubleClick(rowIdx, colIdx)}
                      >

                        <div style={{
                          ...s.cellDisplay,
                          color: empty ? "#ccc" : "#111",
                          ...(col.type === "bool" ? s.boolDisplay : {}),
                        }}>
                          {row[col.key] || ""}
                        </div>

                        {isEdit && (
                          <input
                            ref={inputRef}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={closeEdit}
                            onKeyDown={e => {
                              if (e.key === "Enter" || e.key === "Tab") {
                                e.preventDefault();
                                closeEdit();

                                const nextCol = e.key === "Tab"
                                  ? Math.min(colIdx + 1, NUM_COLS - 1)
                                  : colIdx;
                                const nextRow = e.key === "Enter"
                                  ? Math.min(rowIdx + 1, rows.length - 1)
                                  : rowIdx;
                                setTimeout(() => openEdit(nextRow, nextCol), 0);
                              }
                              if (e.key === "Escape") {
                                setEditValue(row[col.key] ?? "");
                                setEditCell(null);
                              }
                            }}
                            onPaste={e => {
                              const text = (e.clipboardData?.getData("text") ?? "").trim();
                              if (looksLikeQR(text)) { e.preventDefault(); closeEdit(); handleQRScan(text); }
                            }}
                            style={s.cellEditor}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {toast && (
        <div style={{ ...s.toast, backgroundColor: toast.type === "success" ? "#1a7a1a" : "#c00000" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

//  styles
const s = {
  page:          { minHeight: "100vh", backgroundColor: "#f0f0f0", fontFamily: "Montserrat, serif" },
  header:        { backgroundColor: "#800000", color: "#fff", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.3)" },
  backBtn:       { background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", padding: "7px 13px", borderRadius: 4, cursor: "pointer", fontSize: 13 },
  badge:         { fontSize: 9, letterSpacing: 3, opacity: 0.6, marginBottom: 2 },
  title:         { margin: 0, fontSize: "1.2rem", fontWeight: 900, letterSpacing: 1 },
  tableWrap:     { overflowX: "auto", paddingBottom: 40, outline: "none" },
  table:         { borderCollapse: "collapse", fontSize: 12, width: "100%", backgroundColor: "#fff", userSelect: "none" },
  th:            { backgroundColor: "#800000", color: "#fff", padding: "8px 10px", border: "1px solid #6a0000", textAlign: "left", fontWeight: 700, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 10 },
  catTh:         { backgroundColor: "#600000", color: "#fff", padding: "5px 10px", border: "1px solid #500000", textAlign: "center", fontWeight: 900, fontSize: 10, letterSpacing: 2, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 11 },
  typeTh:        { backgroundColor: "#3a0000", color: "rgba(255,255,255,0.5)", padding: "3px 10px", border: "1px solid #2a0000", fontSize: 9, letterSpacing: 1, fontWeight: 400, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 9 },
  rowNumTh:      { width: 36, textAlign: "center", padding: "4px 6px" },
  td:            { padding: 0, border: "1px solid #e8e8e8", verticalAlign: "middle", cursor: "default" },
  selectedTd:    { backgroundColor: "#cce0ff", border: "1px solid #7ab0f0" },
  editTd:        { border: "2px solid #800000", padding: 0 },
  highlightCell: { backgroundColor: "#fffbe6" },
  rowEven:       { backgroundColor: "#fff" },
  rowOdd:        { backgroundColor: "#fafafa" },
  rowNumCell:    { backgroundColor: "#f0f0f0", color: "#bbb", fontSize: 10, textAlign: "center", padding: "2px 4px", border: "1px solid #e0e0e0", userSelect: "none", width: 36, minWidth: 36 },
  cellDisplay:   { padding: "6px 8px", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", minHeight: 28, lineHeight: "16px" },
  boolDisplay:   { textAlign: "center" },
  cellEditor:    { position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", outline: "none", padding: "6px 8px", fontSize: 12, fontFamily: "monospace", backgroundColor: "#fff", color: "#111", boxSizing: "border-box", zIndex: 5 },
  toast:         { position: "fixed", bottom: 24, right: 24, color: "#fff", padding: "14px 22px", borderRadius: 6, fontWeight: 700, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", zIndex: 200, fontSize: 14, maxWidth: 400 },
};