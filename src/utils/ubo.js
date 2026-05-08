/**
 * UBO (Ultimate Beneficial Owner) Detection Module
 * 
 * Implements FATF Recommendation 24/25 compliant UBO traversal:
 *  - O(1) entity / relationship lookup via Map index
 *  - Iterative BFS (safe for deep chains, no stack overflow)
 *  - Integer arithmetic in basis points (exact %, no floating-point drift)
 *  - Edge-level cycle detection (handles diamond ownership & self-loops)
 *  - Separate aggregation of ownership equity vs significant control
 *  - Configurable thresholds per jurisdiction (EU 25%, Cayman 10%, etc.)
 *
 * @module utils/ubo
 */

// ─────────────────────────────────────────────────────────────────────
// Defaults & constants
// ─────────────────────────────────────────────────────────────────────

export const UBO_DEFAULTS = Object.freeze({
  OWNERSHIP_THRESHOLD: 25,   // FATF default (%)
  CONTROL_THRESHOLD: 25,     // Significant-control threshold (%)
  MAX_ITERATIONS: 100000,    // Hard cap to prevent runaway on pathological graphs
  MAX_DEPTH: 30,             // Reasonable real-world chain depth
});

const OWNERSHIP = 'ownership';
const CONTROL = 'control';

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute the effective ownership % of a single edge.
 * Prefers shares/totalShares (authoritative) over stored percentage (legacy).
 *
 * @param {Object} rel - Relationship record
 * @param {Map<string, Object>} entityMap - Indexed entities
 * @returns {number|null} Percentage (0–100) or null if unknown
 */
export function computeRelPercentage(rel, entityMap) {
  if (rel.shares != null && rel.shares > 0) {
    const target = entityMap.get(rel.targetId);
    if (target && target.totalShares > 0) {
      // Round to 2 decimals to match UI convention
      return Math.round((rel.shares / target.totalShares) * 10000) / 100;
    }
  }
  return rel.percentage != null ? rel.percentage : null;
}

/**
 * Build a reusable graph index from entities/relationships.
 * Call once per data-set change; reuse across multiple UBO queries.
 *
 * @param {Array} entities
 * @param {Array} relationships
 * @returns {{ entityMap, inboundRels, outboundRels }}
 */
export function buildGraphIndex(entities, relationships) {
  const entityMap = new Map();
  const inboundRels = new Map();   // targetId → Relationship[]
  const outboundRels = new Map();  // sourceId → Relationship[]

  for (const e of entities) entityMap.set(e.id, e);

  for (const r of relationships) {
    if (!inboundRels.has(r.targetId)) inboundRels.set(r.targetId, []);
    if (!outboundRels.has(r.sourceId)) outboundRels.set(r.sourceId, []);
    inboundRels.get(r.targetId).push(r);
    outboundRels.get(r.sourceId).push(r);
  }

  return { entityMap, inboundRels, outboundRels };
}

// ─────────────────────────────────────────────────────────────────────
// Main UBO detection
// ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} UBOPath
 * @property {number}   percentage   - Ownership flow through this path (%)
 * @property {number|null} controlPct - Effective control % if path is via control, else null
 * @property {string[]} chain        - Names from UBO to target (exclusive of target)
 * @property {boolean}  direct       - True if UBO owns target directly (single edge)
 * @property {boolean}  viaControl   - True if path passes through any control edge
 * @property {string}   edgeType     - Last edge type: 'ownership' | 'control'
 */

/**
 * @typedef {Object} UBOResult
 * @property {Object}    entity              - UBO entity (always type==='person')
 * @property {number}    percentage          - Aggregated ownership % (summed across paths)
 * @property {number}    controlPercentage   - Max significant-control % across paths
 * @property {boolean}   direct              - All paths are direct
 * @property {boolean}   mixed               - Has both direct AND indirect paths
 * @property {boolean}   viaControl          - Any path is via control
 * @property {UBOPath[]} paths               - All paths, sorted by % desc
 * @property {string[]}  path                - Shortest/primary chain (== paths[0].chain)
 * @property {'ownership'|'control'|'both'} qualifiedBy - Which threshold was met
 * @property {boolean}   exceedsHundred      - True if aggregated % > 100 (data anomaly flag)
 */

/**
 * Detect UBOs of a target entity.
 *
 * @param {string} targetId
 * @param {ReturnType<typeof buildGraphIndex>} graphIndex
 * @param {Object} [options]
 * @param {number} [options.ownershipThreshold=25]
 * @param {number} [options.controlThreshold=25]
 * @param {number} [options.maxIterations=100000]
 * @param {number} [options.maxDepth=30]
 * @param {boolean} [options.includeBelowThreshold=false] - Return all paths ignoring thresholds
 * @returns {UBOResult[]}
 */
