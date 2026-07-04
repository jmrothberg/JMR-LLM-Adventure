/** Pure world-bible logic — shared by adventure.html and world_bible_tests.mjs */

export function fixCommonJsonErrors(s) {
  s = s.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  let ob = 0, cb = 0, osq = 0, csq = 0;
  for (const c of s) { if (c === "{") ob++; else if (c === "}") cb++; else if (c === "[") osq++; else if (c === "]") csq++; }
  while (cb < ob) { s += "}"; cb++; }
  while (csq < osq) { s += "]"; csq++; }
  while (s.split("}").length - 1 > s.split("{").length - 1) s = s.replace(/}$/, "");
  while (s.split("]").length - 1 > s.split("[").length - 1) s = s.replace(/]$/, "");
  return s;
}

export function tryParseJson(s) {
  try { const o = JSON.parse(s); if (o && typeof o === "object") return o; } catch {}
  try { const o = JSON.parse(fixCommonJsonErrors(s)); if (o && typeof o === "object") return o; } catch {}
  return null;
}

/** Extract JSON objects from LLM text. Returns array of parsed objects. */
export function extractJsonFromText(text) {
  const results = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fenceRe.exec(text)) !== null) {
    const parsed = tryParseJson(m[1].trim());
    if (parsed) results.push(parsed);
  }
  if (results.length) return results;

  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") { if (depth === 0) start = i; depth++; }
    else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const parsed = tryParseJson(text.slice(start, i + 1));
        if (parsed) results.push(parsed);
        start = -1;
      }
    }
  }
  return results;
}

/** Helper: extract first valid JSON object from LLM output. */
export function extractFirstJson(raw) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const candidates = extractJsonFromText(cleaned);
  if (candidates.length) return candidates[0];
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}") + 1;
  if (start >= 0 && end > start) return tryParseJson(cleaned.slice(start, end));
  return null;
}

/** Map skeleton from pass 1: try several strategies (truncated JSON, prose with embedded object). */
export function extractMapSkeleton(raw, genDebugArr) {
  if (raw == null || !String(raw).trim()) return null;
  let cut = String(raw).trim();
  const brace = cut.indexOf("{");
  if (brace > 0) {
    cut = cut.slice(brace);
    if (genDebugArr) genDebugArr.push(`[world-gen detail] skeleton: stripped ${brace} chars before first {`);
  }
  let sk = extractFirstJson(cut);
  if (sk && Array.isArray(sk.rooms) && sk.rooms.length) return sk;
  const all = extractJsonFromText(cut);
  for (const obj of all) {
    if (obj && Array.isArray(obj.rooms) && obj.rooms.length) return obj;
  }
  if (genDebugArr) genDebugArr.push(`[world-gen detail] skeleton: no object with .rooms[] (${all.length} JSON object(s) found)`);
  return sk;
}

/** Render win_condition as printable text whether structured object or legacy string. */
export function winConditionText(wb) {
  if (!wb || !wb.win_condition) return "";
  const wc = wb.win_condition;
  if (typeof wc === "string") return wc;
  if (typeof wc === "object") {
    if (wc.description && String(wc.description).trim()) return String(wc.description);
    const item = (wc.required_items || [])[0];
    const loc = wc.required_location;
    if (item && loc) return `Obtain ${item} and return to ${loc}`;
    if (loc) return `Reach ${loc}`;
    return "Complete the adventure";
  }
  return String(wc);
}

/** Normalize string win_condition to structured object (mutates wb). Returns true if changed. */
export function normalizeWinCondition(wb) {
  if (!wb || typeof wb !== "object") return false;
  const rooms = (wb.locations || []).map(l => l && l.name).filter(Boolean);
  if (!rooms.length) return false;
  const firstRoom = rooms[0];
  const roomSet = new Set(rooms);

  if (typeof wb.win_condition === "string" || !wb.win_condition || typeof wb.win_condition !== "object") {
    const oldText = typeof wb.win_condition === "string" ? wb.win_condition : "Complete the adventure";
    const finalGives = (wb.puzzle_chain || []).slice().reverse().find(s => s && s.gives);
    const finalItem = (finalGives && finalGives.gives) ||
      ((wb.key_items || [])[((wb.key_items || []).length - 1)] || {}).name || null;
    wb.win_condition = {
      required_items: finalItem ? [finalItem] : [],
      required_location: firstRoom,
      description: oldText,
    };
    return true;
  }

  let changed = false;
  if (!Array.isArray(wb.win_condition.required_items)) {
    wb.win_condition.required_items = [];
    changed = true;
  }
  if (!wb.win_condition.required_location || !roomSet.has(wb.win_condition.required_location)) {
    wb.win_condition.required_location = firstRoom;
    changed = true;
  }
  if (typeof wb.win_condition.description !== "string" || !wb.win_condition.description.trim()) {
    const item = wb.win_condition.required_items[0] || "the prize";
    wb.win_condition.description = `Obtain ${item} and return to ${firstRoom}`;
    changed = true;
  }
  return changed;
}

/** Build a plain-text solution from structured bible fields (always available). */
export function synthesizeAuthorWalkthrough(wb) {
  if (!wb) return "";
  const lines = [];
  lines.push("=== How to win (auto-built from world bible) ===");
  const wcText = winConditionText(wb);
  if (wcText) lines.push(`Win: ${wcText}`);
  if (wb.main_arc) lines.push(`Story: ${wb.main_arc}`);
  if (Array.isArray(wb.objectives) && wb.objectives.length) {
    lines.push("Goals:");
    wb.objectives.forEach((o, i) => lines.push(`  ${i + 1}. ${o}`));
  }
  if (Array.isArray(wb.puzzle_chain) && wb.puzzle_chain.length) {
    lines.push("Steps (in order):");
    for (const s of wb.puzzle_chain) {
      const g = s.gives ? ` → obtain: ${s.gives}` : "";
      const u = s.unlocks != null && s.unlocks !== undefined && s.unlocks !== "" ? ` → unlocks: ${s.unlocks}` : "";
      lines.push(`  ${s.step}. ${s.action}${g}${u}`);
    }
  }
  if (Array.isArray(wb.key_items) && wb.key_items.length) {
    lines.push("Key items:");
    for (const k of wb.key_items) {
      if (k && typeof k.name === "string" && k.name) lines.push(`  - ${k.name}: ${k.purpose || ""}`);
    }
  }
  if (Array.isArray(wb.progression_hints) && wb.progression_hints.length) {
    lines.push(`Hints: ${wb.progression_hints.join(" | ")}`);
  }
  return lines.join("\n");
}

