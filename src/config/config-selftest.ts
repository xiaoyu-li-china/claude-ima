import { QualityConfigError, QUALITY_TIER_LIST, validateQualityTier } from './quality';

export interface ConfigCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Exercises the validator both ways: every built-in tier must pass, and a
 * battery of illegal configs must be rejected with QualityConfigError and a
 * human-readable message. Runs in the HUD and (future) CI alike.
 */
export function runConfigChecks(): ConfigCheckResult[] {
  const results: ConfigCheckResult[] = [];

  for (const tier of QUALITY_TIER_LIST) {
    try {
      validateQualityTier(tier);
      results.push({
        name: `内置档位 ${tier.name} 通过校验`,
        passed: true,
        detail: `steps=${tier.raymarchSteps}, scale=${tier.resolutionScale}`,
      });
    } catch (error) {
      results.push({
        name: `内置档位 ${tier.name} 通过校验`,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const illegalCases: ReadonlyArray<{ name: string; payload: unknown }> = [
    {
      name: '拒绝步进数为 0',
      payload: { name: 'smooth', label: 'x', raymarchSteps: 0, resolutionScale: 1 },
    },
    {
      name: '拒绝非整数步进数 1.5',
      payload: { name: 'smooth', label: 'x', raymarchSteps: 1.5, resolutionScale: 1 },
    },
    {
      name: '拒绝负步进数',
      payload: { name: 'smooth', label: 'x', raymarchSteps: -8, resolutionScale: 1 },
    },
    {
      name: '拒绝缩放为 0',
      payload: { name: 'smooth', label: 'x', raymarchSteps: 16, resolutionScale: 0 },
    },
    {
      name: '拒绝缩放 > 1 (1.25)',
      payload: { name: 'smooth', label: 'x', raymarchSteps: 16, resolutionScale: 1.25 },
    },
    {
      name: '拒绝负缩放',
      payload: { name: 'smooth', label: 'x', raymarchSteps: 16, resolutionScale: -0.5 },
    },
    {
      name: '拒绝未知档位名',
      payload: { name: 'cinematic', label: 'x', raymarchSteps: 16, resolutionScale: 1 },
    },
    {
      name: '拒绝非对象配置',
      payload: null,
    },
  ];

  for (const testCase of illegalCases) {
    let rejected = false;
    let message = '';
    try {
      validateQualityTier(testCase.payload);
    } catch (error) {
      if (error instanceof QualityConfigError) {
        rejected = true;
        message = error.message;
      } else {
        message = `threw ${(error instanceof Error ? error.name : typeof error)} instead of QualityConfigError`;
      }
    }
    results.push({
      name: testCase.name,
      passed: rejected,
      detail: rejected ? `已拒绝：${message}` : `未被拒绝（错误）；${message}`,
    });
  }

  return results;
}
