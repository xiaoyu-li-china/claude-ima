/**
 * Typed errors for the shader pipeline. A failure always carries the raw
 * driver info log, the shader stage and the full source annotated with line
 * numbers — never a bare Error("shader failed").
 */
export type ShaderStage = 'vertex' | 'fragment';

export interface ShaderErrorLocation {
  /** 1-based source line reported by the driver, when parseable. */
  line: number;
  /** Raw driver message for that location. */
  message: string;
}

/** Split a driver info log into per-line locations, best effort. */
export function parseInfoLog(infoLog: string): ShaderErrorLocation[] {
  const locations: ShaderErrorLocation[] = [];
  // ANGLE/mesa style: "ERROR: 0:12: 'x' : undeclared identifier"
  const pattern = /(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.+)/g;
  let match: RegExpExecArray | null = pattern.exec(infoLog);
  while (match !== null) {
    const line = Number.parseInt(match[1] ?? '0', 10);
    locations.push({ line, message: (match[2] ?? '').trim() });
    match = pattern.exec(infoLog);
  }
  return locations;
}

/** Prefix every source line with its 1-based number, highlighting error lines. */
export function annotateSource(source: string, errorLines: ReadonlySet<number>): string {
  return source
    .split('\n')
    .map((line, index) => {
      const lineNo = index + 1;
      const prefix = `${String(lineNo).padStart(4, ' ')} | `;
      return errorLines.has(lineNo) ? `${prefix}${line}   <-- HERE` : `${prefix}${line}`;
    })
    .join('\n');
}

export class ShaderCompileError extends Error {
  readonly shaderType: ShaderStage;
  readonly infoLog: string;
  readonly source: string;
  readonly locations: readonly ShaderErrorLocation[];

  constructor(shaderType: ShaderStage, infoLog: string, source: string) {
    const locations = parseInfoLog(infoLog);
    const errorLines = new Set(locations.map((l) => l.line).filter((n) => n > 0));
    const annotated = annotateSource(source, errorLines);
    const driverLines =
      locations.length > 0
        ? locations.map((l) => `  L${l.line}: ${l.message}`).join('\n')
        : infoLog.trim();
    super(
      [
        `WebGL2 ${shaderType} shader compilation failed.`,
        `Driver info log (getShaderInfoLog):\n${driverLines}`,
        `Annotated ${shaderType} source:\n${annotated}`,
      ].join('\n'),
    );
    this.name = 'ShaderCompileError';
    this.shaderType = shaderType;
    this.infoLog = infoLog;
    this.source = source;
    this.locations = locations;
  }
}

export class ProgramLinkError extends Error {
  readonly infoLog: string;
  readonly vertexSource: string;
  readonly fragmentSource: string;

  constructor(infoLog: string, vertexSource: string, fragmentSource: string) {
    super(
      [
        'WebGL2 program link failed.',
        `Driver info log (getProgramInfoLog):\n${infoLog.trim()}`,
        `Vertex shader source:\n${annotateSource(vertexSource, new Set())}`,
        `Fragment shader source:\n${annotateSource(fragmentSource, new Set())}`,
      ].join('\n'),
    );
    this.name = 'ProgramLinkError';
    this.infoLog = infoLog;
    this.vertexSource = vertexSource;
    this.fragmentSource = fragmentSource;
  }
}

export class ContextLostError extends Error {
  constructor(operation: string) {
    super(`WebGL2 context is lost; cannot perform "${operation}" until it is restored`);
    this.name = 'ContextLostError';
  }
}
