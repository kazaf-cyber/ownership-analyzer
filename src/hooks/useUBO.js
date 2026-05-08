import { useMemo, useCallback } from 'react';
import {
  buildGraphIndex,
  findUBOs as findUBOsPure,
  wouldCreateCycle as wouldCreateCyclePure,
  getShareholdingSummary as getShareholdingSummaryPure,
  detectCircularOwnership,
} from '../utils/ubo';

/**
 * React hook that memoizes the graph index and exposes UBO-related operations.
 *
 * @example
 *   const { findUBOs, wouldCreateCycle } = useUBO(entities, relationships);
 *   const ubos = findUBOs(entityId, 25);  // backward compatible
 */
export function useUBO(entities, relationships) {
  const graphIndex = useMemo(
    () => buildGraphIndex(entities, relationships),
    [entities, relationships]
  );

  const findUBOs = useCallback((targetId, thresholdOrOptions, controlThreshold) => {
    // Backward-compatible: accept either a number or an options object
    const options = typeof thresholdOrOptions === 'number'
      ? {
          ownershipThreshold: thresholdOrOptions,
          controlThreshold: controlThreshold ?? thresholdOrOptions,
        }
      : (thresholdOrOptions || {});
    return findUBOsPure(targetId, graphIndex, options);
  }, [graphIndex]);

  const wouldCreateCycle = useCallback(
    (sourceId, targetId, excludeRelId = null) =>
      wouldCreateCyclePure(sourceId, targetId, graphIndex, excludeRelId),
    [graphIndex]
  );

  const getShareholdingSummary = useCallback(
    (targetId) => getShareholdingSummaryPure(targetId, graphIndex),
    [graphIndex]
  );

  const cycles = useMemo(() => detectCircularOwnership(graphIndex), [graphIndex]);

  return { findUBOs, wouldCreateCycle, getShareholdingSummary, cycles, graphIndex };
}