export function validateWorldBible(wb) {
  const issues = [];
  const warnings = [];
  const required = ["objectives", "locations", "key_items", "win_condition"];
  for (const f of required) {
    if (!wb[f] || (Array.isArray(wb[f]) && wb[f].length === 0)) issues.push(`Missing or empty: ${f}`);
  }
  if (wb.locations && wb.locations.length < 3) issues.push(`Too few locations (${wb.locations.length}), need at least 3`);
  if (wb.key_items && wb.key_items.length < 3) issues.push(`Too few items (${wb.key_items.length}), need at least 3`);
  if (wb.key_items) {
    for (const item of wb.key_items) {
      if (typeof item === "object" && !item.purpose) issues.push(`Item '${item.name || "?"}' has no purpose`);
    }
  }

  const roomNames = new Set();
  if (wb.locations) {
    for (const loc of wb.locations) {
      if (typeof loc === "object" && !loc.description) issues.push(`Location '${loc.name || "?"}' has no description`);
      if (loc.name) roomNames.add(loc.name);
    }

    const reachable = new Set();
    for (const loc of wb.locations) {
      if (!Array.isArray(loc.exits) || loc.exits.length === 0) {
        warnings.push(`Location '${loc.name}' has no exits`);
      } else {
        reachable.add(loc.name);
        for (const exit of loc.exits) {
          reachable.add(exit);
          if (!roomNames.has(exit)) warnings.push(`Exit '${exit}' from '${loc.name}' not in locations list`);
        }
      }
    }
    for (const name of roomNames) {
      if (!reachable.has(name)) warnings.push(`Location '${name}' is orphaned (unreachable)`);
    }
  }

  if (Array.isArray(wb.puzzle_chain)) {
    const itemNames = new Set((wb.key_items || []).map(k => (k.name || "").toLowerCase()));
    for (const step of wb.puzzle_chain) {
      if (step.gives && !itemNames.has(step.gives.toLowerCase())) {
        warnings.push(`puzzle_chain step ${step.step}: gives '${step.gives}' not in key_items`);
      }
      if (step.unlocks && roomNames.size && !roomNames.has(step.unlocks)
          && step.unlocks !== "win" && step.unlocks !== null) {
        warnings.push(`puzzle_chain step ${step.step}: unlocks '${step.unlocks}' not a known room`);
      }
    }
  } else {
    warnings.push("No puzzle_chain defined");
  }

  for (const npc of (wb.npcs || [])) {
    if (npc.location && roomNames.size && !roomNames.has(npc.location)) {
      warnings.push(`NPC '${npc.name}' location '${npc.location}' not in locations`);
    }
  }
  for (const mon of (wb.monsters || [])) {
    if (mon.location && roomNames.size && !roomNames.has(mon.location)) {
      warnings.push(`Monster '${mon.name}' location '${mon.location}' not in locations`);
    }
  }

  if (wb.item_locations && roomNames.size) {
    for (const [item, locDesc] of Object.entries(wb.item_locations)) {
      const matchesRoom = [...roomNames].some(rn => locDesc.toLowerCase().includes(rn.toLowerCase()));
      if (!matchesRoom) warnings.push(`item_locations['${item}'] doesn't clearly reference a room`);
    }
  }

  return { valid: issues.length === 0, issues: [...issues, ...warnings] };
}

/** Build synthetic puzzle_chain from items + rooms (mutates wb). Returns fix messages. */
export function buildSyntheticPuzzleChain(wb) {
  const fixes = [];
  const rooms = (wb.locations || []).map(l => l && l.name).filter(Boolean);
  const items = (wb.key_items || []).map(k => k && k.name).filter(Boolean);
  if (items.length < 2 || rooms.length < 2) return fixes;

  const firstRoom = rooms[0];
  const lastRoom = rooms[rooms.length - 1];
  const itemLocs = wb.item_locations = (wb.item_locations && typeof wb.item_locations === "object") ? wb.item_locations : {};
  const intermediateRooms = rooms.slice(0, Math.max(1, rooms.length - 1));
  const itemsForRooms = items.slice();
  const finalItem = itemsForRooms.pop();
  const synth = [];
  let stepNum = 1;

  for (let i = 0; i < itemsForRooms.length; i++) {
    const room = intermediateRooms[Math.min(i, intermediateRooms.length - 1)];
    synth.push({
      step: stepNum++,
      action: `find and take the ${itemsForRooms[i]} in ${room}`,
      gives: itemsForRooms[i],
      unlocks: null,
      location: room,
    });
  }
  if (rooms.length > 2) {
    synth.push({
      step: stepNum++,
      action: `travel deeper through the cavern toward ${lastRoom}`,
      gives: null,
      unlocks: lastRoom,
      location: rooms[rooms.length - 2],
    });
  }
  synth.push({
    step: stepNum++,
    action: `claim the ${finalItem} in ${lastRoom}`,
    gives: finalItem,
    unlocks: "win",
    location: lastRoom,
  });

  itemLocs[finalItem] = lastRoom;
  for (let i = 0; i < itemsForRooms.length; i++) {
    const room = intermediateRooms[Math.min(i, intermediateRooms.length - 1)];
    itemLocs[itemsForRooms[i]] = room;
  }
  wb.puzzle_chain = synth;
  fixes.push(`puzzle_chain: synthetic ${synth.length}-step chain built from ${items.length} items × ${rooms.length} rooms`);
  return fixes;
}

/** True when solvability gaps are chain/win related (hard floor should rebuild chain). */
export function hasChainSolvabilityGaps(gaps) {
  if (!Array.isArray(gaps) || !gaps.length) return false;
  return gaps.some(g => {
    const s = String(g).toLowerCase();
    return s.includes("puzzle_chain") || s.includes("win item") || s.includes("final chain step")
      || s.includes("never given") || s.includes("does not unlock");
  });
}

