/**
 * Shared world-bible unit tests — runs in browser (debug panel) and Node (CI).
 */
import {
  extractFirstJson,
  extractMapSkeleton,
  validateWorldBible,
  validateWorldBibleSolvability,
  validateWorldBibleCoherence,
  autoRepairWorldBible,
  repairWorldBibleCoherence,
  prepareBibleForValidation,
  cloneWorldBible,
  scoreChainCandidate,
  normalizeWinCondition,
  hasChainSolvabilityGaps,
  snapRoomToBible,
  snapItemToBible,
  roomsMatch,
  mergeRoomAlias,
  normalizeItemToken,
  splitItemList,
  matchItem,
  playerHasItem,
  itemPresentInRoom,
  itemsTakenFromLocation,
  stripTakenItemsFromDescription,
  formatRoomPresence,
  npcGiftAlreadyReceived,
  mechanicAlreadyApplied,
  isRiddleSolved,
  markRiddleSolved,
  markMechanicApplied,
  riddleFlagKey,
  mechanicFlagKey,
  matchExit,
  matchMechanicAction,
  matchChainStep,
  flagKeyFromName,
  simulateChainPlaythrough,
  computeChainProgress,
  deriveMonsterWeaknessItems,
  truncateAtWordBoundary,
  pickSdStylePhrase,
  buildSyntheticPuzzleChain,
} from "./world_bible_logic.mjs";

/** Known fixture paths (relative to browser_adventure/). */
export const FIXTURE_PATHS = [
  "default_cave.json",
];

function mkMinimalBible(overrides = {}) {
  return {
    objectives: ["Explore", "Find key", "Win"],
    locations: [
      { name: "Start", description: "Entry", exits: ["Mid"] },
      { name: "Mid", description: "Middle", exits: ["Start", "End"] },
      { name: "End", description: "Treasure room", exits: ["Mid"] },
    ],
    key_items: [
      { name: "lantern", purpose: "lights dark paths" },
      { name: "key", purpose: "opens the vault" },
      { name: "gem", purpose: "the treasure" },
    ],
    item_locations: { lantern: "Start", key: "Mid", gem: "End" },
    puzzle_chain: [],
    win_condition: "Get the gem",
    main_arc: "A short test adventure",
    ...overrides,
  };
}

/** Xylos-style broken bible from a real generation run (inline fixture). */
function mkXylosBrokenBible() {
  return mkMinimalBible({
    locations: [
      { name: "Start Chamber", description: "Entry hall", exits: ["Grand Concourse", "Deep Vault"] },
      { name: "Grand Concourse", description: "Wide hall", exits: ["Start Chamber", "Lyra's Sanctum"] },
      { name: "Lyra's Sanctum", description: "Oracle chamber", exits: ["Grand Concourse"] },
      { name: "Deep Vault", description: "Treasure room", exits: ["Start Chamber"] },
    ],
    key_items: [
      { name: "Glyphic Cipher Disk", purpose: "decrypts passages" },
      { name: "Lumina Shard", purpose: "lights the way" },
      { name: "Vault Key", purpose: "opens vault" },
    ],
    item_locations: {
      "Glyphic Cipher Disk": "Deep Vault",
      "Lumina Shard": "Grand Concourse",
      "Vault Key": "Deep Vault",
    },
    npcs: [{ name: "Lyra", location: "Lyra's Sanctum", personality: "oracle", provides: "guidance" }],
    puzzle_chain: [
      { step: 1, action: "take Glyphic Cipher Disk at Start Chamber", gives: "Glyphic Cipher Disk", unlocks: null, location: "Start Chamber" },
      { step: 2, action: "unlock Grand Concourse", gives: null, unlocks: "Grand Concourse", location: "Start Chamber" },
      { step: 3, action: "seek Lyra's guidance", gives: null, unlocks: "Lyra's Sanctum", location: "Grand Concourse" },
      { step: 4, action: "claim Vault Key", gives: "Vault Key", unlocks: "win", location: "Deep Vault" },
    ],
    win_condition: { required_items: ["Vault Key"], required_location: "Start Chamber", description: "Win" },
  });
}

