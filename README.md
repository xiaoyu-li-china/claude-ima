# claude-ima — 体积云渲染器 · 基础工程层

原生 **WebGL2 + GLSL ES 3.00 + TypeScript（strict）+ Vite** 实现的体积云渲染器地基。
**不使用** Three.js / Babylon.js / CesiumJS 等任何引擎或现成云渲染库，**不使用 docker**。

当前阶段只交付底层基础架构：工程骨架、GL 工具层、数学库、画质配置、上下文恢复与可观测性。
**暂未实现** raymarching 核心渲染、噪声纹理与阴影——渲染层用一个全屏渐变片元着色器
（`src/render/shaders.ts`）验证整条管线，后续替换该片元阶段即可，资源/帧/resize 骨架不变。

## 技术约束与落实方式

| 约束 | 落实 |
| --- | --- |
| TypeScript 严格模式 | `tsconfig.json` 中 `strict: true`，并开启 `noUnusedLocals/Parameters`、`noImplicitReturns` 等 |
| 禁止 `any` 逃逸 | 构建前置守卫 `scripts/check-no-any.mjs`（剥离注释/字符串后做整词匹配），出现代码中的 `any` 即构建失败；需要动态类型时用 `unknown` + 收窄 |
| 无引擎/无云库 | `package.json` 运行时依赖为零；`puppeteer-core` 仅在 devDependencies，且只驱动系统 Chrome 做无头测试，不进入产物 |
| 无 docker | 所有命令在本机 Node ≥ 20 直接运行 |

## 目录结构与模块职责

```
claude-ima/
├── index.html                  # 页面骨架 + HUD 面板（上下文状态/档位/自测结果）
├── vite.config.ts              # Vite 配置（base、es2020 目标、固定 dev 端口）
├── tsconfig.json               # strict TS 配置，noEmit，类型检查由 tsc 承担
├── scripts/
│   ├── check-no-any.mjs        # 禁止 any 的源码守卫（先剥离注释和字符串再匹配）
│   ├── run-tests.ts            # Node 侧自测入口（数学库 + 配置校验，经 tsx 运行）
│   └── browser-smoke.mjs       # 无头 Chrome 端到端冒烟（puppeteer-core + 系统 Chrome）
└── src/
    ├── main.ts                 # 组合根：创建上下文/渲染器/viewport/HUD，驱动渲染循环与调试 API
    ├── styles.css              # 页面与 HUD 样式
    ├── math/                   # 零依赖数学库（DOM 无关，浏览器与 Node 共用）
    │   ├── vec3.ts             #   三维向量：加减、缩放、点积/叉积、归一化
    │   ├── mat4.ts             #   列主序 4x4：identity/multiply/perspective/lookAt/invert/transformPoint
    │   ├── selftest.ts         #   四个数学自测用例（见下）
    │   └── index.ts
    ├── gl/                     # WebGL2 工具层
    │   ├── errors.ts           #   ShaderCompileError / ProgramLinkError / ContextLostError，含 infoLog 原文与带行号源码
    │   ├── registry.ts         #   ResourceRegistry 资源登记表 + TrackedResource 幂等 dispose 基类
    │   ├── program.ts          #   编译/链接封装 ShaderProgram，缓存 uniform location
    │   ├── buffer.ts           #   GLBuffer 封装
    │   ├── vao.ts              #   VertexArray(VAO) 封装
    │   ├── texture.ts          #   Texture2D 封装（占位纹理；噪声纹理后续在此扩展，生命周期不变）
    │   ├── context.ts          #   GLContext：getContext、contextlost/restored 生命周期、恢复回调
    │   ├── gl-selftest.ts      #   依赖真实 GL 的自测（错误路径、登记/释放、泄漏断言）
    │   └── index.ts
    ├── config/
    │   ├── quality.ts          #   ★ 画质档位唯一数据源 + validateQualityTier 校验器
    │   └── config-selftest.ts  #   合法/非法配置校验自测
    ├── render/
    │   ├── shaders.ts          #   GLSL 源码（全屏三角形顶点 + 渐变片元，占位渲染）
    │   ├── viewport.ts         #   CanvasViewport：ResizeObserver + DPR 观测，缓冲尺寸不变式
    │   └── renderer.ts         #   CloudRenderer：资源创建/上下文恢复重建/逐帧绘制
    └── ui/
        └── hud.ts              # 侧边面板所有 DOM 更新，其余模块不直接碰 DOM
```

## 运行与自测

```bash
npm install
npm run dev          # 开发服务器（默认 http://127.0.0.1:5173，strictPort；端口被占用时换 --port）
npm run build        # check:no-any → tsc --noEmit 严格类型检查 → vite 生产构建
npm run preview      # 预览生产构建
npm test             # Node 侧自测：数学库 4 例 + 配置校验 11 例（共 15 例）
npm run test:browser # 先 build，再用系统 Chrome 无头跑 41 项端到端检查
npm run test:all     # 上面两类测试依次执行
```

浏览器打开后，三类自测结果同时显示在右侧 HUD 并打印到控制台：

- **数学库自测**（`src/math/selftest.ts`，容差 1e-5）：
  1. 单位矩阵：`I×I = I` 且 `I·p = p`；
  2. 透视投影往返：`invert(P) × P ≈ I`；
  3. `lookAt` 正交性：旋转三轴单位且两两正交（`R·Rᵀ ≈ I`）；
  4. 逆投影还原 NDC：view → NDC → `P⁻¹` → view 往返一致。
  `perspective` 与 `invert` 因此在 f32 数值误差内严格互为逆矩阵。