/** Force synthetic chain rebuild when solvability still fails (mutates wb). */
export function forceSyntheticChainHardFloor(wb) {
  if (!wb) return [];
  wb.puzzle_chain = [];
  const fixes = buildSyntheticPuzzleChain(wb);
  if (normalizeWinCondition(wb)) fixes.push("win_condition normalized after synthetic chain");
  return fixes;
}

/**
 * BFS-based solvability validator. Returns {ok, gaps, report}.
 * Normalizes win_condition in-place before checking.
 */
export function validateWorldBibleSolvability(wb) {
  const gaps = [];
  if (!wb || !Array.isArray(wb.locations) || !wb.locations.length) {
    return { ok: false, gaps: ["no locations"], report: "BLOCKED: no rooms" };
  }
  normalizeWinCondition(wb);

  const rooms = wb.locations.map(l => l && l.name).filter(Boolean);
  const roomSet = new Set(rooms);
  const adj = {};
  for (const loc of wb.locations) {
    if (!loc || !loc.name) continue;
    adj[loc.name] = (loc.exits || []).filter(e => roomSet.has(e));
  }
  const start = rooms[0];
  const reachable = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const r = queue.shift();
    for (const next of (adj[r] || [])) {
      if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
  }
  for (const r of rooms) {
    if (!reachable.has(r)) gaps.push(`unreachable room: ${r}`);
  }
  const winLoc = wb.win_condition && wb.win_condition.required_location;
  if (winLoc && roomSet.has(winLoc) && !reachable.has(winLoc)) {
    gaps.push(`win location not reachable: ${winLoc}`);
  }
  const itemLocs = wb.item_locations || {};
  for (const k of (wb.key_items || [])) {
    if (!k || !k.name) continue;
    if (!itemLocs[k.name]) gaps.push(`key_item '${k.name}' has no placement`);
  }
  for (const step of (wb.puzzle_chain || [])) {
    if (!step || !step.location) continue;
    if (!reachable.has(step.location)) gaps.push(`chain step ${step.step} at unreachable ${step.location}`);
  }
  const chainGives = new Set((wb.puzzle_chain || []).map(s => s && s.gives ? String(s.gives).toLowerCase() : "").filter(Boolean));
  for (const it of ((wb.win_condition && wb.win_condition.required_items) || [])) {
    if (it && !chainGives.has(String(it).toLowerCase())) {
      gaps.push(`win item '${it}' is never given by any chain step`);
    }
  }
  if ((wb.puzzle_chain || []).length < 2) {
    gaps.push(`puzzle_chain has only ${(wb.puzzle_chain || []).length} step(s) — not a playable adventure`);
  }
  const chain = wb.puzzle_chain || [];
  if (chain.length >= 2) {
    const last = chain[chain.length - 1];
    const lastRoom = rooms[rooms.length - 1];
    if (last && last.location && last.location !== lastRoom) {
      gaps.push(`final chain step is in '${last.location}' instead of last room '${lastRoom}'`);
    }
    if (last && last.unlocks !== "win") {
      gaps.push(`final chain step does not unlock "win" (got '${last.unlocks}')`);
    }
  }

  const report = gaps.length
    ? `solvability: ${gaps.length} gap(s)\n  - ` + gaps.join("\n  - ")
    : `solvability: OK (${rooms.length} rooms, ${(wb.key_items || []).length} items, ${(wb.puzzle_chain || []).length} chain steps, all reachable)`;
  return { ok: gaps.length === 0, gaps, report };
}

/** Deep-clone a bible for tests (JSON round-trip). */
export function cloneWorldBible(wb) {
  return JSON.parse(JSON.stringify(wb));
}

/** Prepare bible for validation tests: normalize + auto-repair on a clone. */
export function prepareBibleForValidation(wb) {
  const copy = cloneWorldBible(wb);
  autoRepairWorldBible(copy);
  return copy;
}

/**
 * Deterministic auto-repair — code-only fixes after generation. No LLM round-trip.
 * Returns a list of repairs applied.
 */
export function autoRepairWorldBible(wb) {
  const fixes = [];
  if (!wb || typeof wb !== "object") return fixes;
  const rooms = (wb.locations || []).map(l => l && l.name).filter(Boolean);
  if (!rooms.length) return fixes;
  const firstRoom = rooms[0];
  const lastRoom = rooms[rooms.length - 1];
  const roomSet = new Set(rooms);
  const lowerRoomMap = new Map(rooms.map(r => [r.toLowerCase(), r]));

  for (const npc of (wb.npcs || [])) {
    if (!npc || typeof npc !== "object") continue;
    if (!npc.location || !roomSet.has(npc.location)) {
      const guess = npc.location ? lowerRoomMap.get(String(npc.location).toLowerCase()) : null;
      npc.location = guess || firstRoom;
      fixes.push(`npc '${npc.name || "?"}' relocated → ${npc.location}`);
    }
  }
  for (const mon of (wb.monsters || [])) {
    if (!mon || typeof mon !== "object") continue;
    if (!mon.location || !roomSet.has(mon.location)) {
      const guess = mon.location ? lowerRoomMap.get(String(mon.location).toLowerCase()) : null;
      mon.location = guess || lastRoom;
      fixes.push(`monster '${mon.name || "?"}' relocated → ${mon.location}`);
    }
  }

  const itemLocs = wb.item_locations = (wb.item_locations && typeof wb.item_locations === "object") ? wb.item_locations : {};
  const itemLocsLower = new Map(Object.keys(itemLocs).map(k => [k.toLowerCase(), k]));
  for (const k of (wb.key_items || [])) {
    if (!k || typeof k.name !== "string" || !k.name) continue;
    const nameLower = k.name.toLowerCase();
    if (itemLocsLower.has(nameLower)) continue;
    let placedAt = null;
    for (const step of (wb.puzzle_chain || [])) {
      if (step && step.gives && String(step.gives).toLowerCase() === nameLower && step.location && roomSet.has(step.location)) {
        placedAt = step.location;
        break;
      }
    }
    if (!placedAt) placedAt = (k.name === (wb.win_condition && wb.win_condition.required_items && wb.win_condition.required_items[0])) ? lastRoom : firstRoom;
    itemLocs[k.name] = placedAt;
    fixes.push(`item '${k.name}' placed → ${placedAt}`);
  }

  if (Array.isArray(wb.puzzle_chain)) {
    const before = wb.puzzle_chain.length;
    wb.puzzle_chain = wb.puzzle_chain.filter(s => s && (!s.location || roomSet.has(s.location)));
    const after = wb.puzzle_chain.length;
    if (before !== after) fixes.push(`puzzle_chain: dropped ${before - after} step(s) with invalid location`);
  }

  if (!Array.isArray(wb.puzzle_chain) || wb.puzzle_chain.length < 3) {
    fixes.push(...buildSyntheticPuzzleChain(wb));
  }

  const itemNamesLower = new Set((wb.key_items || []).map(k => k && k.name ? k.name.toLowerCase() : "").filter(Boolean));
  if (Array.isArray(wb.puzzle_chain)) {
    for (const step of wb.puzzle_chain) {
      if (!step) continue;
      if (step.gives && !itemNamesLower.has(String(step.gives).toLowerCase())) {
        fixes.push(`chain step ${step.step}: cleared phantom gives='${step.gives}'`);
        step.gives = null;
      }
    }
  }

  if (normalizeWinCondition(wb)) {
    fixes.push(`win_condition upgraded to structured shape (room=${firstRoom})`);
  }

  return fixes;
}