function runCase(name, fn) {
  try {
    const detail = fn();
    return { name, pass: true, detail: detail || "" };
  } catch (e) {
    return { name, pass: false, detail: e.message || String(e) };
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

/**
 * Run all regression + live tests.
 * @param {{ getActiveBible?: () => object|null, fetchFixture?: (path: string) => Promise<object>, sourceLabel?: string }} opts
 * @returns {Promise<{ regression: object[], live: object[], elapsedMs: number, regressionPass: number, regressionTotal: number, livePass: number, liveTotal: number }>}
 */
export async function runWorldBibleTests(opts = {}) {
  const t0 = performance.now();
  const regression = [];
  const getActiveBible = opts.getActiveBible || (() => null);
  const fetchFixture = opts.fetchFixture || (async () => { throw new Error("fetchFixture not provided"); });

  // ── Fixture tests ──
  for (const path of FIXTURE_PATHS) {
    regression.push(await (async () => {
      const name = `fixture: ${path}`;
      try {
        const raw = await fetchFixture(path);
        const prepared = prepareBibleForValidation(raw);
        const { valid } = validateWorldBible(prepared);
        assert(valid, "schema invalid after repair");
        const sol = validateWorldBibleSolvability(prepared);
        assert(sol.ok, sol.report);
        return { name, pass: true, detail: sol.report.split("\n")[0] };
      } catch (e) {
        return { name, pass: false, detail: e.message || String(e) };
      }
    })());
  }

  // ── Inline regression tests ──
  regression.push(runCase("orphan room detected", () => {
    const wb = mkMinimalBible({
      locations: [
        { name: "Start", description: "Entry", exits: ["Mid"] },
        { name: "Mid", description: "Middle", exits: ["Start"] },
        { name: "Orphan", description: "Isolated", exits: [] },
      ],
    });
    autoRepairWorldBible(wb);
    const sol = validateWorldBibleSolvability(wb);
    assert(!sol.ok, "expected solvability failure");
    assert(sol.gaps.some(g => g.includes("unreachable room: Orphan")), "expected orphan gap");
    return "unreachable Orphan reported";
  }));

  regression.push(runCase("empty chain → synthetic chain", () => {
    const wb = mkMinimalBible({ puzzle_chain: [] });
    const fixes = autoRepairWorldBible(wb);
    assert(wb.puzzle_chain.length >= 3, `chain too short: ${wb.puzzle_chain.length}`);
    assert(fixes.some(f => f.includes("synthetic")), "expected synthetic chain fix");
    const sol = validateWorldBibleSolvability(wb);
    assert(sol.ok, sol.report);
    return `${wb.puzzle_chain.length} steps, solvability OK`;
  }));

  regression.push(runCase("extractFirstJson fenced block", () => {
    const raw = 'Here is the plan:\n```json\n{"npcs":[{"name":"Sage"}]}\n```\nDone.';
    const obj = extractFirstJson(raw);
    assert(obj && Array.isArray(obj.npcs) && obj.npcs[0].name === "Sage", "parse failed");
    return "parsed fenced JSON";
  }));

  regression.push(runCase("extractMapSkeleton finds rooms", () => {
    const raw = 'Sure! {"rooms":[{"name":"Hall","exits":["Vault"]},{"name":"Vault","exits":["Hall"]}]}';
    const sk = extractMapSkeleton(raw, null);
    assert(sk && sk.rooms && sk.rooms.length === 2, "skeleton missing rooms");
    return "2 rooms extracted";
  }));

  regression.push(runCase("scoreChainCandidate picks complete chain", () => {
    const rooms = ["A", "B", "C"];
    const items = ["torch", "key", "gem"];
    const bad = { puzzle_chain: [{ step: 1, action: "x", gives: "torch", location: "A" }] };
    const good = {
      puzzle_chain: [
        { step: 1, action: "start", gives: "torch", location: "A" },
        { step: 2, action: "win", gives: "gem", unlocks: "win", location: "C" },
      ],
    };
    const scoreBad = scoreChainCandidate(bad, rooms, items, "A", "C");
    const scoreGood = scoreChainCandidate(good, rooms, items, "A", "C");
    assert(scoreGood > scoreBad, `good=${scoreGood} bad=${scoreBad}`);
    return `good=${scoreGood} > bad=${scoreBad}`;
  }));

  regression.push(runCase("win item gap detected", () => {
    const wb = mkMinimalBible({
      puzzle_chain: [
        { step: 1, action: "get lantern", gives: "lantern", location: "Start" },
        { step: 2, action: "get key", gives: "key", location: "Mid" },
        { step: 3, action: "reach end", gives: null, unlocks: "win", location: "End" },
      ],
      win_condition: { required_items: ["gem"], required_location: "Start", description: "Get gem" },
    });
    // Test detection only — do not auto-repair (repair would rebuild chain).
    const sol = validateWorldBibleSolvability(wb);
    assert(!sol.ok, "expected failure");
    assert(hasChainSolvabilityGaps(sol.gaps), "expected chain solvability gaps");
    return sol.gaps.find(g => g.includes("win item")) || sol.gaps[0];
  }));

  regression.push(runCase("normalizeWinCondition from string", () => {
    const wb = mkMinimalBible({
      win_condition: "Obtain the gem and return",
      puzzle_chain: [
        { step: 1, action: "take gem", gives: "gem", unlocks: "win", location: "End" },
        { step: 2, action: "return", gives: null, unlocks: null, location: "Start" },
      ],
    });
    autoRepairWorldBible(wb);
    assert(typeof wb.win_condition === "object", "win_condition not object");
    assert(Array.isArray(wb.win_condition.required_items), "missing required_items");
    return `required_items: ${wb.win_condition.required_items.join(", ")}`;
  }));

  regression.push(runCase("snapRoomToBible underscore alias", () => {
    const wb = {
      locations: [
        { name: "The Threshold of Gloomfang", exits: ["The Whispering Antechamber"] },
        { name: "The Whispering Antechamber", exits: ["The Threshold of Gloomfang"] },
      ],
    };
    assert(snapRoomToBible("Threshold_of_Gloomfang", wb) === "The Threshold of Gloomfang");
    assert(snapRoomToBible("Whispering_Antechamber", wb) === "The Whispering Antechamber");
    assert(roomsMatch("Threshold_of_Gloomfang", "The Threshold of Gloomfang"));
    return "underscore aliases snapped";
  }));

  regression.push(runCase("snapItemToBible partial name", () => {
    const wb = {
      key_items: [
        { name: "Mithril-threaded Rope", purpose: "traverse chasms" },
        { name: "Elven Sightstone", purpose: "see hidden paths" },
      ],
    };
    assert(snapItemToBible("rope", wb) === "Mithril-threaded Rope");
    assert(snapItemToBible("mithril threaded rope", wb) === "Mithril-threaded Rope");
    return "rope → Mithril-threaded Rope";
  }));

  regression.push(runCase("mergeRoomAlias consolidates state", () => {
    const state = {
      location: "Threshold_of_Gloomfang",
      knownMap: {
        Threshold_of_Gloomfang: { exits: ["Whispering_Antechamber"], notes: "entry" },
        "The Threshold of Gloomfang": { exits: [], notes: "" },
      },
      roomItems: {
        Threshold_of_Gloomfang: ["Mithril-threaded Rope"],
        "The Threshold of Gloomfang": [],
      },
      roomImageBlobs: {},
      roomsWithImages: [],
    };
    mergeRoomAlias(state, "Threshold_of_Gloomfang", "The Threshold of Gloomfang");
    assert(state.location === "The Threshold of Gloomfang");
    assert(!state.knownMap.Threshold_of_Gloomfang);
    assert(state.roomItems["The Threshold of Gloomfang"].includes("Mithril-threaded Rope"));
    return "alias merged into canonical room";
  }));

  regression.push(runCase("normalizeItemToken articles and underscores", () => {
    assert(normalizeItemToken("the runic_key") === "runic key");
    assert(normalizeItemToken("wizard's staff") === "wizards staff");
    return "articles/underscores/apostrophes normalized";
  }));

  regression.push(runCase("splitItemList multi-item", () => {
    const a = splitItemList("the key, lantern and staff");
    assert(a.length === 3 && a[0] === "the key" && a[1] === "lantern" && a[2] === "staff");
    const b = splitItemList("rope plus flint");
    assert(b.length === 2 && b[0] === "rope" && b[1] === "flint");
    return "comma/and/plus splits";
  }));

  regression.push(runCase("matchItem partial and snake_case", () => {
    const items = ["runic_key", "elven_lantern", "wizards_staff"];
    assert(matchItem("the key", items) === "runic_key");
    assert(matchItem("staff", items) === "wizards_staff");
    assert(matchItem("lantern", items) === "elven_lantern");
    return "partial token containment works";
  }));

  regression.push(runCase("itemsTakenFromLocation after take", () => {
    const wb = {
      locations: [{ name: "Mushroom Grotto", items: ["flint"] }],
      item_locations: { flint: "Mushroom Grotto" },
      key_items: [{ name: "flint", purpose: "spark" }],
    };
    const state = {
      location: "Mushroom Grotto",
      inventory: ["flint"],
      roomItems: { "Mushroom Grotto": [] },
    };
    const taken = itemsTakenFromLocation("Mushroom Grotto", state, wb);
    assert(taken.includes("flint"));
    assert(!itemPresentInRoom("flint", "Mushroom Grotto", state));
    assert(playerHasItem("flint", state.inventory, wb));
    return "taken items excluded from room presence";
  }));

  regression.push(runCase("formatRoomPresence strips taken item from description", () => {
    const wb = {
      locations: [{
        name: "Mushroom Grotto",
        description: "A damp cavern with mushrooms. A piece of flint glints on the ground near a dead campfire.",
        items: ["flint"],
      }],
      item_locations: { flint: "Mushroom Grotto" },
      key_items: [{ name: "flint", purpose: "spark" }],
    };
    const state = {
      location: "Mushroom Grotto",
      health: 80,
      inventory: ["flint"],
      roomItems: { "Mushroom Grotto": [] },
      knownMap: { "Mushroom Grotto": { exits: ["Cave Mouth"], notes: "" } },
    };
    const text = formatRoomPresence(state, "Mushroom Grotto", wb, { markdown: false });
    assert(text.includes("mushrooms"));
    assert(!/flint glints/i.test(text));
    assert(!text.includes("Already taken"));
    assert(!text.includes("You see:"));
    assert(text.includes("Carrying: flint"));
    return "formatRoomPresence removes stale item prose";
  }));

  regression.push(runCase("stripTakenItemsFromDescription multi-sentence", () => {
    const desc = "A damp cavern lit by mushrooms. Ancient carvings depict a forge. A piece of flint glints on the ground.";
    const out = stripTakenItemsFromDescription(desc, ["flint"], { key_items: [{ name: "flint" }] });
    assert(out.includes("mushrooms"));
    assert(out.includes("carvings"));
    assert(!/flint/i.test(out));
    return "stripTakenItemsFromDescription drops stale sentences";
  }));

  regression.push(runCase("npcGiftAlreadyReceived after torch", () => {
    const wb = {
      key_items: [{ name: "torch", purpose: "light" }],
      puzzle_chain: [{ step: 1, action: "talk to hermit", gives: "torch", unlocks: null }],
      npcs: [{ name: "Old Hermit", location: "Cave Mouth", provides: "gives torch freely" }],
    };
    const state = { inventory: ["torch"], gameFlags: {}, chainStepsDone: [] };
    const gift = npcGiftAlreadyReceived(wb.npcs[0], state, wb);
    assert(gift === "torch");
    const empty = npcGiftAlreadyReceived(wb.npcs[0], { inventory: [], gameFlags: {}, chainStepsDone: [] }, wb);
    assert(empty === null);
    return "NPC gift detected when player holds chain item";
  }));

  regression.push(runCase("riddle solved flag suppresses re-cue", () => {
    const riddle = {
      location: "Ancient Forge",
      hint: "FIRE AWAKENS WHAT STONE REMEMBERS",
      solution: "use flint on forge",
      reward: "forge ignites",
    };
    const state = { gameFlags: {} };
    assert(!isRiddleSolved(riddle, state));
    markRiddleSolved(riddle, state);
    assert(isRiddleSolved(riddle, state));
    assert(state.gameFlags[riddleFlagKey(riddle)] === true);
    return "riddle flag set and checked";
  }));

  regression.push(runCase("mechanicAlreadyApplied after forge step", () => {
    const wb = {
      puzzle_chain: [{ step: 6, action: "use flint on forge", gives: "enchanted blade", location: "Ancient Forge" }],
      mechanics: [{ action: "use flint on forge or light forge", effect: "forge ignites", location: "Ancient Forge" }],
    };
    const mech = wb.mechanics[0];
    const stateBefore = { inventory: ["flint"], gameFlags: {}, chainStepsDone: [] };
    assert(!mechanicAlreadyApplied(mech, stateBefore, wb));
    const stateAfter = { inventory: ["flint", "enchanted blade"], gameFlags: {}, chainStepsDone: [] };
    assert(mechanicAlreadyApplied(mech, stateAfter, wb));
    const stateFlag = { inventory: ["flint"], gameFlags: { [mechanicFlagKey(mech)]: true }, chainStepsDone: [] };
    assert(mechanicAlreadyApplied(mech, stateFlag, wb));
    return "mechanic done via chain gives or _done flag";
  }));

  regression.push(runCase("matchExit cardinals and substring", () => {
    const exits = ["Mushroom Grotto", "Dark Passage", "North Tunnel"];
    assert(matchExit("n", exits) === "North Tunnel");
    assert(matchExit("dark", exits) === "Dark Passage");
    assert(matchExit("Mushroom Grotto", exits) === "Mushroom Grotto");
    return "exit matching works";
  }));

  regression.push(runCase("matchMechanicAction at location", () => {
    const mechanics = [
      { action: "use flint on forge or light forge", effect: "forge ignites", location: "Ancient Forge" },
      { action: "use rope on bridge", effect: "secures bridge", location: "Underground River" },
    ];
    const m = matchMechanicAction("use flint on forge", mechanics, "Ancient Forge");
    assert(m && m.action.includes("flint"));
    assert(matchMechanicAction("use flint on forge", mechanics, "Cave Mouth") === null);
    return "mechanic fuzzy match at location";
  }));

  regression.push(runCase("matchChainStep single match", () => {
    const chain = [
      { step: 6, action: "use flint on forge", gives: "enchanted blade", location: "Ancient Forge" },
      { step: 7, action: "use iron key on iron door", gives: null, location: "Dragon's Vault" },
    ];
    const step = matchChainStep("use flint on forge", chain, "Ancient Forge");
    assert(step && step.gives === "enchanted blade");
    return "chain step matched";
  }));

  regression.push(runCase("flagKeyFromName", () => {
    assert(flagKeyFromName("Stone Dragon", "_defeated") === "Stone_Dragon_defeated");
    return "flag key derived";
  }));

  regression.push(runCase("gives/placement mismatch repaired", () => {
    const wb = mkXylosBrokenBible();
    const coh0 = validateWorldBibleCoherence(wb);
    assert(!coh0.ok, "expected initial coherence failure");
    assert(coh0.gaps.some(g => g.includes("gives/placement mismatch")), "expected mismatch gap");
    repairWorldBibleCoherence(wb);
    const coh1 = validateWorldBibleCoherence(wb);
    assert(coh1.ok || !coh1.gaps.some(g => g.includes("gives/placement mismatch")),
      `placement still mismatched: ${coh1.gaps.join("; ")}`);
    assert(wb.item_locations["Glyphic Cipher Disk"] === "Start Chamber", "disk should move to Start Chamber");
    return "placement relocated to step location";
  }));

  regression.push(runCase("NPC-before-reachable relocated", () => {
    const wb = mkXylosBrokenBible();
    repairWorldBibleCoherence(wb);
    const lyra = (wb.npcs || []).find(n => n.name === "Lyra");
    assert(lyra, "Lyra missing");
    assert(lyra.location === "Grand Concourse", `Lyra at ${lyra.location}, expected Grand Concourse`);
    return `Lyra → ${lyra.location}`;
  }));

  regression.push(runCase("redundant + duplicate unlock dropped", () => {
    const wb = mkXylosBrokenBible();
    const fixes = repairWorldBibleCoherence(wb);
    const step2 = wb.puzzle_chain.find(s => s.step === 2);
    assert(step2 && step2.unlocks == null, "redundant unlock step 2 should be null");
    const coh = validateWorldBibleCoherence(wb);
    assert(!coh.gaps.some(g => g.startsWith("redundant_unlock")), coh.gaps.join("; "));
    assert(fixes.some(f => f.includes("redundant") || f.includes("duplicate") || f.includes("shallow")), fixes.join("; "));
    return fixes.filter(f => f.includes("unlock")).join(" | ") || "unlocks cleaned";
  }));

  regression.push(await (async () => {
    const name = "default_cave simulator passes";
    try {
      const raw = await fetchFixture("default_cave.json");
      const prepared = prepareBibleForValidation(raw);
      const sim = simulateChainPlaythrough(prepared);
      assert(sim.ok, sim.failures.join("; "));
      return { name, pass: true, detail: `${prepared.puzzle_chain.length} steps, ${sim.lockedRooms.size} gated` };
    } catch (e) {
      return { name, pass: false, detail: e.message || String(e) };
    }
  })());

  regression.push(runCase("simulator fails open (empty lockedRooms)", () => {
    const wb = mkXylosBrokenBible();
    const sim = simulateChainPlaythrough(wb);
    assert(!sim.ok, "incoherent bible should fail sim");
    const failOpen = sim.ok ? sim.lockedRooms : new Set();
    assert(failOpen.size === 0, "fail-open uses empty locked set when sim fails");
    return `failures=${sim.failures.length}, gated=0`;
  }));

  regression.push(runCase("computeChainProgress ordered prefix", () => {
    const chain = [
      { step: 1, action: "talk", gives: "torch", unlocks: null },
      { step: 2, action: "cross bridge", gives: null, unlocks: null },
      { step: 3, action: "take gem", gives: "gem", unlocks: "win" },
    ];
    const wb = mkMinimalBible({ puzzle_chain: chain });
    const early = computeChainProgress(chain, {
      inventoryCanonical: new Set(["gem"]),
      gameFlags: {},
      explicitDone: [],
      wb,
    });
    assert(early.doneCount === 0, "late item early must not complete middle steps");
    const mid = computeChainProgress(chain, {
      inventoryCanonical: new Set(["torch", "gem"]),
      gameFlags: {},
      explicitDone: [],
      wb,
    });
    assert(mid.doneCount === 3, `no-gives step 2 auto-satisfies when step 3 done: ${mid.doneCount}`);
    const withFlag = computeChainProgress(chain, {
      inventoryCanonical: new Set(["torch"]),
      gameFlags: {},
      explicitDone: [1],
      wb,
    });
    assert(withFlag.doneCount >= 1, "explicit complete_step");
    const badOrder = computeChainProgress(chain, {
      inventoryCanonical: new Set(),
      gameFlags: {},
      explicitDone: [2],
      wb,
    });
    assert(badOrder.doneCount === 0, "out-of-order explicit step ignored");
    return `early=0, mid=${mid.doneCount}, explicit=${withFlag.doneCount}`;
  }));

  regression.push(runCase("deriveMonsterWeaknessItems torch", () => {
    const wb = mkMinimalBible({
      key_items: [{ name: "torch", purpose: "light" }, { name: "key", purpose: "open" }, { name: "gem", purpose: "win" }],
      monsters: [{ name: "Troll", location: "Mid", weakness: "panics and flees when shown fire from the torch" }],
    });
    deriveMonsterWeaknessItems(wb);
    assert(wb.monsters[0].weakness_item === "torch", `got ${wb.monsters[0].weakness_item}`);
    return "torch linked";
  }));

  regression.push(runCase("truncateAtWordBoundary + pickSdStylePhrase", () => {
    const t = truncateAtWordBoundary("ornate dark fantasy steampunk corridor", 28);
    assert(!t.endsWith("steamp"), `mid-word cut: '${t}'`);
    assert(t.length <= 28, t);
    assert(pickSdStylePhrase("steampunk cave adventure") === "steampunk fantasy art");
    return `${t} | steampunk ok`;
  }));

  regression.push(runCase("scoreChainCandidate prefers coherent chain", () => {
    const wb = mkXylosBrokenBible();
    const rooms = wb.locations.map(l => l.name);
    const items = wb.key_items.map(k => k.name);
    const ctx = {
      itemLocations: wb.item_locations,
      npcs: wb.npcs,
      locations: wb.locations,
    };
    const incoherent = { puzzle_chain: wb.puzzle_chain };
    const coherent = cloneWorldBible(wb);
    repairWorldBibleCoherence(coherent);
    const ctxGood = { ...ctx, itemLocations: coherent.item_locations, npcs: coherent.npcs };
    const scoreBad = scoreChainCandidate(incoherent, rooms, items, "Start Chamber", "Deep Vault", ctx);
    const scoreGood = scoreChainCandidate({ puzzle_chain: coherent.puzzle_chain }, rooms, items, "Start Chamber", "Deep Vault", ctxGood);
    assert(scoreGood > scoreBad, `good=${scoreGood} bad=${scoreBad}`);
    return `good=${scoreGood} > bad=${scoreBad}`;
  }));

  regression.push(runCase("synthetic chain passes solvability + simulator", () => {
    const wb = mkMinimalBible({ puzzle_chain: [] });
    buildSyntheticPuzzleChain(wb);
    const sol = validateWorldBibleSolvability(wb);
    assert(sol.ok, sol.report);
    const sim = simulateChainPlaythrough(wb);
    assert(sim.ok, sim.failures.join("; "));
    return `${wb.puzzle_chain.length} steps OK`;
  }));

  regression.push(runCase("duplicate gives deduped (last step wins)", () => {
    const wb = mkMinimalBible({
      locations: [
        { name: "Start", description: "Entry", exits: ["End"] },
        { name: "End", description: "Treasure", exits: ["Start"] },
      ],
      key_items: [
        { name: "lens", purpose: "see" },
        { name: "key", purpose: "open" },
        { name: "gem", purpose: "win" },
      ],
      item_locations: { lens: "Start", key: "Start", gem: "End" },
      puzzle_chain: [
        { step: 1, action: "take lens at Start", gives: "lens", location: "Start" },
        { step: 2, action: "get key", gives: "key", location: "Start" },
        { step: 3, action: "claim lens at End", gives: "lens", unlocks: "win", location: "End" },
      ],
      win_condition: { required_items: ["lens"], required_location: "Start", description: "Win" },
    });
    repairWorldBibleCoherence(wb);
    const s1 = wb.puzzle_chain.find(s => s.step === 1);
    const s3 = wb.puzzle_chain.find(s => s.step === 3);
    assert(s1 && s1.gives == null, "step 1 duplicate cleared");
    assert(s3 && s3.gives === "lens", "step 3 keeps lens");
    assert(wb.item_locations.lens === "End", `lens at ${wb.item_locations.lens}`);
    const coh = validateWorldBibleCoherence(wb);
    assert(coh.ok, coh.gaps.join("; "));
    return "lens on step 3, placement End";
  }));

  regression.push(runCase("scoreChainCandidate penalizes duplicate gives", () => {
    const rooms = ["Start", "End"];
    const items = ["lens", "key"];
    const dup = {
      puzzle_chain: [
        { step: 1, gives: "lens", location: "Start", action: "a" },
        { step: 2, gives: "lens", unlocks: "win", location: "End", action: "b" },
      ],
    };
    const uniq = {
      puzzle_chain: [
        { step: 1, gives: "key", location: "Start", action: "a" },
        { step: 2, gives: "lens", unlocks: "win", location: "End", action: "b" },
      ],
    };
    const scoreDup = scoreChainCandidate(dup, rooms, items, "Start", "End");
    const scoreUniq = scoreChainCandidate(uniq, rooms, items, "Start", "End");
    assert(scoreUniq > scoreDup, `uniq=${scoreUniq} dup=${scoreDup}`);
    return `uniq=${scoreUniq} > dup=${scoreDup}`;
  }));

  // ── Live tests on active bible ──
  const live = [];
  const active = getActiveBible();
  const sourceLabel = opts.sourceLabel || "activeWorldBible";

  if (active && typeof active === "object") {
    const wb = cloneWorldBible(active);
    autoRepairWorldBible(wb);

    live.push(runCase(`live: schema valid (${sourceLabel})`, () => {
      const { valid, issues } = validateWorldBible(wb);
      assert(valid, issues.join("; "));
      return "valid";
    }));

    live.push(runCase(`live: solvability (${sourceLabel})`, () => {
      const sol = validateWorldBibleSolvability(wb);
      assert(sol.ok, sol.report);
      return sol.report.split("\n")[0];
    }));

    live.push(runCase(`live: chain length >= 2 (${sourceLabel})`, () => {
      const n = (wb.puzzle_chain || []).length;
      assert(n >= 2, `only ${n} step(s)`);
      return `${n} steps`;
    }));

    live.push(runCase(`live: no unreachable rooms (${sourceLabel})`, () => {
      const sol = validateWorldBibleSolvability(wb);
      const unreachable = sol.gaps.filter(g => g.includes("unreachable room"));
      assert(!unreachable.length, unreachable.join("; "));
      return "all rooms reachable";
    }));
  } else {
    live.push({ name: `live: (${sourceLabel})`, pass: false, detail: "no active world bible loaded" });
  }

  const elapsedMs = Math.round(performance.now() - t0);
  const regressionPass = regression.filter(r => r.pass).length;
  const livePass = live.filter(r => r.pass).length;

  return {
    regression,
    live,
    elapsedMs,
    regressionPass,
    regressionTotal: regression.length,
    livePass,
    liveTotal: live.length,
  };
}

/** Format test results for the debug panel. */
export function formatTestResults(results) {
  const lines = ["── Unit tests ──"];
  lines.push(`Regression: ${results.regressionPass}/${results.regressionTotal} passed (${results.elapsedMs} ms)`);
  for (const r of results.regression) {
    lines.push(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  lines.push(`Live: ${results.livePass}/${results.liveTotal} passed`);
  for (const r of results.live) {
    lines.push(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  return lines;
}