export function findUBOs(targetId, graphIndex, options = {}) {
  const {
    ownershipThreshold = UBO_DEFAULTS.OWNERSHIP_THRESHOLD,
    controlThreshold = UBO_DEFAULTS.CONTROL_THRESHOLD,
    maxIterations = UBO_DEFAULTS.MAX_ITERATIONS,
    maxDepth = UBO_DEFAULTS.MAX_DEPTH,
    includeBelowThreshold = false,
  } = options;

  const { entityMap, inboundRels } = graphIndex;
  if (!entityMap.has(targetId)) return [];

  const ownershipThresholdBps = Math.round(ownershipThreshold * 100);
  const controlThresholdBps = Math.round(controlThreshold * 100);

  /** personId → aggregated record */
  const aggregated = new Map();

  /** BFS queue */
  const queue = [{
    nodeId: targetId,
    multiplierBps: 10000,            // 100% in basis points
    chain: [],
    depth: 0,
    visitedEdges: new Set(),         // "sourceId|targetId|type"
    inheritedControlBps: null,       // non-null ⇒ chain passes through control
  }];

  let iterCount = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (++iterCount > maxIterations) {
      truncated = true;
      break;
    }

    const {
      nodeId, multiplierBps, chain, depth,
      visitedEdges, inheritedControlBps,
    } = queue.shift();

    if (depth >= maxDepth) continue;

    const inbound = inboundRels.get(nodeId);
    if (!inbound) continue;

    for (const rel of inbound) {
      if (rel.type !== OWNERSHIP && rel.type !== CONTROL) continue;

      const edgeKey = `${rel.sourceId}|${rel.targetId}|${rel.type}`;
      if (visitedEdges.has(edgeKey)) continue;

      const owner = entityMap.get(rel.sourceId);
      if (!owner) continue;

      // ─── Determine edge percentage ───
      let edgePctBps;
      let isControlEdge;

      if (rel.type === OWNERSHIP) {
        const pct = computeRelPercentage(rel, entityMap);
        if (pct == null || pct <= 0) continue;
        edgePctBps = Math.round(pct * 100);
        isControlEdge = false;
      } else {
        // Control edge: null/0 percentage means "full control" (100%)
        const ctrlPct = (rel.percentage != null && rel.percentage > 0)
          ? rel.percentage
          : 100;
        edgePctBps = Math.round(ctrlPct * 100);
        isControlEdge = true;
      }

      // ─── Integer multiplication: flow = (parent × edge) / 10000 ───
      const flowBps = Math.round((multiplierBps * edgePctBps) / 10000);

      // Control poisoning: any control edge taints the whole downstream chain
      const pathControlBps = isControlEdge
        ? (inheritedControlBps == null
            ? edgePctBps
            : Math.min(inheritedControlBps, edgePctBps))
        : inheritedControlBps;

      const newChain = [owner.name, ...chain];
      const newVisited = new Set(visitedEdges);
      newVisited.add(edgeKey);

      if (owner.type === 'person') {
        // ─── Reached a natural person: record the path ───
        if (!aggregated.has(owner.id)) {
          aggregated.set(owner.id, {
            entity: owner,
            ownershipBps: 0,
            maxControlBps: 0,
            paths: [],
          });
        }
        const rec = aggregated.get(owner.id);
        const isViaControl = pathControlBps != null;

        if (isViaControl) {
          // Control is semantically "binary-ish"—take max, don't sum
          rec.maxControlBps = Math.max(rec.maxControlBps, pathControlBps);
        } else {
          // Pure ownership: sum across parallel paths (diamond structure)
          rec.ownershipBps += flowBps;
        }

        rec.paths.push({
          percentage: flowBps / 100,
          controlPct: pathControlBps != null ? pathControlBps / 100 : null,
          chain: newChain,
          direct: chain.length === 0,
          viaControl: isViaControl,
          edgeType: rel.type,
        });
      } else {
        // ─── Intermediate legal entity: continue BFS ───
        queue.push({
          nodeId: owner.id,
          multiplierBps: flowBps,
          chain: newChain,
          depth: depth + 1,
          visitedEdges: newVisited,
          inheritedControlBps: pathControlBps,
        });
      }
    }
  }

  // ─── Shape & filter output ───
  const results = [];
  for (const rec of aggregated.values()) {
    const passesOwnership = rec.ownershipBps >= ownershipThresholdBps;
    const passesControl = rec.maxControlBps >= controlThresholdBps;

    if (!includeBelowThreshold && !passesOwnership && !passesControl) continue;

    const hasDirect = rec.paths.some(p => p.direct);
    const hasIndirect = rec.paths.some(p => !p.direct);
    const hasControl = rec.paths.some(p => p.viaControl);

    // Sort this UBO's paths by % desc for display
    const sortedPaths = rec.paths.slice().sort((a, b) => b.percentage - a.percentage);

    results.push({
      entity: rec.entity,
      percentage: Math.round(rec.ownershipBps) / 100,
      controlPercentage: rec.maxControlBps / 100,
      direct: hasDirect && !hasIndirect,
      mixed: hasDirect && hasIndirect,
      viaControl: hasControl,
      paths: sortedPaths,
      path: sortedPaths[0] ? sortedPaths[0].chain : [],
      qualifiedBy: passesOwnership && passesControl ? 'both'
                 : passesOwnership ? 'ownership'
                 : 'control',
      exceedsHundred: rec.ownershipBps > 10000,
    });
  }

  // Largest UBO first
  results.sort((a, b) => {
    if (b.percentage !== a.percentage) return b.percentage - a.percentage;
    return b.controlPercentage - a.controlPercentage;
  });

  if (truncated && typeof console !== 'undefined') {
    console.warn(`[findUBOs] Iteration cap reached on target=${targetId}; results may be incomplete.`);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────
// Bonus utilities (nice-to-have, optional exports)
// ─────────────────────────────────────────────────────────────────────

/**
 * Check whether adding an edge (sourceId → targetId) would create a cycle.
 * Useful for inline form validation.
 */
export function wouldCreateCycle(sourceId, targetId, graphIndex, excludeRelId = null) {
  if (sourceId === targetId) return true;
  const { outboundRels } = graphIndex;
  const visited = new Set();
  const queue = [targetId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const outs = outboundRels.get(current) || [];
    for (const r of outs) {
      if (r.id === excludeRelId) continue;
      if (r.type !== OWNERSHIP && r.type !== CONTROL) continue;
      queue.push(r.targetId);
    }
  }
  return false;
}

/**
 * Detect all existing ownership cycles in the graph (DFS with color marking).
 * Returns an array of cycles (each cycle is an array of entity IDs).
 */
export function detectCircularOwnership(graphIndex) {
  const { entityMap, outboundRels } = graphIndex;
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const stack = [];
  const cycles = [];

  function dfs(nodeId) {
    color.set(nodeId, GRAY);
    stack.push(nodeId);

    const outs = outboundRels.get(nodeId) || [];
    for (const r of outs) {
      if (r.type !== OWNERSHIP && r.type !== CONTROL) continue;
      const next = r.targetId;
      const c = color.get(next) || WHITE;
      if (c === GRAY) {
        const idx = stack.indexOf(next);
        if (idx >= 0) cycles.push(stack.slice(idx).concat(next));
      } else if (c === WHITE) {
        dfs(next);
      }
    }

    color.set(nodeId, BLACK);
    stack.pop();
  }

  for (const id of entityMap.keys()) {
    if (!color.has(id)) dfs(id);
  }
  return cycles;
}

/**
 * Compute aggregated shareholding table for a target entity.
 * Useful for the "Shareholding Summary" UI.
 */
export function getShareholdingSummary(targetId, graphIndex) {
  const { entityMap, inboundRels } = graphIndex;
  const target = entityMap.get(targetId);
  if (!target) return null;

  const rels = (inboundRels.get(targetId) || []).filter(r => r.type === OWNERSHIP);
  const rows = rels.map(r => {
    const owner = entityMap.get(r.sourceId);
    const pct = computeRelPercentage(r, entityMap);
    return {
      ownerId: r.sourceId,
      ownerName: owner ? owner.name : '(Unknown)',
      shares: r.shares || null,
      percentage: pct,
    };
  });

  const totalShares = rows.reduce((s, x) => s + (x.shares || 0), 0);
  const totalPct = rows.reduce((s, x) => s + (x.percentage || 0), 0);

  return {
    target,
    rows,
    totalAllocatedShares: totalShares,
    totalAllocatedPercentage: Math.round(totalPct * 100) / 100,
    exceeds100: totalPct > 100.01, // tiny epsilon for float safety
    unaccountedShares: target.totalShares
      ? Math.max(0, target.totalShares - totalShares)
      : null,
  };
}