/** Score a chain candidate so best-of-N can pick the winner. */
/** Normalize room names for fuzzy match (The Foo_Bar → foo bar). */
export function normalizeRoomKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize item names for fuzzy match. */
export function normalizeItemKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when game room and bible room refer to the same place. */
export function roomsMatch(a, b) {
  const ka = normalizeRoomKey(a);
  const kb = normalizeRoomKey(b);
  return ka.length > 0 && ka === kb;
}

/** Snap LLM room name to canonical locations[].name; returns raw if no good match. */
export function snapRoomToBible(rawName, wb) {
  if (!rawName || !wb) return rawName;
  const rooms = (wb.locations || []).map(l => l && l.name).filter(Boolean);
  if (!rooms.length) return rawName;
  if (rooms.includes(rawName)) return rawName;

  const rawKey = normalizeRoomKey(rawName);
  for (const canon of rooms) {
    if (normalizeRoomKey(canon) === rawKey) return canon;
  }

  let best = null;
  let bestScore = 0;
  for (const canon of rooms) {
    const canonKey = normalizeRoomKey(canon);
    if (canonKey.includes(rawKey) || rawKey.includes(canonKey)) {
      const score = Math.min(canonKey.length, rawKey.length) / Math.max(canonKey.length, rawKey.length);
      if (score > bestScore) { bestScore = score; best = canon; }
    }
    const rawTokens = new Set(rawKey.split(" ").filter(Boolean));
    const canonTokens = canonKey.split(" ").filter(Boolean);
    let overlap = 0;
    for (const t of canonTokens) if (rawTokens.has(t)) overlap++;
    if (canonTokens.length) {
      const tokenScore = overlap / Math.max(canonTokens.length, rawTokens.size || 1);
      if (overlap >= 2 && tokenScore > bestScore) { bestScore = tokenScore; best = canon; }
    }
  }
  if (best && bestScore >= 0.55) return best;
  return rawName;
}

/** Snap LLM item name to canonical key_items[].name. */
export function snapItemToBible(rawName, wb) {
  if (!rawName || !wb) return rawName;
  const items = (wb.key_items || []).map(k => k && k.name).filter(Boolean);
  if (!items.length) return rawName;
  if (items.includes(rawName)) return rawName;

  const rawKey = normalizeItemKey(rawName);
  for (const it of items) {
    if (normalizeItemKey(it) === rawKey) return it;
  }
  for (const it of items) {
    const itKey = normalizeItemKey(it);
    if (rawKey.length >= 3 && itKey.includes(rawKey)) return it;
  }
  const rawTokens = rawKey.split(" ").filter(t => t.length >= 3);
  if (rawTokens.length) {
    const matches = items.filter(it => {
      const itKey = normalizeItemKey(it);
      return rawTokens.every(t => itKey.includes(t));
    });
    if (matches.length === 1) return matches[0];
  }
  return rawName;
}

/** Merge duplicate room key (LLM alias) into canonical bible room in game state. */
export function mergeRoomAlias(state, alias, canonical) {
  if (!state || !alias || !canonical || alias === canonical) return;
  if (state.knownMap[alias]) {
    const src = state.knownMap[alias];
    if (!state.knownMap[canonical]) state.knownMap[canonical] = { exits: [], notes: "" };
    const dst = state.knownMap[canonical];
    if (src.notes && !dst.notes) dst.notes = src.notes;
    for (const ex of (src.exits || [])) {
      if (!dst.exits.includes(ex)) dst.exits.push(ex);
    }
    delete state.knownMap[alias];
  }
  for (const entry of Object.values(state.knownMap || {})) {
    if (Array.isArray(entry.exits)) {
      for (let i = 0; i < entry.exits.length; i++) {
        if (entry.exits[i] === alias) entry.exits[i] = canonical;
      }
    }
  }
  if (state.roomItems && state.roomItems[alias]) {
    if (!state.roomItems[canonical]) state.roomItems[canonical] = [];
    for (const it of state.roomItems[alias]) {
      if (!state.roomItems[canonical].includes(it)) state.roomItems[canonical].push(it);
    }
    delete state.roomItems[alias];
  }
  if (state.location === alias) state.location = canonical;
  if (state.roomImageBlobs && state.roomImageBlobs[alias]) {
    state.roomImageBlobs[canonical] = state.roomImageBlobs[alias];
    delete state.roomImageBlobs[alias];
  }
  if (Array.isArray(state.roomsWithImages) && state.roomsWithImages.includes(alias)) {
    state.roomsWithImages = state.roomsWithImages.filter(r => r !== alias);
    if (!state.roomsWithImages.includes(canonical)) state.roomsWithImages.push(canonical);
  }
}

