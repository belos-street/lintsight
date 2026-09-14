# 版本锁定与升级纪律

oxlint/oxc 上游迭代快（minor 版本即可能新增诊断）。lintsight 作为平台扫描内核，**结果确定性 > 新功能**——所有依赖走本篇纪律。

## 锁定策略

| 依赖 | 策略 |
| --- | --- |
| `oxlint`（npm，M1 宿主） | workspace 内 `=` 精确锁版本；禁止 `^`/`latest` |
| `oxlint-tsgolint` | 与 oxlint 配套版本一起锁（`@7` 大锁 + 精确小版本） |
| oxc crates（M2，Cargo） | `=x.y.z` 精确锁 + `cargo-deny` 校验；升级视为一次规则行为变更 |
| JS Plugins 运行时 | 无独立依赖（oxlint 内置），随 oxlint 升级统一回归 |

## 升级流程（缺一步不得合入）

1. **变更日志审读**：oxc releases + JS Plugins API 变更（alpha 期 API 可能漂移）；
2. **语料库 diff**：3 个语料库全量重扫，诊断 diff 逐条评审——新增诊断要判断是真问题还是上游误报（FR-702）；
3. **指纹稳定性验证**：同语料两次扫描指纹一致率 100%（FR-401 验收口径），上游 span 计算变化会破坏平台历史关联；
4. **性能基准**：hyperfine 对照，回退 >15% 拦截（FR-703/NFR-1）；
5. **双报断言**：M2 起语料库双报率仍为 0（FR-407）。

## 已知上游风险（§8.3 风险清单对应项）

- JS Plugins alpha：API 与行为可能随版本变化 → 语料库门禁兜底；
- oxc 语义层未冻结：minor 版本可能改 AST/语义结构 → M2 深度引擎锁死版本，升级走独立评审；
- nursery category 永不启用：配置含义会随 patch 漂移。

## 官方资源与工具

- 官方迁移 skill：`npx skills add https://github.com/oxc-project/oxc --skill migrate-oxlint`（ESLint→oxlint，FR-502 的参照实现；来源：npm oxlint README，2026-09 核实）
- 配置迁移 CLI：`npx @oxlint/migrate [--type-aware]`（来源：oxc.rs「Migrate from ESLint」文档，2026-09 核实）
- 重合规则关闭：`eslint-plugin-oxlint`（渐进迁移期与 ESLint 并跑用）
- 兼容性矩阵：https://oxc.rs/compatibility.html
