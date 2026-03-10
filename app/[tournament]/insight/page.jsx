"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "../../firebaseConfig";
import { collection, doc, setDoc, onSnapshot, deleteDoc, serverTimestamp } from "firebase/firestore";

// column defs
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
const NUM_COLS = COLUMNS.length;

// helpers
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

function isRowEmpty(row) { return COLUMNS.every(c => !row[c.key]); }

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

// calc funcs 

function n(v) { return parseInt(v) || 0; }
function b(v) { return v === "1" ? 1 : 0; }

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdevP(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length);
}

function fmt(v, decimals = 2) {
  if (typeof v !== "number" || isNaN(v)) return "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(decimals);
}

function computeCalc(teamRows, allRows, team) {
  if (!teamRows.length) return null;

  const mp = teamRows.length; // matches played

  // sums
  const sumAutoClimb   = teamRows.reduce((s, r) => s + b(r.autoClimb), 0);
  const sumAutoFuel    = teamRows.reduce((s, r) => s + n(r.autoFuel), 0);
  const sumTeleopFuel  = teamRows.reduce((s, r) => s + n(r.teleopFuel), 0);
  const sumPlayDef     = teamRows.reduce((s, r) => s + b(r.playDefense), 0);
  const sumWasDef      = teamRows.reduce((s, r) => s + b(r.wasDefended), 0);
  const sumPassed      = teamRows.reduce((s, r) => s + b(r.passed), 0);
  const sumL1          = teamRows.reduce((s, r) => s + b(r.l1), 0);
  const sumL2          = teamRows.reduce((s, r) => s + b(r.l2), 0);
  const sumL3          = teamRows.reduce((s, r) => s + b(r.l3), 0);
  const sumPenalty     = teamRows.reduce((s, r) => s + b(r.penalty), 0);
  const sumDeadBot     = teamRows.reduce((s, r) => s + b(r.deadBot), 0);

  const autoFuels   = teamRows.map(r => n(r.autoFuel));
  const teleopFuels = teamRows.map(r => n(r.teleopFuel));

  // Auto
  const climbFreq     = sumAutoClimb / mp;
  // medPtsAuto & maxPtsAuto moved
  const medFuelAuto   = median(autoFuels);
  const maxFuelAuto   = Math.max(...autoFuels, 0);

  // Teleop
  const medFuelTeleop = median(teleopFuels);
  const maxFuelTeleop = Math.max(...teleopFuels, 0);
  const fuelStdev     = stdevP(teleopFuels);
  const defenseFreq   = sumPlayDef / mp;

  // Endgame
  const pctL1         = sumL1 / mp;
  const pctL2         = sumL2 / mp;
  const pctL3         = sumL3 / mp;
  const deadBotFreq   = sumDeadBot / mp;
  const passedFreq    = sumPassed / mp;

  // match roster
  const sortedTeamRows = [...teamRows].sort((a, b) => n(a.matchNumber) - n(b.matchNumber));

  const matchRosters = sortedTeamRows.map(row => {
    const matchNum    = row.matchNumber;
    const myAlliance  = row.alliance;  
 
    const matchEntries = allRows.filter(r => r.matchNumber === matchNum && r.teamNumber !== team);

    const allies = matchEntries.filter(r => r.alliance === myAlliance).map(r => r.teamNumber);
    const opps   = matchEntries.filter(r => r.alliance !== myAlliance).map(r => r.teamNumber);
    const others = matchEntries.map(r => r.teamNumber);

    return { matchNum, others, allies, opps };
  });

 
  const autoPPG = sortedTeamRows.map(row => ({
    matchNum: row.matchNumber,
    points: (b(row.autoClimb) * 15) + n(row.autoFuel),
  }));

  // const sumAutoPPG = autoPPG.reduce((s, r) => s + r.points, 0);

  // auto ppg stuff 
  const medPtsAuto = median(autoPPG.map(r => r.points));
  const maxPtsAuto  = Math.max(...autoPPG.map(r => r.points), 0);

  // Undefended fuel median
  const undefendedFuels = teamRows.filter(r => b(r.wasDefended) === 0).map(r => n(r.teleopFuel));
  const undefendedFuelMedian = median(undefendedFuels);
  const undefendedCount = undefendedFuels.length;

  return {
    mp,
    sums: { sumAutoClimb, sumAutoFuel, sumTeleopFuel, sumPlayDef, sumWasDef, sumPassed, sumL1, sumL2, sumL3, sumPenalty, sumDeadBot },
    auto: { climbFreq, medPtsAuto, maxPtsAuto, medFuelAuto, maxFuelAuto },
    teleop: { medFuelTeleop, maxFuelTeleop, fuelStdev, defenseFreq },
    endgame: { pctL1, pctL2, pctL3, deadBotFreq, passedFreq },
    autoPPG,
    undefendedFuelMedian,
    undefendedCount,
    matchRosters,
  };
}