/** Canonical room where an item is placed, or null if unresolvable prose. */
export function resolveItemPlacementRoom(itemName, wb) {
  if (!itemName || !wb) return null;
  const itemLocs = wb.item_locations || {};
  const rooms = (wb.locations || []).map(l => l && l.name).filter(Boolean);
  const roomSet = new Set(rooms);
  if (!rooms.length) return null;

  let locDesc = itemLocs[itemName];
  if (locDesc == null) {
    const keyLower = String(itemName).toLowerCase();
    for (const [k, v] of Object.entries(itemLocs)) {
      if (k.toLowerCase() === keyLower) { locDesc = v; break; }
    }
  }
  if (locDesc == null) return null;
  if (typeof locDesc !== "string") locDesc = String(locDesc);

  if (roomSet.has(locDesc)) return locDesc;
  for (const rn of rooms) {
    if (locDesc.toLowerCase().includes(rn.toLowerCase())) return rn;
  }
  const snapped = snapRoomToBible(locDesc, wb);
  return roomSet.has(snapped) ? snapped : null;
}

/** Canonical room an unlock targets, or null for falsy / "win" / unresolvable prose. */
export function resolveUnlockRoom(unlocks, wb) {
  if (!unlocks || unlocks === "win") return null;
  const rooms = (wb.locations || []).map(l => l && l.name).filter(Boolean);
  const roomSet = new Set(rooms);
  if (!rooms.length) return null;
  const raw = String(unlocks);
  if (roomSet.has(raw)) return raw;
  for (const rn of rooms) {
    if (raw.toLowerCase().includes(rn.toLowerCase())) return rn;
  }
  const snapped = snapRoomToBible(raw, wb);
  return roomSet.has(snapped) ? snapped : null;
}

/** BFS depth from locations[0]; missing rooms get depth Infinity. */
export function computeRoomDepths(wb) {
  const depths = {};
  if (!wb || !Array.isArray(wb.locations) || !wb.locations.length) return depths;
  const rooms = wb.locations.map(l => l && l.name).filter(Boolean);
  const roomSet = new Set(rooms);
  const adj = {};
  for (const loc of wb.locations) {
    if (!loc || !loc.name) continue;
    adj[loc.name] = (loc.exits || []).filter(e => roomSet.has(e));
  }
  const start = rooms[0];
  const queue = [start];
  depths[start] = 0;
  while (queue.length) {
    const r = queue.shift();
    for (const next of (adj[r] || [])) {
      if (depths[next] == null) {
        depths[next] = depths[r] + 1;
        queue.push(next);
      }
    }
  }
  return depths;
}

/** Build adjacency map and start room from a bible. */
function bibleAdjacency(wb) {
  const rooms = (wb.locations || []).map(l => l && l.name).filter(Boolean);
  const roomSet = new Set(rooms);
  const adj = {};
  for (const loc of (wb.locations || [])) {
    if (!loc || !loc.name) continue;
    adj[loc.name] = (loc.exits || []).filter(e => roomSet.has(e));
  }
  return { rooms, roomSet, adj, start: rooms[0] };
}

/** Rooms reachable given locked set and completed unlock steps (chain simulation). */
function reachableAtChainStep(adj, start, lockedRooms, unlockStepByRoom, completedThroughStep) {
  const canEnter = (room) => {
    if (!lockedRooms.has(room)) return true;
    const us = unlockStepByRoom.get(room);
    return us != null && us <= completedThroughStep;
  };
  const reachable = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const r = queue.shift();
    for (const next of (adj[r] || [])) {
      if (!canEnter(next)) continue;
      if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
  }
  return reachable;
}

/** NPC names mentioned in step action text. */
function npcsMentionedInAction(action, npcs) {
  const found = [];
  const act = String(action || "").toLowerCase();
  for (const npc of (npcs || [])) {
    if (!npc || !npc.name) continue;
    if (act.includes(String(npc.name).toLowerCase())) found.push(npc);
  }
  return found;
}

/** Effective room for a chain step (location, else gives placement, else start). */
function effectiveStepRoom(step, wb, start) {
  if (step.location) return step.location;
  if (step.gives) return resolveItemPlacementRoom(step.gives, wb) || start;
  return start;
}

/**
 * Master coherence check — simulates ideal chain playthrough.
 * Returns {ok, failures, lockedRooms, unlockStepByRoom, log}.
 */
