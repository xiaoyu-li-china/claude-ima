/**
 * Quality configuration — the SINGLE SOURCE OF TRUTH for render tiers.
 *
 * The UI buttons, the renderer's uniform injection and the README all derive
 * from this table; no other module is allowed to hardcode step counts or
 * resolution scales.
 */

export type QualityTierName = 'smooth' | 'balanced' | 'ultra';

export interface QualityTier {
  readonly name: QualityTierName;
  /** Human-readable label shown in the HUD. */
  readonly label: string;
  /** Raymarching step count. Positive integer; consumed by the future renderer. */
  readonly raymarchSteps: number;
  /**
   * Backing-buffer scale relative to CSS pixels * devicePixelRatio.
   * Must lie in (0, 1]; 1 renders at full native resolution.
   */
  readonly resolutionScale: number;
}

/**
 * The one table. Add or retune a tier here and the UI, validation and docs
 * pick it up automatically.
 */
const QUALITY_TIERS: Readonly<Record<QualityTierName, QualityTier>> = {
  smooth: {
    name: 'smooth',
    label: 'Smooth（高帧率）',
    raymarchSteps: 48,
    resolutionScale: 0.75,
  },
  balanced: {
    name: 'balanced',
    label: 'Balanced（均衡）',
    raymarchSteps: 96,
    resolutionScale: 1.0,
  },
  ultra: {
    name: 'ultra',
    label: 'Ultra（高画质）',
    raymarchSteps: 192,
    resolutionScale: 1.0,
  },
};

export const DEFAULT_TIER: QualityTierName = 'balanced';

/** Read-only ordered list, stable for rendering UI buttons. */
export const QUALITY_TIER_LIST: readonly QualityTier[] = [
  QUALITY_TIERS.smooth,
  QUALITY_TIERS.balanced,
  QUALITY_TIERS.ultra,
];

export function getTier(name: QualityTierName): QualityTier {
  const tier = QUALITY_TIERS[name];
  if (tier === undefined) {
    throw new RangeError(`Unknown quality tier "${name}". Valid tiers: ${QUALITY_TIER_LIST.map((t) => t.name).join(', ')}`);
  }
  return tier;
}

export function isQualityTierName(value: string): value is QualityTierName {
  return value === 'smooth' || value === 'balanced' || value === 'ultra';
}

/** Error raised when a tier definition or override fails validation. */
export class QualityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualityConfigError';
  }
}

/**
 * Validate a raw tier-shaped object. Used for the built-in table at module
 * load and for any runtime override, so an illegal config is rejected with a
 * readable message instead of silently reaching the renderer.
 */
export function validateQualityTier(input: unknown): QualityTier {
  if (typeof input !== 'object' || input === null) {
    throw new QualityConfigError('Quality tier must be an object');
  }
  const record = input as Record<string, unknown>;
  const { name, label, raymarchSteps, resolutionScale } = record;

  if (typeof name !== 'string' || !isQualityTierName(name)) {
    throw new QualityConfigError(
      `Invalid tier name ${JSON.stringify(name)}; expected one of smooth | balanced | ultra`,
    );
  }
  if (typeof label !== 'string' || label.length === 0) {
    throw new QualityConfigError(`Tier "${name}": label must be a non-empty string`);
  }
  if (typeof raymarchSteps !== 'number' || !Number.isInteger(raymarchSteps) || raymarchSteps <= 0) {
    throw new QualityConfigError(
      `Tier "${name}": raymarchSteps must be a positive integer, got ${JSON.stringify(raymarchSteps)}`,
    );
  }
  if (
    typeof resolutionScale !== 'number' ||
    !Number.isFinite(resolutionScale) ||
    resolutionScale <= 0 ||
    resolutionScale > 1
  ) {
    throw new QualityConfigError(
      `Tier "${name}": resolutionScale must be within (0, 1], got ${JSON.stringify(resolutionScale)}`,
    );
  }
  return { name, label, raymarchSteps, resolutionScale };
}

// Fail fast at import time if the single source itself is ever edited into
// an illegal state — nothing else should validate against a broken table.
for (const tier of QUALITY_TIER_LIST) {
  validateQualityTier(tier);
}