export default function InsightPage() {
  const { tournament } = useParams();
  const router = useRouter();

  const [activeTab, setActiveTab]       = useState("raw");
  const [allRows, setAllRows]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [toast, setToast]               = useState(null);

  // calculated data adjustable bar
  const [splitPct, setSplitPct]     = useState(45);
  const splitDragging               = useRef(false);

  const onDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    splitDragging.current = true;
    const onMove = (ev) => {
      if (!splitDragging.current) return;
      const container = document.getElementById("calc-split-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(Math.max(pct, 20), 80));
    };
    const onUp = () => { splitDragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
  }, []);

  // Raw data
  const [sel, setSel]               = useState(null);
  const [editCell, setEditCell]     = useState(null);
  const [editValue, setEditValue]   = useState("");
  const inputRef                    = useRef(null);
  const tableWrapRef                = useRef(null);
  const isDragging                  = useRef(false);
  const saveTimers                  = useRef({});

  // load data + listen to updates
  useEffect(() => {
    if (!tournament) return;
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "tournaments", tournament, "raw_matches"),
      (snapshot) => {
        const loaded = [];
        snapshot.forEach(d => {
          if (d.id === "_init") return;
          loaded.push(firestoreToRow(d.id, d.data()));
        });
        loaded.sort((a, b) => {
          const m = (parseInt(a.matchNumber) || 0) - (parseInt(b.matchNumber) || 0);
          return m !== 0 ? m : (parseInt(a.teamNumber) || 0) - (parseInt(b.teamNumber) || 0);
        });
        setAllRows(loaded);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        showToast("error", "Failed to load data.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tournament]);

  const teamList = [...new Set(allRows.map(r => r.teamNumber).filter(Boolean))]
    .sort((a, b) => parseInt(a) - parseInt(b));

  const teamRows = selectedTeam
    ? allRows.filter(r => r._docId?.includes(`_t${selectedTeam}`) || r.teamNumber === selectedTeam)
    : [];

  const calcData = useMemo(() => {
    if (!selectedTeam || !teamRows.length) return null;
    return computeCalc(teamRows, allRows, selectedTeam);
  }, [selectedTeam, allRows, teamRows.length]);

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const saveRow = useCallback((row) => {
    const team = row.teamNumber?.trim(), match = row.matchNumber?.trim();
    if (!team || !match) return;
    const docId = `m${match}_t${team}`;
    clearTimeout(saveTimers.current[docId]);
    saveTimers.current[docId] = setTimeout(async () => {
      try {
        await setDoc(doc(db, "tournaments", tournament, "raw_matches", docId), rowToFirestore(row));
        showToast("success", `✓ Saved m${match}_t${team}`);
      } catch (err) {
        console.error(err);
        showToast("error", "Save failed.");
      }
    }, 600);
  }, [tournament]);

  const deleteRowDoc = useCallback(async (docId) => {
    if (!docId) return;
    try { await deleteDoc(doc(db, "tournaments", tournament, "raw_matches", docId)); }
    catch (err) { console.error(err); }
  }, [tournament]);

  // auto save
  const calcSaveTimer = useRef(null);
  useEffect(() => {
    if (!selectedTeam || !calcData || !tournament) return;
    clearTimeout(calcSaveTimer.current);
    calcSaveTimer.current = setTimeout(async () => {
      try {
        const payload = {
          team: selectedTeam,
          matchesPlayed: calcData.mp,
          sums: calcData.sums,
          auto: calcData.auto,
          teleop: calcData.teleop,
          endgame: calcData.endgame,
          updatedAt: serverTimestamp(),
        };
        await setDoc(
          doc(db, "tournaments", tournament, "calculated", `t${selectedTeam}_calculated`),
          payload
        );
      } catch (err) {
        console.error("Auto-save calculated failed:", err);
      }
    }, 800);
    return () => clearTimeout(calcSaveTimer.current);
  }, [calcData, selectedTeam, tournament]);

  // edit cell handlers
  const commitEdit = useCallback((rowDocId, colKey, value) => {
    setAllRows(prev => prev.map(r => {
      if (r._docId !== rowDocId) return r;
      const newRow = { ...r, [colKey]: value };
      if (colKey === "teamNumber" || colKey === "matchNumber") {
        const newDocId = `m${newRow.matchNumber}_t${newRow.teamNumber}`;
        if (newDocId !== rowDocId && r._docId) deleteRowDoc(r._docId);
        newRow._docId = newDocId;
      }
      if (isRowEmpty(newRow)) {
        if (newRow._docId) deleteRowDoc(newRow._docId);
        return null;
      }
      saveRow(newRow);
      return newRow;
    }).filter(Boolean));
  }, [saveRow, deleteRowDoc]);

  const openEdit = useCallback((rowDocId, colIdx) => {
    const col = COLUMNS[colIdx];
    const row = teamRows.find(r => r._docId === rowDocId);
    setEditCell({ rowDocId, col: colIdx });
    setEditValue(row?.[col.key] ?? "");
    const ri = teamRows.findIndex(r => r._docId === rowDocId);
    setSel({ r1: ri, c1: colIdx, r2: ri, c2: colIdx });
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
  }, [teamRows]);

  const closeEdit = useCallback(() => {
    if (!editCell) return;
    commitEdit(editCell.rowDocId, COLUMNS[editCell.col].key, editValue);
    setEditCell(null);
  }, [editCell, editValue, commitEdit]);

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

  const handleCellDoubleClick = useCallback((rowDocId, colIdx) => {
    openEdit(rowDocId, colIdx);
  }, [openEdit]);

  useEffect(() => {
    const onDown = (e) => {
      if (!e.target.closest("[data-table]")) { closeEdit(); setSel(null); }
    };
    const onUp = () => { isDragging.current = false; };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("mouseup", onUp); };
  }, [closeEdit]);

  const handleTableKeyDown = useCallback((e) => {
    if (editCell) return;
    if (!sel) return;
    const n = normSel(sel);

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setAllRows(prev => {
        const updated = prev.map((row) => {
          const teamRowIdx = teamRows.findIndex(tr => tr._docId === row._docId);
          if (teamRowIdx < n.r1 || teamRowIdx > n.r2) return row;
          const newRow = { ...row };
          COLUMNS.forEach((col, ci) => {
            if (ci >= n.c1 && ci <= n.c2) newRow[col.key] = "";
          });
          if (isRowEmpty(newRow)) { if (newRow._docId) deleteRowDoc(newRow._docId); return null; }
          saveRow(newRow);
          return newRow;
        }).filter(Boolean);
        return updated;
      });
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      const tsv = [];
      for (let r = n.r1; r <= n.r2; r++) {
        const row = teamRows[r];
        if (!row) continue;
        const rowVals = [];
        for (let c = n.c1; c <= n.c2; c++) rowVals.push(row[COLUMNS[c].key] ?? "");
        tsv.push(rowVals.join("\t"));
      }
      navigator.clipboard?.writeText(tsv.join("\n"));
      showToast("success", `Copied ${n.r2 - n.r1 + 1} row(s)`);
      return;
    }

    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)) {
      e.preventDefault();
      setSel(prev => {
        if (!prev) return prev;
        let { r2, c2 } = prev;
        if (e.key === "ArrowUp")    r2 = Math.max(0, r2 - 1);
        if (e.key === "ArrowDown")  r2 = Math.min(teamRows.length - 1, r2 + 1);
        if (e.key === "ArrowLeft")  c2 = Math.max(0, c2 - 1);
        if (e.key === "ArrowRight") c2 = Math.min(NUM_COLS - 1, c2 + 1);
        return { r1: r2, c1: c2, r2, c2 };
      });
      return;
    }

    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      const row = teamRows[n.r1];
      if (row) openEdit(row._docId, n.c1);
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const row = teamRows[n.r1];
      if (row) { openEdit(row._docId, n.c1); setEditValue(e.key); }
    }
  }, [editCell, sel, teamRows, deleteRowDoc, saveRow, openEdit]);

  const categoryCounts = CATEGORIES.map(cat => ({
    cat, count: COLUMNS.filter(c => c.category === cat).length,
  }));

  // raw data table
  const renderRawTable = () => (
    <div
      ref={tableWrapRef}
      data-table
      tabIndex={0}
      style={{ outline: "none", overflowX: "auto", flex: 1 }}
      onKeyDown={handleTableKeyDown}
      onMouseLeave={() => { isDragging.current = false; }}
    >
      <table style={s.table} cellSpacing={0} cellPadding={0}>
        <thead style={s.thead}>
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
          {teamRows.map((row, rowIdx) => (
            <tr key={row._docId} style={rowIdx % 2 === 0 ? s.rowEven : s.rowOdd}>
              <td style={s.rowNumCell}>{rowIdx + 1}</td>
              {COLUMNS.map((col, colIdx) => {
                const isEdit     = editCell?.rowDocId === row._docId && editCell?.col === colIdx;
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
                    onMouseUp={() => { isDragging.current = false; }}
                    onDoubleClick={() => handleCellDoubleClick(row._docId, colIdx)}
                  >
                    <div style={{ ...s.cellDisplay, color: "#111", ...(col.type === "bool" ? s.boolDisplay : {}) }}>
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
                            const nextCol = e.key === "Tab" ? Math.min(colIdx + 1, NUM_COLS - 1) : colIdx;
                            const nextRowDoc = teamRows[e.key === "Enter" ? Math.min(rowIdx + 1, teamRows.length - 1) : rowIdx]?._docId;
                            if (nextRowDoc) setTimeout(() => openEdit(nextRowDoc, nextCol), 0);
                          }
                          if (e.key === "Escape") { setEditValue(row[col.key] ?? ""); setEditCell(null); }
                        }}
                        style={s.cellEditor}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // calculated tab
  const renderCalcTab = () => {
    if (!selectedTeam) return (
      <div style={s.emptyState}><p>Select a team from the sidebar to view calculated data.</p></div>
    );
    if (!calcData) return (
      <div style={s.emptyState}><p>No match data recorded for Team {selectedTeam}.</p></div>
    );

    const { mp, sums, auto, teleop, endgame, autoPPG, undefendedFuelMedian, undefendedCount, matchRosters } = calcData;
    const maxRosterLen  = Math.max(...matchRosters.map(r => r.others.length), 0);
    const maxAllies     = 2;
    const maxOpps       = 3;

    const StatRow = ({ label, value, highlight }) => (
      <tr style={highlight ? { backgroundColor: "#fffbe6" } : {}}>
        <td style={cs.statLabel}>{label}</td>
        <td style={cs.statValue}>{value}</td>
      </tr>
    );

    const SectionHeader = ({ label, color }) => (
      <tr>
        <td colSpan={2} style={{ ...cs.sectionHeader, backgroundColor: color || "#f0c000", color: "#111" }}>
          {label}
        </td>
      </tr>
    );

    return (
      <div id="calc-split-container" style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* left calculated data*/}
        <div style={{ ...cs.statsPanel, width: `${splitPct}%`, flex: "none" }}>
          <div style={cs.panelHeader}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, color: "#800000" }}>Team {selectedTeam}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{mp} match{mp !== 1 ? "es" : ""} found</div>
            </div>
          </div>
          <div style={{ overflowY: "auto", overflowX: "hidden", flex: 1, padding: 16 }}>
            <div style={{ columns: "220px auto", columnGap: 16 }}>

              {/* Sum Totals */}
              <table style={{ ...cs.table, breakInside: "avoid", marginBottom: 16, display: "table" }} cellSpacing={0}>
                <tbody>
                  <tr><td colSpan={2} style={{ ...cs.sectionHeader, backgroundColor: "#800000", color: "#fff" }}>SUM TOTALS</td></tr>
                  <StatRow label="Auto Climb (total)"   value={sums.sumAutoClimb} />
                  <StatRow label="Auto Fuel (total)"    value={sums.sumAutoFuel} />
                  <StatRow label="Play Defense (total)" value={sums.sumPlayDef} />
                  <StatRow label="Was Defended (total)" value={sums.sumWasDef} />
                  <StatRow label="Passed (total)"       value={sums.sumPassed} />
                  <StatRow label="Teleop Fuel (total)"  value={sums.sumTeleopFuel} />
                  <StatRow label="L1 (total)"           value={sums.sumL1} />
                  <StatRow label="L2 (total)"           value={sums.sumL2} />
                  <StatRow label="L3 (total)"           value={sums.sumL3} />
                  <StatRow label="Penalty (total)"      value={sums.sumPenalty} />
                  <StatRow label="Dead Bot (total)"     value={sums.sumDeadBot} />
                </tbody>
              </table>

              {/* Auto */}
              <table style={{ ...cs.table, breakInside: "avoid", marginBottom: 16, display: "table" }} cellSpacing={0}>
                <tbody>
                  <SectionHeader label="AUTO" color="#f0c000" />
                  <StatRow label="Climb Frequency"  value={fmt(auto.climbFreq)} />
                  <StatRow label="Median Pts Auto"  value={fmt(auto.medPtsAuto)} />
                  <StatRow label="Max Pts Auto"     value={fmt(auto.maxPtsAuto)} />
                  <StatRow label="Median Fuel Auto" value={fmt(auto.medFuelAuto)} />
                  <StatRow label="Max Fuel Auto"    value={fmt(auto.maxFuelAuto, 0)} />
                </tbody>
              </table>

              {/* Teleop */}
              <table style={{ ...cs.table, breakInside: "avoid", marginBottom: 16, display: "table" }} cellSpacing={0}>
                <tbody>
                  <SectionHeader label="TELEOP" color="#5b9bd5" />
                  <StatRow label="Median Fuel Teleop" value={fmt(teleop.medFuelTeleop)} />
                  <StatRow label="Max Fuel Teleop"    value={fmt(teleop.maxFuelTeleop, 0)} />
                  <StatRow label="Fuel STDEV"         value={fmt(teleop.fuelStdev)} />
                  <StatRow label="Defense Frequency"  value={fmt(teleop.defenseFreq)} />
                </tbody>
              </table>

              {/* Endgame */}
              <table style={{ ...cs.table, breakInside: "avoid", marginBottom: 16, display: "table" }} cellSpacing={0}>
                <tbody>
                  <SectionHeader label="ENDGAME" color="#70ad47" />
                  <StatRow label="% L1"               value={fmt(endgame.pctL1)} />
                  <StatRow label="% L2"               value={fmt(endgame.pctL2)} />
                  <StatRow label="% L3"               value={fmt(endgame.pctL3)} />
                  <StatRow label="Dead Bot Frequency" value={fmt(endgame.deadBotFreq)} />
                  <StatRow label="Passed Frequency"   value={fmt(endgame.passedFreq)} />
                </tbody>
              </table>

              {/* Undefended Fuel Median */}
              <table style={{ ...cs.table, breakInside: "avoid", marginBottom: 16, display: "table" }} cellSpacing={0}>
                <tbody>
                  <SectionHeader label="UNDEFENDED" color="#6a5acd" />
                  <StatRow label="Undefended Fuel Median" value={undefendedCount > 0 ? fmt(undefendedFuelMedian) : "—"} />
                </tbody>
              </table>

              {/* Auto PPG */}
              <table style={{ ...cs.table, breakInside: "avoid", marginBottom: 16, display: "table" }} cellSpacing={0}>
                <tbody>
                  <SectionHeader label="AUTO PPG" color="#b07d2a" />
                  <tr>
                    <td style={{ ...cs.statLabel, fontWeight: 700, color: "#800000" }}>Match #</td>
                    <td style={{ ...cs.statValue, fontWeight: 700, color: "#800000" }}>Points</td>
                  </tr>
                  {autoPPG.map(({ matchNum, points }) => (
                    <StatRow key={matchNum} label={`Match ${matchNum}`} value={points} />
                  ))}
                </tbody>
              </table>

            </div>
          </div>
        </div>

        {/* divider */}
        <div
          onMouseDown={onDividerMouseDown}
          style={{ width: 5, flexShrink: 0, cursor: "col-resize", backgroundColor: "#e0e0e0", transition: "background 0.1s" }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = "#800000"}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = "#e0e0e0"}
        />

        {/* right - roster panel stuff */}
        <div style={{ ...cs.rosterPanel, flex: 1, minWidth: 0 }}>
          <div style={{ overflow: "auto", flex: 1, width: "100%" }}>

            {/* Other Robots in Match */}
            <div style={cs.rosterSection}>
              <div style={cs.rosterTitle}>Other Robots in Match</div>
              <table style={{ ...cs.rosterTable, width: "100%" }} cellSpacing={0}>
                <thead>
                  <tr>
                    <th style={cs.rosterTh}>Match #</th>
                    <th style={cs.rosterTh}>Our Team</th>
                    {Array.from({ length: maxRosterLen }, (_, i) => (
                      <th key={i} style={cs.rosterTh}>Robot {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matchRosters.map((mr, i) => (
                    <tr key={mr.matchNum} style={i % 2 === 0 ? { backgroundColor: "#fff" } : { backgroundColor: "#f9f9f9" }}>
                      <td style={cs.rosterTd}>{mr.matchNum}</td>
                      <td style={{ ...cs.rosterTd, fontWeight: 700, color: "#800000" }}>{selectedTeam}</td>
                      {mr.others.map((t, j) => <td key={j} style={cs.rosterTd}>{t}</td>)}
                      {Array.from({ length: maxRosterLen - mr.others.length }, (_, j) => <td key={`e${j}`} style={cs.rosterTd}></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Allies */}
            <div style={{ ...cs.rosterSection, marginTop: 24 }}>
              <div style={{ ...cs.rosterTitle, backgroundColor: "#1a486e" }}>Allies</div>
              <table style={{ ...cs.rosterTable, width: "100%" }} cellSpacing={0}>
                <thead>
                  <tr>
                    <th style={cs.rosterTh}>Match #</th>
                    {Array.from({ length: maxAllies }, (_, i) => (
                      <th key={i} style={cs.rosterTh}>Ally {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matchRosters.map((mr, i) => (
                    <tr key={mr.matchNum} style={i % 2 === 0 ? { backgroundColor: "#f0fff0" } : { backgroundColor: "#e6ffe6" }}>
                      <td style={cs.rosterTd}>{mr.matchNum}</td>
                      {mr.allies.map((t, j) => <td key={j} style={cs.rosterTd}>{t}</td>)}
                      {Array.from({ length: maxAllies - mr.allies.length }, (_, j) => <td key={`e${j}`} style={cs.rosterTd}></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Opponents */}
            <div style={{ ...cs.rosterSection, marginTop: 24 }}>
              <div style={{ ...cs.rosterTitle, backgroundColor: "#8b0000" }}>Opponents</div>
              <table style={{ ...cs.rosterTable, width: "100%" }} cellSpacing={0}>
                <thead>
                  <tr>
                    <th style={cs.rosterTh}>Match #</th>
                    {Array.from({ length: maxOpps }, (_, i) => (
                      <th key={i} style={cs.rosterTh}>Opp {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matchRosters.map((mr, i) => (
                    <tr key={mr.matchNum} style={i % 2 === 0 ? { backgroundColor: "#fff5f5" } : { backgroundColor: "#ffebeb" }}>
                      <td style={cs.rosterTd}>{mr.matchNum}</td>
                      {mr.opps.map((t, j) => <td key={j} style={cs.rosterTd}>{t}</td>)}
                      {Array.from({ length: maxOpps - mr.opps.length }, (_, j) => <td key={`e${j}`} style={cs.rosterTd}></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>

      </div>
    );
  };

  // render
  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={() => router.push(`/${tournament}`)} style={s.backBtn}>← Back</button>
        <div>
          <div style={s.badge}>INSIGHT</div>
          <h1 style={s.title}>{tournament}</h1>
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", textAlign: "right" }}>
          {loading ? "Loading..." : `${allRows.length} entries · ${teamList.length} teams`}
        </div>
      </div>

      <div style={s.tabBar}>
        <button onClick={() => setActiveTab("raw")}  style={s.tab(activeTab === "raw")}>Raw Data</button>
        <button onClick={() => setActiveTab("calc")} style={s.tab(activeTab === "calc")}>Calculated Data</button>

        {/* example tab */}
        <button onClick={() => setActiveTab("example")} style={s.tab(activeTab === "example")}>Example Data</button>
      </div>

      {/* selected team */}
      <div style={s.body}>
        <div style={s.sidebar}>
          <div style={s.sidebarHeader}>TEAMS</div>
          {loading ? (
            <p style={{ color: "#999", padding: "12px", fontSize: 13 }}>Loading...</p>
          ) : teamList.length === 0 ? (
            <p style={{ color: "#aaa", padding: "12px", fontSize: 13, fontStyle: "italic" }}>No data yet.</p>
          ) : teamList.map(team => (
            <button key={team} onClick={() => { setSelectedTeam(team); setSel(null); setEditCell(null); }}
              style={s.teamBtn(selectedTeam === team)}>
              Team {team}
            </button>
          ))}
        </div>

        {/* tab content */}
        {activeTab === "raw" && (
          <div style={s.tableArea}>
            {!selectedTeam ? (
              <div style={s.emptyState}><p>Select a team to view their match data.</p></div>
            ) : (
              <>
                <div style={s.tableHeader}>
                  <span style={{ fontWeight: 700, color: "#800000", fontSize: 15 }}>Team {selectedTeam}</span>
                  <span style={{ color: "#999", fontSize: 12 }}>{teamRows.length} match{teamRows.length !== 1 ? "es" : ""} found</span>
                </div>
                {renderRawTable()}
              </>
            )}
          </div>
        )}

        {activeTab === "calc" && (
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            {renderCalcTab()}
          </div>
        )}

        {/* example tab */}
        {activeTab === "example" && (
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <div style={s.emptyState}><p>// todo</p></div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ ...s.toast, backgroundColor: toast.type === "success" ? "#1a7a1a" : "#c00000" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// styles
const s = {
  page:          { minHeight: "100vh", backgroundColor: "#f0f0f0", fontFamily: "Montserrat, serif" },
  header:        { backgroundColor: "#800000", color: "#fff", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" },
  backBtn:       { background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", padding: "7px 13px", borderRadius: 4, cursor: "pointer", fontSize: 13 },
  badge:         { fontSize: 9, letterSpacing: 3, opacity: 0.6, marginBottom: 2 },
  title:         { margin: 0, fontSize: "1.2rem", fontWeight: 900, letterSpacing: 1 },
  tabBar:        { backgroundColor: "#800000", padding: "0 24px", display: "flex", gap: 4, borderTop: "1px solid rgba(255,255,255,0.15)" },
  tab:           (active) => ({ padding: "10px 22px", cursor: "pointer", fontWeight: 700, fontSize: 13, backgroundColor: active ? "#fff" : "transparent", color: active ? "#800000" : "rgba(255,255,255,0.75)", border: "none", borderRadius: "4px 4px 0 0", letterSpacing: 0.5, transition: "all 0.12s ease" }),
  body:          { display: "flex", height: "calc(100vh - 100px)" },
  sidebar:       { width: 200, flexShrink: 0, backgroundColor: "#fff", borderRight: "1px solid #e0e0e0", overflowY: "auto", padding: "12px 0" },
  sidebarHeader: { fontSize: 10, fontWeight: 900, letterSpacing: 3, color: "#800000", padding: "4px 16px 10px", borderBottom: "2px solid #800000", marginBottom: 8 },
  teamBtn:       (active) => ({ display: "block", width: "100%", padding: "11px 16px", textAlign: "left", backgroundColor: active ? "#800000" : "transparent", color: active ? "#fff" : "#333", border: "none", cursor: "pointer", fontWeight: active ? 700 : 400, fontSize: 13, transition: "all 0.1s ease", borderLeft: active ? "3px solid #fff" : "3px solid transparent" }),
  tableArea:     { flex: 1, overflow: "auto", backgroundColor: "#fff", display: "flex", flexDirection: "column" },
  tableHeader:   { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "2px solid #800000", flexShrink: 0, backgroundColor: "#fff" },
  emptyState:    { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#bbb", fontStyle: "italic" },
  table:         { borderCollapse: "collapse", fontSize: 12, width: "100%", backgroundColor: "#fff", userSelect: "none" },
  thead:         { position: "sticky", top: 0, zIndex: 10 },
  th:            { backgroundColor: "#800000", color: "#fff", padding: "8px 10px", border: "1px solid #6a0000", textAlign: "left", fontWeight: 700, whiteSpace: "nowrap" },
  catTh:         { backgroundColor: "#600000", color: "#fff", padding: "5px 10px", border: "1px solid #500000", textAlign: "center", fontWeight: 900, fontSize: 10, letterSpacing: 2, whiteSpace: "nowrap" },
  typeTh:        { backgroundColor: "#3a0000", color: "rgba(255,255,255,0.5)", padding: "3px 10px", border: "1px solid #2a0000", fontSize: 9, letterSpacing: 1, fontWeight: 400, whiteSpace: "nowrap" },
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

// calculated tab styles
const cs = {
  statsPanel:    { borderRight: "1px solid #e0e0e0", backgroundColor: "#fff", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 },
  panelHeader:   { padding: "16px 20px", borderBottom: "2px solid #800000", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 },
  table:         { borderCollapse: "collapse", width: "100%", fontSize: 13 },
  sectionHeader: { padding: "6px 12px", fontWeight: 900, fontSize: 10, letterSpacing: 2, textTransform: "uppercase" },
  statLabel:     { padding: "6px 12px", color: "#444", borderBottom: "1px solid #f0f0f0", width: "65%" },
  statValue:     { padding: "6px 12px", color: "#111", fontFamily: "monospace", fontWeight: 700, borderBottom: "1px solid #f0f0f0", textAlign: "right" },
  rosterPanel:   { width: 380, flexShrink: 0, backgroundColor: "#fafafa", display: "flex", flexDirection: "column", overflow: "hidden", padding: "20px" },
  rosterSection: {},
  rosterTitle:   { backgroundColor: "#333", color: "#fff", padding: "6px 14px", fontWeight: 900, fontSize: 11, letterSpacing: 2, borderRadius: "4px 4px 0 0", display: "inline-block", marginBottom: 0 },
  rosterTable:   { borderCollapse: "collapse", fontSize: 12, backgroundColor: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", width: "100%" },
  rosterTh:      { backgroundColor: "#444", color: "#fff", padding: "6px 14px", textAlign: "left", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap", border: "1px solid #333" },
  rosterTd:      { padding: "6px 14px", border: "1px solid #e0e0e0", fontFamily: "monospace", fontSize: 12, color: "#111" },
};