export function simulateChainPlaythrough(wb) {
  const failures = [];
  const log = [];
  const lockedRooms = new Set();
  const unlockStepByRoom = new Map();
  if (!wb || !Array.isArray(wb.puzzle_chain) || !wb.puzzle_chain.length) {
    return { ok: false, failures: ["no puzzle_chain"], lockedRooms, unlockStepByRoom, log };
  }
  const { rooms, roomSet, adj, start } = bibleAdjacency(wb);
  if (!start) {
    return { ok: false, failures: ["no start room"], lockedRooms, unlockStepByRoom, log };
  }

  const chain = wb.puzzle_chain.slice().sort((a, b) => (a.step || 0) - (b.step || 0));
  const seenUnlocks = new Map();
  const givesCount = new Map();
  for (const step of chain) {
    if (!step || !step.gives) continue;
    const gk = String(step.gives).toLowerCase();
    givesCount.set(gk, (givesCount.get(gk) || 0) + 1);
  }
  for (const [gk, n] of givesCount) {
    if (n > 1) {
      const name = (wb.key_items || []).find(k => k && k.name && k.name.toLowerCase() === gk)?.name || gk;
      failures.push(`duplicate_gives: '${name}' given on ${n} chain steps`);
    }
  }

  const reachableFrom = (from) => {
    const out = new Set();
    if (!from || !roomSet.has(from)) return out;
    const q = [from];
    out.add(from);
    while (q.length) {
      const r = q.shift();
      for (const next of (adj[r] || [])) {
        if (!out.has(next)) { out.add(next); q.push(next); }
      }
    }
    return out;
  };

  for (const step of chain) {
    if (!step) continue;
    const unlockRoom = resolveUnlockRoom(step.unlocks, wb);
    if (unlockRoom && unlockRoom !== start) {
      lockedRooms.add(unlockRoom);
      unlockStepByRoom.set(unlockRoom, step.step);
      if (seenUnlocks.has(unlockRoom)) {
        failures.push(`duplicate_unlock: step ${step.step} and step ${seenUnlocks.get(unlockRoom)} both unlock ${unlockRoom}`);
      } else {
        seenUnlocks.set(unlockRoom, step.step);
      }
    }
  }

  const depths = computeRoomDepths(wb);

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (!step) continue;
    const stepNum = step.step != null ? step.step : i + 1;
    const priorStep = i > 0 ? (chain[i - 1].step != null ? chain[i - 1].step : i) : 0;
    const reachable = reachableAtChainStep(adj, start, lockedRooms, unlockStepByRoom, priorStep);

    const effRoom = effectiveStepRoom(step, wb, start);
    if (effRoom && roomSet.has(effRoom) && !reachable.has(effRoom)) {
      failures.push(`step ${stepNum} room '${effRoom}' not reachable`);
      log.push(`step ${stepNum}: unreachable room ${effRoom}`);
    }

    if (step.gives) {
      const placeRoom = resolveItemPlacementRoom(step.gives, wb);
      if (placeRoom && !reachable.has(placeRoom)) {
        failures.push(`step ${stepNum} gives '${step.gives}' placed in unreachable '${placeRoom}'`);
      }
      if (step.location && placeRoom && placeRoom !== step.location) {
        failures.push(`step ${stepNum} gives/placement mismatch: step at '${step.location}' but '${step.gives}' in '${placeRoom}'`);
      }
    }

    for (const npc of npcsMentionedInAction(step.action, wb.npcs)) {
      const npcRoom = npc.location ? snapRoomToBible(npc.location, wb) : null;
      if (npcRoom && roomSet.has(npcRoom) && !reachable.has(npcRoom)) {
        failures.push(`step ${stepNum} NPC '${npc.name}' not reachable (at ${npcRoom})`);
        log.push(`step ${stepNum}: NPC ${npc.name} unreachable`);
      }
    }

    const unlockRoom = resolveUnlockRoom(step.unlocks, wb);
    if (unlockRoom && step.location) {
      const rawUnlock = String(step.unlocks || "").trim();
      const exactUnlock = rawUnlock === unlockRoom || rawUnlock.toLowerCase() === unlockRoom.toLowerCase();
      if (exactUnlock && reachableFrom(step.location).has(unlockRoom)) {
        const dStep = depths[step.location] ?? 0;
        const dUnlock = depths[unlockRoom] ?? 0;
        const unlocksAdjacentFromStart = dStep === 0 && dUnlock === 1;
        const sameOrShallower = dUnlock <= dStep;
        if (unlocksAdjacentFromStart || sameOrShallower) {
          failures.push(`redundant_unlock: step ${stepNum} unlocks already-reachable '${unlockRoom}'`);
        }
      }
    }

    if (unlockRoom && step.location && depths[unlockRoom] != null && depths[step.location] != null
        && depths[unlockRoom] < depths[step.location]) {
      failures.push(`unlock_depth_inversion: step ${stepNum} unlocks shallower '${unlockRoom}' from '${step.location}'`);
    }

    if (!step.gives && !resolveUnlockRoom(step.unlocks, wb) && !npcsMentionedInAction(step.action, wb.npcs).length) {
      log.push(`step ${stepNum}: dead step (warn)`);
    }
  }

  const finalReachable = reachableAtChainStep(adj, start, lockedRooms, unlockStepByRoom,
    chain.length ? (chain[chain.length - 1].step || chain.length) : 0);
  normalizeWinCondition(wb);
  const winLoc = wb.win_condition && wb.win_condition.required_location;
  if (winLoc && roomSet.has(winLoc) && !finalReachable.has(winLoc)) {
    failures.push(`win location '${winLoc}' not reachable after chain`);
  }
  for (const it of ((wb.win_condition && wb.win_condition.required_items) || [])) {
    if (!it) continue;
    let giverReachable = false;
    for (const step of chain) {
      if (step && step.gives && String(step.gives).toLowerCase() === String(it).toLowerCase()) {
        const eff = effectiveStepRoom(step, wb, start);
        const reach = reachableAtChainStep(adj, start, lockedRooms, unlockStepByRoom,
          (step.step || 1) - 1);
        if (eff && reach.has(eff)) giverReachable = true;
      }
    }
    if (!giverReachable) failures.push(`win item '${it}' giver step not reachable`);
  }

  return { ok: failures.length === 0, failures, lockedRooms, unlockStepByRoom, log };
}

/** Coherence validator — same shape as solvability report. */
export function validateWorldBibleCoherence(wb) {
  const gaps = [];
  if (!wb) return { ok: false, gaps: ["no bible"], report: "BLOCKED: no bible" };
  const sim = simulateChainPlaythrough(wb);
  gaps.push(...sim.failures);
  const report = gaps.length
    ? `coherence: ${gaps.length} gap(s)\n  - ` + gaps.join("\n  - ")
    : `coherence: OK (${(wb.puzzle_chain || []).length} chain steps, ${sim.lockedRooms.size} gated room(s))`;
  return { ok: gaps.length === 0, gaps, report };
}

