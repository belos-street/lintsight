# lintsight

面向企业级大规模 JS/TS 代码库的静态分析引擎（SAST）。

双引擎架构：**M1** 以 [oxlint](https://github.com/oxc-project/oxc) 为基座（解析 / 调度 / 并行 / 规则宿主全部复用，Bun 封装编排），自有规则走 oxlint JS Plugins；**M2** 为 Rust 深度分析引擎（sidecar），基于 oxc crates 提供污点分析（taint）、CFG 数据流与架构治理规则，并携带完整的路径证据链。

```
            ┌────────────────────────────────────────────┐
            │          lintsight CLI（Bun 编排层）         │
            │  配置桥接 · 缓存 · Vue 虚拟化 · 诊断归一化    │
            └───────────────┬───────────────┬────────────┘
                            │               │
              spawn + JSON Lines     oxlint --config
                            │               │
            ┌───────────────▼───┐   ┌───────▼────────────┐
            │  M2 深度引擎 (Rust) │   │  M1 oxlint 基座     │
            │  oxc crates 直连    │   │  JS Plugins 宿主    │
            │  taint / CFG / 图   │   │  865+ 内置规则      │
            │  lintsight-engine/*│   │  lintsight/*        │
            └───────────────┬───┘   └───────┬────────────┘
                            │  诊断合并（指纹 + supersedes 消解）│
                            ▼               ▼
                     json / text / SARIF 报告
```

## 特性

- **双引擎，一份报告**：oxlint 内置规则面（865+）+ 自有规则 33 条（JS 轨道 25 + 引擎轨道 8），合并层按指纹去重、按 `supersedes` 消解同位置双报。
- **污点分析带证据链**：引擎 taint 规则输出 `source → propagation → [sanitizer] → sink` 的 pathEvents 证据链，供平台 AI 研判与人工复核。
- **误报治理是工程纪律**：每条规则强制 `falsePositives` 自证；6 个真实仓库（zod / dayjs / express / juice-shop / nodegoat / ghost，5596 文件）作为语料库基线，诊断面漂移即评审信号；OWASP juice-shop 官方挑战清单逐挑战召回对照制度化。
- **fail-open**：引擎二进制缺失或崩溃 → 自动降级纯 M1 扫描，绝不阻塞业务流水线。
- **确定性输出**：诊断按 (file, offset, ruleId) 排序，指纹 = `sha256(ruleId + file + span + message)`，跨运行可 diff、可入库。
- **内容哈希缓存**：引擎/配置/插件任一指纹变化自动失效；`--fix` 模式自动绕过。
- **Vue SFC 支持**：虚拟块就地虚拟化（保 import 解析上下文），诊断位置 1:1 回映射；`--fix` 行数不变的 safe fix 差量回写。
- **type-aware 编排**：`typeAware: true` 追加 oxlint `--type-aware`（tsgolint），伴生依赖缺失自动降级并提示。
- **性能**：深度引擎实测 1.39M LOC/s（NFR-1 预算 150k LOC/s 的 9 倍余量），万行冷扫 <10s 硬门禁 + 基线回退拦截。

## 快速开始

前提：[Bun](https://bun.sh) ≥ 1.2；M2 引擎需 Rust 工具链（可选，缺失自动降级）。

```bash
git clone <repo-url> && cd sast-engine
bun install

# 可选：构建 M2 深度引擎（不构建则纯 M1 扫描）
cargo build --release --manifest-path crates/lintsight-engine/Cargo.toml

# 扫描
bun run cli -- packages/ plugins/
```

单文件编译产物（59MB，自包含）：

```bash
bun run build:binary && ./dist/lintsight <paths...>
```

### 扫描结果

```console
$ bun run cli -- examples/
lintsight: 4 file(s) scanned, 1 diagnostic(s)

$ echo $?
1
```

json 报告（`--format json` 默认输出）节选：

```json
{
  "contractVersion": "1",
  "ruleId": "lintsight-engine/no-path-traversal",
  "severity": "error",
  "message": "Untrusted filename from fs.readdirSync reaches fs.readFileSync without sanitization; …",
  "file": "routes/files.ts",
  "span": { "offset": 512, "length": 24, "line": 18, "column": 5 },
  "fingerprint": "9c1f…",
  "owner": "lintsight-engine",
  "pathEvents": [
    { "kind": "source", "node": "fs.readdirSync", "offset": 231 },
    { "kind": "propagation", "node": "path.join", "offset": 470 },
    { "kind": "sink", "node": "fs.readFileSync", "offset": 512 }
  ]
}
```

退出码语义（由封装层统一，不透传 oxlint 的歧义码）：

| 退出码 | 含义 |
| --- | --- |
| 0 | 无 error 级诊断 |
| 1 | 有 error 级诊断 |
| 2 | 运行错误（配置非法 / oxlint 不可得 / 无可扫文件） |

## 配置

项目根放 `lintsight.config.json`（JSONC，支持注释）：

```jsonc
{
  // 规则键逐条列举，值为级别或 [级别, 选项对象]
  "rules": {
    "lintsight/no-empty-catch": "error",
    "lintsight/no-hardcoded-credentials": ["error", { "testFiles": "report" }],
    "lintsight/no-insecure-cookie": "warn"
  },
  // Vue SFC 处理器
  "overrides": [{ "files": ["**/*.vue"], "processor": "@lintsight/vue" }],
  // M2 架构规则（opt-in 能力见下）
  "arch": {
    "zones": [
      { "name": "core", "match": ["src/core/**"], "allow": [] },
      { "name": "ui", "match": ["src/ui/**"], "allow": ["src/core/**"] }
    ],
    // 循环依赖检测（词法 import 图 + SCC）
    "importCycles": true,
    // package.json exports 公共 API 面约束（深导入报告）
    "enforceExports": true
  },
  // type-aware 编排（tsgolint 缺失自动降级）
  "typeAware": false
}
```

要点：

- `zones` 文件按 `match` 首匹配归 zone，同 zone 互引恒允许；跨 zone 目标必须命中 `allow` glob。裸说明符走 tsconfig paths 别名兜底（支持嵌套 tsconfig / per-package paths，最近祖先语义）。
- `importCycles` / `enforceExports` 默认关闭（契约稳定性优先，试点后自定开启）。
- 测试文件口径：安全规则默认豁免 `*.test.*` / `*.spec.*` / `__tests__|test|tests`，`testFiles: "report"` 可恢复。

## 规则面

### JS 轨道（`lintsight/<name>`，25 条）

**正确性（11）**

| 规则 | 说明 |
| --- | --- |
| no-empty-catch | catch 块不得为空（支持注释占位豁免选项） |
| no-empty-promise-catch | `.catch(() => {})` 空处理 |
| no-swallowed-promise-error | 捕获的 error 未引用也未重抛 |
| no-floating-promise | promise 未 await / 未显式标注 |
| no-async-array-method | 异步函数传入 `forEach`/`map` 等同步数组方法 |
| no-async-constructor-call | 构造函数内调用未等待的 async 方法 |
| no-closure-loop-var | 闭包捕获循环变量（var / 块外 let） |
| no-array-map-side-effect | `map` 回调内有副作用（应 `forEach`） |
| no-ignored-reduce-result | `reduce` 返回值被忽略 |
| no-json-structured-clone | 用 `JSON.parse(JSON.stringify())` 深拷贝 |
| no-sync-io-in-async | async 函数内的同步 IO |

**安全（14）**

| 规则 | 说明 |
| --- | --- |
| no-hardcoded-credentials | 硬编码凭证（key/value 启发式 + 熵） |
| no-sensitive-storage | 敏感数据落 localStorage / cookie 等 |
| no-sql-concat | SQL 语句字符串拼接 |
| no-child-process-nonliteral | 子进程命令非字面量（taint 版接管见引擎轨道） |
| no-non-literal-fs-filename | fs 文件名非字面量（taint 版接管见引擎轨道） |
| no-non-literal-require | 动态 require/import 装载任意模块 |
| no-prototype-pollution-syntax | 字面量 `__proto__`/`constructor` 键合并 |
| no-innerhtml-assignment | innerHTML 赋值 |
| no-unsafe-regex | 用户输入直接进 RegExp（ReDoS 面） |
| no-math-random-secret | `Math.random` 用于凭证/令牌 |
| no-weak-hash | MD5/SHA1 弱哈希 |
| no-insecure-cookie | cookie 未设 HttpOnly/Secure |
| no-cors-wildcard | CORS `Access-Control-Allow-Origin: *` |
| no-vm-dynamic-code | `vm.runInNewContext` 等动态代码执行 |

### 引擎轨道（`lintsight-engine/<name>`，8 条）

| 规则 | 检测层 | 说明 |
| --- | --- | --- |
| no-eval | syntax | `eval()` 动态代码执行（CWE-95） |
| no-path-traversal | taint | 外部可控文件名未消毒抵达 fs 读写（CWE-22） |
| no-command-injection | taint | 外部可控输入抵达 shell 执行（CWE-78） |
| no-ssrf | taint | 外部可控 URL 抵达服务端出站请求（CWE-918） |
| no-prototype-pollution-merge | taint | 可控对象流入合并/深写目标（CWE-1321） |
| arch-boundaries | local | zone 依赖方向约束（配置驱动） |
| no-import-cycle | graph | 循环依赖（Tarjan SCC；type-only 边不计） |
| no-deep-import | graph | 绕过 package.json exports 公共 API 的深导入 |

taint 规则的 source/propagator/sanitizer/sink 全部注册表驱动（`TaintTables`），登记期两两交叠校验；补表前按 semgrep / CodeQL 上游语料校准形态（见 rule-authoring skill）。

## CLI 参考

```
lintsight <paths...> [--config <lintsight.config.json>] [--format json|text|sarif]
          [--output <file>] [--log-level debug|info|warn|error] [--fix] [--no-cache]
```

| 参数 | 说明 |
| --- | --- |
| `--format` | `json`（默认）/ `text` / `sarif`（GitLab/GitHub Code Scanning 可直接消费） |
| `--output` | 报告写入文件（不污染 stdout） |
| `--fix` | oxlint safe fix 就地改写；Vue 虚拟块行数不变时差量回写；自动绕过缓存 |
| `--no-cache` | 关闭内容哈希缓存（冷扫） |
| `--config` | 显式指定 lintsight.config.json |

环境变量：`OXLINT_BIN` 显式指定 oxlint 可执行文件；`OXLINT_ENGINE_BIN` 显式指定深度引擎二进制（CI 镜像 / 平台分发场景）。

## 语料库与质量门禁

```bash
bun run corpus:sync     # 同步 6 个锁定 tag 的真实仓库（zod/dayjs/express/juice-shop/nodegoat/ghost）
bun run corpus:check    # 冷扫 + 双报率 0 门禁 + 指纹级基线 diff（漂移 = 评审信号）
bun run corpus:recall   # juice-shop 官方 111 挑战逐挑战召回对照
bun run bench           # hyperfine 万行基准：<10s 硬门禁 + 引擎/端到端回退 >15% 拦截
```

- 基线漂移必须逐条评审后显式重建（`corpus:check -- --save`），与 version-policy 同款纪律。
- juice-shop 召回对照：recalled 10 / pending-human 16（人工复核清单）/ 无静态锚点 85，见 `docs/spikes/juice-shop-recall-v0.2.md`。
- 规则行为变更视同破坏性变更：message 文案参与指纹计算，改动走显式评审。

## 开发

```bash
bun install
bun run test          # 全部测试（自动构建规则集产物；bun 140 + cargo 46）
bun run lint          # dev-lint（0 警告基线）
bun run format        # oxfmt
```

写规则前必读 `.agents/skills/rule-authoring`（用例先行 → meta 完备 → 语料库门禁 → 注册表登记）；动 oxlint 配置 / spike / 升级前必读 `.agents/skills/oxc-toolchain`。

### 目录结构

```
├─ packages/                  # Bun workspaces（@lintsight/*）
│  ├─ lintsight-cli           # CLI + pipeline 编排 + oxlint/engine 桥接 + 缓存
│  ├─ lintsight-config-bridge # lintsight.config.json → .oxlintrc 翻译 + schema 校验
│  ├─ lintsight-diagnostic    # 统一诊断模型 / 指纹 / 规则注册表 / 双报消解
│  ├─ lintsight-formatter     # json / text / SARIF
│  ├─ lintsight-rule-sdk      # defineRule / definePlugin 契约 + RuleTester
│  ├─ lintsight-vue-processor # SFC 虚拟块 + 位置回映射
│  ├─ lintsight-shared        # logger
│  └─ rules-core              # 自有 JS 规则源码（每规则一文件）
├─ plugins/lintsight-rules/   # 规则集聚合产物（自包含单文件，构建生成）
├─ crates/lintsight-engine/   # M2 Rust 深度引擎（taint / 图 / 架构规则）
├─ fixtures/                  # 规则用例契约（断言依赖行列布局，勿格式化）
├─ corpus/                    # 语料库基线与清单（仓库体 gitignore，corpus:sync 拉取）
├─ docs/                      # 需求 / 设计 / spike 报告（版本化）
└─ .agents/skills/            # 工程技能（rule-authoring / oxc-toolchain / belos-street）
```

### 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/requirements/requirements-v0.2.md](docs/requirements/requirements-v0.2.md) | 总体技术设计（选型/架构/里程碑/风险） |
| [docs/design/design-m1-v0.1.md](docs/design/design-m1-v0.1.md) | M1 实现设计（M1-DR1~7） |
| [docs/design/design-m2-v0.1.md](docs/design/design-m2-v0.1.md) | M2 实现设计（sidecar 协议/taint 模型/M2-DR1~5） |
| [docs/design/p0-rules-proposal-v0.1.md](docs/design/p0-rules-proposal-v0.1.md) | P0 规则清单提案（CWE/OWASP 映射） |
| [docs/spikes/](docs/spikes/) | 可行性验证与实测报告（竖切 / oxc crate / tsgolint / taint PoC / juice-shop 召回） |
| [docs/todo.md](docs/todo.md) | 当前执行 Todo |

## 状态与路线图

- **M1（oxlint 基座 + Bun 封装）**：已完成——7 个执行切片 + 3 个真实项目试用（127 文件 / 43 诊断 / 误报标注反哺 2 条规则行为）。
- **M2（Rust 深度引擎）**：已完成——sidecar 协议、CFG taint 引擎、4 条 taint 规则 + 3 条治理规则、双报消解、SARIF、rayon 并行（1.39M LOC/s）；M2.7 精度批次（测试文件豁免 -89% 凭证噪音、taint 边界补齐、消解对扩充、架构能力 3 项）收官。
- **M3（规划中）**：L4 跨过程调用图与跨文件 taint、type-aware taint 增强、LSP/IDE 集成 alpha、高级 fixer 策略、平台化闭环（design-m3 评审后启动）。

## License

当前为私有项目，未附带开源协议。
