import type { ContextState } from '../gl/context';
import type { GlCheckResult } from '../gl/gl-selftest';
import type { QualityTier, QualityTierName } from '../config/quality';
import type { TestCaseResult } from '../math';
import type { ConfigCheckResult } from '../config/config-selftest';
import type { ViewportSnapshot } from '../render/viewport';
import { QUALITY_TIER_LIST } from '../config/quality';

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`HUD: required element #${id} is missing from the document`);
  }
  return el as T;
}

function renderResultList(listEl: HTMLUListElement, results: readonly { name: string; passed: boolean; detail: string }[]): void {
  listEl.replaceChildren();
  for (const result of results) {
    const li = document.createElement('li');
    li.className = result.passed ? 'pass' : 'fail';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = result.passed ? '✓' : '✗';
    const text = document.createElement('span');
    text.textContent = result.name;
    const detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = result.detail;
    li.append(mark, text, detail);
    listEl.append(li);
  }
}

/** All DOM updates for the side panel; the rest of the app stays DOM-agnostic. */
export class Hud {
  private readonly contextState: HTMLTableCellElement;
  private readonly cssSize: HTMLTableCellElement;
  private readonly bufferSize: HTMLTableCellElement;
  private readonly dpr: HTMLTableCellElement;
  private readonly resourceCount: HTMLTableCellElement;
  private readonly tierName: HTMLTableCellElement;
  private readonly tierSteps: HTMLTableCellElement;
  private readonly tierScale: HTMLTableCellElement;
  private readonly configError: HTMLParagraphElement;
  private readonly tierButtons = new Map<QualityTierName, HTMLButtonElement>();
  private readonly loseButton: HTMLButtonElement;

  constructor(onTierSelect: (tier: QualityTierName) => void, onSimulateLoss: () => void) {
    this.contextState = requireElement<HTMLTableCellElement>('hud-context-state');
    this.cssSize = requireElement<HTMLTableCellElement>('hud-css-size');
    this.bufferSize = requireElement<HTMLTableCellElement>('hud-buffer-size');
    this.dpr = requireElement<HTMLTableCellElement>('hud-dpr');
    this.resourceCount = requireElement<HTMLTableCellElement>('hud-resource-count');
    this.tierName = requireElement<HTMLTableCellElement>('hud-tier');
    this.tierSteps = requireElement<HTMLTableCellElement>('hud-steps');
    this.tierScale = requireElement<HTMLTableCellElement>('hud-scale');
    this.configError = requireElement<HTMLParagraphElement>('hud-config-error');
    this.loseButton = requireElement<HTMLButtonElement>('btn-lose-context');

    const group = requireElement<HTMLDivElement>('tier-buttons');
    for (const tier of QUALITY_TIER_LIST) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = tier.label;
      button.dataset.tier = tier.name;
      button.addEventListener('click', () => onTierSelect(tier.name));
      group.append(button);
      this.tierButtons.set(tier.name, button);
    }

    this.loseButton.addEventListener('click', onSimulateLoss);
  }

  setContextState(state: ContextState, canSimulate: boolean): void {
    this.contextState.textContent = state === 'active' ? 'active（渲染中）' : 'lost（已暂停，等待恢复）';
    this.contextState.className = state === 'active' ? 'state-ok' : 'state-lost';
    this.loseButton.disabled = !canSimulate;
    this.loseButton.title = canSimulate ? '' : '当前浏览器不支持 WEBGL_lose_context';
  }

  setViewport(snapshot: ViewportSnapshot): void {
    this.cssSize.textContent = `${snapshot.cssWidth} × ${snapshot.cssHeight} px`;
    this.bufferSize.textContent = `${snapshot.bufferWidth} × ${snapshot.bufferHeight} px`;
    this.dpr.textContent = `${snapshot.dpr}（× 缩放 ${snapshot.resolutionScale}）`;
  }

  setResourceCount(count: number): void {
    this.resourceCount.textContent = String(count);
  }

  setTier(tier: QualityTier): void {
    this.tierName.textContent = `${tier.name} — ${tier.label}`;
    this.tierSteps.textContent = String(tier.raymarchSteps);
    this.tierScale.textContent = String(tier.resolutionScale);
    for (const [name, button] of this.tierButtons) {
      button.classList.toggle('active', name === tier.name);
    }
  }

  showConfigError(message: string): void {
    this.configError.textContent = message;
    this.configError.hidden = false;
  }

  clearConfigError(): void {
    this.configError.hidden = true;
    this.configError.textContent = '';
  }

  renderMathResults(results: readonly TestCaseResult[]): void {
    renderResultList(requireElement<HTMLUListElement>('hud-selftest'), results);
  }

  renderConfigChecks(results: readonly ConfigCheckResult[]): void {
    renderResultList(requireElement<HTMLUListElement>('hud-config-checks'), results);
  }

  renderGlChecks(results: readonly GlCheckResult[]): void {
    renderResultList(requireElement<HTMLUListElement>('hud-gl-checks'), results);
  }
}