/** Deterministic coherence repair — chain is canonical. Returns fix strings. */
export function repairWorldBibleCoherence(wb) {
  const fixes = [];
  if (!wb || typeof wb !== "object") return fixes;
  const rooms = (wb.locations || []).map(l => l && l.name).filter(Boolean);
  const roomSet = new Set(rooms);
  if (!rooms.length) return fixes;
  const start = rooms[0];
  const itemLocs = wb.item_locations = (wb.item_locations && typeof wb.item_locations === "object") ? wb.item_locations : {};
  const depths = computeRoomDepths(wb);
  const chain = wb.puzzle_chain || [];

  // 1. Duplicate gives — keep last occurrence per item (win/treasure step wins).
  const lastGivesIdx = new Map();
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (!step || !step.gives) continue;
    lastGivesIdx.set(String(step.gives).toLowerCase(), i);
  }
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (!step || !step.gives) continue;
    if (lastGivesIdx.get(String(step.gives).toLowerCase()) !== i) {
      fixes.push(`chain step ${step.step} duplicate gives '${step.gives}' → null (kept on later step)`);
      step.gives = null;
    }
  }

  const unlockFirst = new Map();
  for (const step of (wb.puzzle_chain || [])) {
    if (!step) continue;
    const unlockRoom = resolveUnlockRoom(step.unlocks, wb);
    if (!unlockRoom) continue;
    if (unlockFirst.has(unlockRoom)) {
      step.unlocks = null;
      fixes.push(`chain step ${step.step} duplicate unlock '${unlockRoom}' → null`);
    } else {
      unlockFirst.set(unlockRoom, step.step);
    }
  }

  let sim = simulateChainPlaythrough(wb);
  for (const fail of sim.failures) {
    if (!fail.startsWith("redundant_unlock:")) continue;
    const m = fail.match(/step (\d+)/);
    if (!m) continue;
    const stepNum = parseInt(m[1], 10);
    const step = (wb.puzzle_chain || []).find(s => s && s.step === stepNum);
    if (step) {
      step.unlocks = null;
      fixes.push(`chain step ${stepNum} redundant unlock → null`);
    }
  }

  for (const step of (wb.puzzle_chain || [])) {
    if (!step || !step.location) continue;
    const unlockRoom = resolveUnlockRoom(step.unlocks, wb);
    if (!unlockRoom || depths[unlockRoom] == null || depths[step.location] == null) continue;
    if (depths[unlockRoom] < depths[step.location]) {
      step.unlocks = null;
      fixes.push(`chain step ${step.step} shallow unlock '${unlockRoom}' → null`);
    }
  }

  sim = simulateChainPlaythrough(wb);
  const { adj } = bibleAdjacency(wb);
  for (let i = 0; i < (wb.puzzle_chain || []).length; i++) {
    const step = wb.puzzle_chain[i];
    if (!step) continue;
    const stepNum = step.step != null ? step.step : i + 1;
    const priorStep = i > 0 ? (wb.puzzle_chain[i - 1].step != null ? wb.puzzle_chain[i - 1].step : i) : 0;
    const reachable = reachableAtChainStep(adj, start, sim.lockedRooms, sim.unlockStepByRoom, priorStep);
    const effRoom = effectiveStepRoom(step, wb, start);
    for (const npc of npcsMentionedInAction(step.action, wb.npcs)) {
      const npcRoom = npc.location ? snapRoomToBible(npc.location, wb) : null;
      if (npcRoom && roomSet.has(npcRoom) && !reachable.has(npcRoom) && effRoom && roomSet.has(effRoom)) {
        const hadEarlier = (wb.puzzle_chain || []).slice(0, i).some(s =>
          s && npcsMentionedInAction(s.action, [npc]).length);
        if (!hadEarlier) {
          npc.location = effRoom;
          fixes.push(`npc '${npc.name}' relocated → ${effRoom} (step ${stepNum})`);
        }
      }
    }
  }

  sim = simulateChainPlaythrough(wb);
  for (const fail of sim.failures) {
    if (!fail.includes("gives/placement mismatch")) continue;
    const m = fail.match(/step (\d+)/);
    if (!m) continue;
    const stepNum = parseInt(m[1], 10);
    const step = (wb.puzzle_chain || []).find(s => s && s.step === stepNum);
    if (!step || step.location) continue;
    if (!step.gives) continue;
    const giverNpc = (wb.npcs || []).find(n =>
      n && npcsMentionedInAction(step.action, [n]).length && n.location && roomSet.has(n.location));
    if (giverNpc) {
      itemLocs[step.gives] = giverNpc.location;
      fixes.push(`item_locations['${step.gives}'] → '${giverNpc.location}' (giver NPC)`);
    }
  }

  // Final placement sync after all chain edits (single pass — no overwrite races).
  for (const step of chain) {
    if (!step || !step.gives || !step.location || !roomSet.has(step.location)) continue;
    if (itemLocs[step.gives] !== step.location) {
      itemLocs[step.gives] = step.location;
      fixes.push(`item_locations['${step.gives}'] → '${step.location}' (chain-canonical)`);
    }
  }

  if (normalizeWinCondition(wb)) {
    fixes.push("win_condition synced after coherence repair");
  }

  return fixes;
}

/** Scan monster weakness prose for unique key_item match → weakness_item. */
export function deriveMonsterWeaknessItems(wb) {
  const fixes = [];
  if (!wb) return fixes;
  const items = (wb.key_items || []).map(k => k && k.name).filter(Boolean);

  const matchItemsInText = (text) => {
    const w = String(text || "").toLowerCase();
    if (!w) return [];
    const matches = [];
    for (const it of items) {
      const itLower = String(it).toLowerCase();
      if (w.includes(itLower) || w.includes(normalizeItemKey(it))) {
        matches.push(it);
        continue;
      }
      const tokens = normalizeItemKey(it).split(" ").filter(t => t.length >= 4);
      if (tokens.length && tokens.every(t => w.includes(t))) matches.push(it);
    }
    return matches;
  };

  for (const mon of (wb.monsters || [])) {
    if (!mon || typeof mon !== "object" || mon.weakness_item) continue;
    const sources = [mon.weakness, mon.drops, mon.blocks].filter(Boolean).join(" ");
    const matches = matchItemsInText(sources);
    if (matches.length === 1) {
      mon.weakness_item = matches[0];
      fixes.push(`monster '${mon.name}' weakness_item → '${matches[0]}'`);
    }
  }
  return fixes;
}

/** Ordered chain progress for gameplay — longest satisfied prefix. */
export function computeChainProgress(chain, opts = {}) {
  const { inventoryCanonical = new Set(), gameFlags = {}, explicitDone = [], wb = null } = opts;
  const explicit = new Set(Array.isArray(explicitDone) ? explicitDone : []);
  if (!Array.isArray(chain) || !chain.length) {
    return { doneCount: 0, nextStep: null };
  }

  const stepSatisfied = (step) => {
    if (!step) return false;
    if (explicit.has(step.step)) return true;
    if (step.gives && inventoryCanonical.has(step.gives)) return true;
    if (wb) {
      const unlockRoom = resolveUnlockRoom(step.unlocks, wb);
      if (unlockRoom) {
        const flagKey = String(unlockRoom).replace(/[^a-zA-Z0-9]+/g, "_") + "_unblocked";
        if (gameFlags[flagKey]) return true;
      }
    }
    return false;
  };

  const isUnobservable = (step) => {
    if (!step) return false;
    return !step.gives && !(wb && resolveUnlockRoom(step.unlocks, wb));
  };

  let doneCount = 0;
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (stepSatisfied(step)) {
      doneCount = i + 1;
    } else if (isUnobservable(step) && i + 1 < chain.length && stepSatisfied(chain[i + 1])) {
      doneCount = i + 1;
    } else {
      break;
    }
  }

  const nextStep = doneCount < chain.length ? chain[doneCount] : null;
  return { doneCount, nextStep };
}