- **配置校验自测**（`src/config/config-selftest.ts`）：三个内置档位必须合法；8 种非法配置
  （步进数 0/非整数/负数、缩放 0/>1/负数、未知档位名、非对象）必须被拒绝并抛出可读的 `QualityConfigError`。
- **GL 工具层自测**（`src/gl/gl-selftest.ts`，需真实 GL，故在无头浏览器中跑）：
  编译/链接错误携带驱动 infoLog 与源码行号；资源登记计数；重复 `dispose()`/`disposeAll()` 不报错；
  `isBuffer/isTexture/isVertexArray/isProgram` 断言释放后底层句柄失效（无泄漏）；构造中途抛错不残留登记项。

## 上下文丢失 / 恢复策略

实现在 `src/gl/context.ts` 与 `src/gl/registry.ts`，流程如下：

1. **丢失**：canvas 收到 `webglcontextlost` 时先 `event.preventDefault()`（否则浏览器不会恢复），
   状态置为 `lost`；渲染循环在状态回调里 `cancelAnimationFrame` 暂停（`render()` 内部也有 `isLost` 兜底）。
2. **释放引用**：`ResourceRegistry.invalidateAll()` 对每个资源调用 `invalidateAfterContextLoss()`——
   旧 GL 句柄已随上下文失效，此路径**只清空引用、不发任何 GL 调用**（丢失期发 GL 调用是错误的），
   登记表归零，HUD 资源数显示 0。
3. **恢复**：收到 `webglcontextrestored` 后状态置回 `active`，按注册顺序执行恢复回调。
   `CloudRenderer` 在构造时通过 `GLContext.onRestore()` 注册了**与首次启动完全相同的资源工厂**
   （`buildResources()`），因此 program/VBO/VAO 以相同路径在新上下文重建并重新登记。
4. **继续渲染**：状态回调重新触发 `viewport.refresh()` 校正缓冲尺寸并重启 rAF 循环。

HUD 顶部实时显示 `active / lost` 状态；「模拟上下文丢失」按钮通过 `WEBGL_lose_context`
扩展主动触发整条丢失-恢复链路，便于手动验证。

## 画布尺寸与 DPR 处理（无拉伸保证）

`CanvasViewport` 维护不变式：

```
canvas.width  === round(clientWidth  × devicePixelRatio × resolutionScale)
canvas.height === round(clientHeight × devicePixelRatio × resolutionScale)
```

- `ResizeObserver` 观测 CSS 尺寸，连续触发在单个 `requestAnimationFrame` 内合并，且仅当算出的
  缓冲像素确实变化时才重写 `canvas.width/height`（避免反馈循环与无谓的帧缓冲重分配）；
- `devicePixelRatio` 变化（跨显示器、浏览器缩放、无头模拟）用每帧一次的数值比对兜底——
  `matchMedia` 的 `change` 事件在模拟 DPR 下并不可靠；比对本身每帧只有一次数字比较，重活仍然按变化门控；
- 每帧 `gl.viewport(0,0,canvas.width,canvas.height)` 直接取实时缓冲尺寸，CSS 仅按元素盒拉伸，
  因此缓冲与 CSS 尺寸永远一致，不会出现画面拉伸。无头测试对初始、连续 resize、DPR 1→2→1、
  各档位缩放、上下文恢复后分别断言该不变式。

## 画质配置：单一数据源约定

**唯一数据源是 `src/config/quality.ts` 中的 `QUALITY_TIERS` 表**（当前值）：

| 档位 | raymarchSteps（正整数） | resolutionScale（∈(0,1]） |
| --- | --- | --- |
| smooth | 48 | 0.75 |
| balanced（默认） | 96 | 1.0 |
| ultra | 192 | 1.0 |

约定：

- HUD 的档位按钮由 `QUALITY_TIER_LIST` 动态生成，渲染器只接收 `getTier()` / `validateQualityTier()`
  的返回值，README 仅描述该表位置——**任何模块都不得再硬编码步进数或缩放值**；调参只改这一张表。
- 模块加载时即对整张表跑一次 `validateQualityTier`，表本身被改坏会在 import 阶段快速失败。
- 每次 UI 切换档位都重新经过校验器：`raymarchSteps` 必须是正整数，`resolutionScale` 必须在 `(0,1]`，
  非法配置抛出 `QualityConfigError`，切换被拒绝、错误信息显示在 HUD，渲染器保持原档位不变。
- 切换档位后 `viewport.refresh()` 按新 `resolutionScale` 重算缓冲尺寸，HUD 同步显示当前档位与生效参数。

## 资源生命周期约定

- 所有 GL 对象（program/buffer/VAO/texture）继承 `TrackedResource`，构造即登记到 `ResourceRegistry`，
  `dispose()` 幂等：重复调用直接返回，不抛错、不重复计数；
- 构造函数中 GL 创建若失败，先 `abortConstruction()` 注销半成品再抛出，登记表不留残渣；
- 页面 `pagehide` 时统一 `stopLoop → viewport.dispose → renderer.dispose → context.dispose`。

## 后续接入点（当前刻意留白，无 stub/TODO 冒充）

- 将 `src/render/shaders.ts` 的渐变片元替换为 raymarching 片元，步进数直接取
  `CloudRenderer.currentTier.raymarchSteps`（已作为 uniform 注入并被真实消费）；
- 噪声纹理在 `src/gl/texture.ts` 的生命周期框架内新增上传方法；
- 阴影与相机可复用 `src/math` 的 `perspective/lookAt/invert`（逆投影已验证）。