/** Room names reachable at the start of a given chain step (for micro-repair choices). */
export function reachableRoomsAtStep(wb, stepNum) {
  const sim = simulateChainPlaythrough(wb);
  const { adj, start, rooms } = bibleAdjacency(wb);
  if (!start) return [];
  const prior = Math.max(0, (stepNum || 1) - 1);
  return rooms.filter(r => reachableAtChainStep(adj, start, sim.lockedRooms, sim.unlockStepByRoom, prior).has(r));
}

/** Cut text at last space/comma before limit; strip trailing junk. */
export function truncateAtWordBoundary(text, maxChars) {
  if (!text) return "";
  const t = String(text).trim();
  if (t.length <= maxChars) return t;
  const slice = t.slice(0, maxChars);
  const space = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf(","));
  let cut = space > 10 ? slice.slice(0, space) : slice;
  cut = cut.replace(/[,;:\-–—]+$/, "").trim();
  const orphans = /\b(and|or|with|the|a|an|of|in|on|at|to|for)$/i;
  cut = cut.replace(orphans, "").trim();
  return cut;
}

/** Keyword table for SD style phrase selection. */
export function pickSdStylePhrase(artStyle) {
  const s = String(artStyle || "").toLowerCase();
  if (s.includes("steampunk")) return "steampunk fantasy art";
  if (s.includes("gothic") || s.includes("dark fantasy") || s.includes("dark")) return "dark fantasy painting";
  if (s.includes("sci-fi") || s.includes("scifi") || s.includes("science fiction")) return "sci-fi concept art";
  if (s.includes("watercolor")) return "watercolor illustration";
  if (s.includes("noir")) return "noir illustration";
  if (s.includes("pixel")) return "pixel art";
  if (s.includes("whimsical") || s.includes("storybook")) return "storybook illustration";
  return "fantasy concept art";
}

export function scoreChainCandidate(chainObj, rooms, items, firstRoom, lastRoom, context) {
  if (!chainObj || !Array.isArray(chainObj.puzzle_chain)) return -Infinity;
  const chain = chainObj.puzzle_chain;
  if (!chain.length) return -Infinity;
  const roomSet = new Set(rooms);
  const itemSetLower = new Set(items.map(i => String(i).toLowerCase()));
  let score = 0;
  score += Math.min(chain.length, 8);
  score += chain.filter(s => s && s.location && roomSet.has(s.location)).length;
  score += chain.filter(s => s && (!s.gives || itemSetLower.has(String(s.gives).toLowerCase()))).length;
  if (chain[0] && chain[0].location === firstRoom) score += 5;
  const last = chain[chain.length - 1];
  if (last && last.location === lastRoom) score += 5;
  if (last && last.unlocks === "win") score += 5;
  if (last && last.gives && itemSetLower.has(String(last.gives).toLowerCase())) score += 3;

  const givesSeen = new Map();
  for (const step of chain) {
    if (!step || !step.gives) continue;
    const gk = String(step.gives).toLowerCase();
    givesSeen.set(gk, (givesSeen.get(gk) || 0) + 1);
  }
  for (const n of givesSeen.values()) {
    if (n > 1) score -= 3 * (n - 1);
  }

  if (context) {
    const wb = {
      locations: context.locations || rooms.map(name => ({ name, exits: context.adj?.[name] || [] })),
      item_locations: context.itemLocations || {},
      npcs: context.npcs || [],
      key_items: items.map(name => ({ name })),
      puzzle_chain: chain,
      win_condition: {},
    };
    const seenUnlocks = new Set();
    const { adj, start } = bibleAdjacency(wb);
    const depths = computeRoomDepths(wb);
    const reachableFrom = (from) => {
      const out = new Set();
      if (!from || !roomSet.has(from)) return out;
      const q = [from];
      out.add(from);
      while (q.length) {
        const r = q.shift();
        for (const next of (adj[r] || [])) {
          if (!out.has(next)) { out.add(next); q.push(next); }
        }
      }
      return out;
    };
    const lockedRooms = new Set();
    const unlockStepByRoom = new Map();
    for (const step of chain) {
      const ur = resolveUnlockRoom(step.unlocks, wb);
      if (ur && ur !== start) {
        lockedRooms.add(ur);
        unlockStepByRoom.set(ur, step.step);
      }
    }
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      if (!step) continue;
      if (step.gives) {
        const place = resolveItemPlacementRoom(step.gives, wb);
        if (place && (!step.location || place === step.location)) score += 2;
      }
      const ur = resolveUnlockRoom(step.unlocks, wb);
      if (ur && step.location) {
        if (seenUnlocks.has(ur)) score -= 2;
        else if (reachableFrom(step.location).has(ur)) {
          const dStep = depths[step.location] ?? 0;
          const dUnlock = depths[ur] ?? 0;
          if ((dStep === 0 && dUnlock === 1) || dUnlock <= dStep) score -= 2;
          else { score += 2; seenUnlocks.add(ur); }
        } else { score += 2; seenUnlocks.add(ur); }
      }
      const prior = i > 0 ? (chain[i - 1].step || i) : 0;
      const reachable = reachableAtChainStep(adj, start, lockedRooms, unlockStepByRoom, prior);
      for (const npc of npcsMentionedInAction(step.action, context.npcs)) {
        const npcRoom = npc.location ? snapRoomToBible(npc.location, wb) : null;
        if (npcRoom && roomSet.has(npcRoom) && !reachable.has(npcRoom)) score -= 3;
      }
    }
  }

  return score;
}
