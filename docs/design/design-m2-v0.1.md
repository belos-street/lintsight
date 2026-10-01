# lintsight · M2 深度分析引擎技术设计（Rust sidecar 双引擎）v0.1

> 版本：v0.1（草案，待评审） · 日期：2026-10-01
> 上游依据：[requirements-v0.2.md](../requirements/requirements-v0.2.md) §2.4 sidecar 双引擎、§3.4 增量与缓存、§3.6 双报消解、§8.2 修订⑬ M2 内部排序 + [spikes/oxc-crate-poc.md](../spikes/oxc-crate-poc.md)（spike ①）+ [spikes/taint-poc-spike5.md](../spikes/taint-poc-spike5.md)（spike ⑤）
> 读者：引擎研发团队（Rust 轨道 + Bun 轨道）
> 定位：M2 动工前的实现设计——冻结 sidecar 接口形状、传播模型与切片边界。非 API 手册。
> 修订记录：
> - v0.1（2026-10-01）：初稿。吸收 spike ①（直连/性能/内存/版本锁）与 spike ⑤（taint 传播模型）全部实测结论。

---

## 1. 目标与验收边界

**一句话**：Rust sidecar 深度引擎与 oxlint 并行，补齐 L3（DFG/taint）与架构规则，双引擎诊断在报告层合并，性能与误报双门禁。

**验收标准**（承接 requirements §8.2 M2 行）：
1. taint 竖切上线：path-traversal 数据流规则在语料库误报 <10%（复核确认口径）
2. 架构规则上线：跨层 import / 依赖方向约束可配置
3. 性能：≥15 万 LOC/s（none 类单 worker 折算）、10 万行全量 <60s、增量 <5s
4. 双报率 0（语料库门禁延续 M1 纪律）
5. 失败降级：Rust 引擎任何异常 → 纯 M1 扫描照常出结果（fail-open）

**明确不做（M2 边界）**：
- ❌ 不重建规则宿主——oxlint 继续承载语法级/内置规则（§2.4 定案不推翻）
- ❌ 跨过程 taint / 调用图（M3，M2 先做过程内 + 调用点展开的保守近似）
- ❌ 自实现 type-aware 规则（铁律 3 永久有效）——只做 `--type-aware` 的编排与诊断降级
- ❌ LSP / 分布式分片 / 远端缓存（M3+）

## 2. 技术输入（两轮 spike 已消解的不确定性）

| 结论 | 来源 | 对设计的约束 |
| --- | --- | --- |
| L1/L2 直连可行：3.49M LOC/s、`cfg_id` AST↔CFG 桥存在 | spike ① | 挂载点定案 `SymbolId + cfg_id`；内存 1.1KB/LOC → 流式释放是硬约束 |
| 版本锁：oxc crates 与 oxlint 同日发布版对齐（`=0.150.0` ↔ 1.83.0） | spike ① + version-policy | Cargo `=` 锁 + cargo-deny（上游传递依赖重复 warn + skip 清单） |
| taint 模型：CFG worklist + SymbolId 状态可行，不动点收敛 | spike ⑤ | source/sink 函数表不得交叠（登记期校验）；for-of 迭代变量必须显式处理；sink 按 offset 去重 |
| `BindingPattern` 是 enum 无 Kind 包装（0.150） | spike ⑤ | Rust 轨道 API 以 0.150 源码为准，不背旧版记忆 |
| oxlint 嵌入式 runtime 不支持 `{enter, exit}` visitor；插件崩溃输出无 code 诊断 | S6 期间实测 | M1 规则写法约束（':exit' 键）；桥接层 code 兜底已上线 |

## 3. 总体架构（sidecar 双引擎）

```text
                       lintsight CLI（Bun 编排层）
  ┌─────────────┐   文件清单+配置   ┌──────────────────┐
  │ collectFiles │ ──────────────→ │  双引擎编排器       │
  └─────────────┘                  └────┬─────────┬───┘
                                        │         │
                    spawn(进程内 JSON 流) │         │ 进程内库调用（oxlint 自身）
                                        ▼         ▼
                          ┌──────────────────┐  ┌─────────────┐
                          │ lintsight-engine  │  │   oxlint     │
                          │ (Rust sidecar)   │  │ 语法级/内置规则│
                          │ L3 taint/DFG     │  │ + JS Plugins │
                          │ 架构规则/type-aware│  │ (M1 已验证)  │
                          └────┬─────────┬───┘  └──────┬──────┘
                               │         │             │
                          诊断流(JSON)  类型事实        诊断流(JSON)
                               └────┬────┴─────────────┘
                                    ▼
                          合并层：排序 + 双报消解（§3.6）+ 指纹（M1-DR2 口径）
```

- Rust 引擎消费 oxc crates（parser/semantic/cfg）进程内直连，oxc `=0.150.0` 精确锁（对齐当前 oxlint 1.83.0）。
- M1 Bun 层职责不变：编排、Vue 处理、缓存、报告、exit code。Rust 引擎是**新增诊断来源**，不是替代。

## 4. 模块设计

### 4.1 `crates/lintsight-engine`（Rust）

- 独立 cargo 工程，不进 Bun workspaces（与 spike ① 的 oxc-poc 同目录级）。
- 模块划分：
  - `engine-io`：stdin/stdout JSON 流协议（见 4.2）；`--file-list` / `--config` / `--rules` 参数面
  - `taint`：污点状态机 + CFG worklist（spike ⑤ 模型产品化：函数入口块精确定位、状态按块寻址、Backedge 不动点）
  - `sources-sinks`：source/sanitizer/sink 函数表（注册表驱动，登记期交叠校验）
  - `arch-rules`：import 图消费（复用 oxlint module graph 的产物或 oxc resolver）
  - `type-aware`：oxlint --type-aware 子编排 + `typescript(tsconfig-error)` 诊断降级（spike ③ 结论）
- 内存纪律：文件级 `Allocator` 流式 drop（spike ① 实测 1.1KB/LOC 峰值）。

### 4.2 引擎诊断协议（v0）

- 方向：M2 → M1 单向流（M1 → M2 的输入走启动参数与 stdin 文件清单）。
- 格式：stdout 逐行 JSON（JSON Lines），每行一条诊断或一条控制消息：

```jsonc
{"type":"diagnostic","ruleId":"lintsight-engine/no-path-traversal","severity":"error",
 "message":"…","file":"src/lib/db.ts","span":{"offset":…,"length":…,"line":…,"column":…},
 "pathEvents":[
   {"kind":"source","node":"fs.readdirSync","file":"…","offset":…},
   {"kind":"propagation","node":"path.join","offset":…},
   {"kind":"sanitizer","node":"SAVE_FILE_RE.test","offset":…},
   {"kind":"sink","node":"fs.readFileSync","offset":…}
 ]}
{"type":"summary","files":N,"iterations":…}
```

- `pathEvents`（附录 C 路径事件流 v0）是 taint 规则的必带证据链——平台 AI 研判（FR-601）与人工复核都依赖它；M1 诊断无此字段（向后兼容，合并层可选字段）。
- ruleId 命名空间：Rust 引擎诊断统一 `lintsight-engine/<rule-name>`——与 JS 规则 `lintsight/<name>` 区分归属，双报消解按 §3.6。

### 4.3 桥接与合并（Bun 侧，`@lintsight/cli` 扩展）

- 引擎二进制解析链（承接 M1-DR1 风格）：`OXLINT_ENGINE_BIN` 环境变量 → `node_modules/.bin/lintsight-engine` → cargo build 产物路径（开发态）。三处皆无 → 降级纯 M1（fail-open）。
- 合并层：Rust 诊断 + oxlint 诊断 → `normalizeDiagnostics` 统一 → 按 (file, offset, ruleId) 排序（M1-DR4）→ 双报消解 → 指纹。
- 指纹口径不变：`sha256(ruleId + file + span + message)`——Rust 诊断同样纳入，铁律 7 全局有效。

### 4.4 双报消解落地（§3.6）

- 归属矩阵（v0，随注册表演进）：同一问题域的语法级规则（owner=lintsight-js）与数据流规则（owner=lintsight-engine）**允许共存**——数据流版检出后在合并层**抑制同文件同 span 的语法级低置信版本**（如 no-non-literal-fs-filename 被 no-path-traversal 覆盖时抑制），抑制关系在注册表登记（`supersedes` 字段）。
- 双报率门禁延续：`corpus:check` 扩展到三 owner（lintsight-js / lintsight-engine / oxlint-native）。

## 5. 关键决策（M2-DR，含备选与否决理由）

### M2-DR1 引擎诊断协议：stdout JSON Lines（单进程、单管道）

- 备选 a）gRPC/HTTP 长驻服务——**否决**：M2 验收是 CLI 场景，服务化是平台长驻 worker（M3）的需求，为它引协议栈过早；b）SQLite 落盘交换——**否决**：多一层数据库状态管理，破坏「进程结束即结果」的简洁性；c）napi 进程内绑定——**否决**：绑定层让 Bun/Rust 版本耦合，且崩溃即拖垮宿主进程（sidecar 的隔离价值归零）。JSON Lines 在 M3 服务化时可平移（协议不变，换传输）。

### M2-DR2 taint 模型：CFG worklist + SymbolId 状态挂载

- 备选 a）纯 AST 数据流（不建 CFG）——**否决**：路径不敏感带来海量误报，是 requirements §8.3 反模式 #1；spike ⑤ 同时证明了 CFG 版可低成本实现。b）SVFG/值依赖图全量构建——**否决**：M2 竖切不需要；状态按 `SymbolId + cfg_id` 寻址已够，图构建留给 M3 跨过程。

### M2-DR3 失败降级 fail-open

- 引擎二进制缺失 / 崩溃 / 超时 → 该批文件回退纯 M1 扫描并在报告 `degraded: true` 标注。**否决 fail-closed**（引擎失败则整体 exit 2）：SAST 门禁「没结果比没引擎更糟」，与缓存降级同纪律。

### M2-DR4 分发形态：预编译二进制 + 版本对齐发布

- `cargo build --release` 产物随 lintsight release 分发（平台按 OS/ARCH 下载）；版本对齐口径与 spike ① 相同（oxc crates 与 oxlint 同日发布版）。备选 napi 进程内——否决理由见 DR1-c。

### M2-DR5 source/sanitizer/sink 表治理：注册表驱动 + 登记期交叠校验

- spike ⑤ 教训 #1 制度化：函数表进注册表（独立 section），CI 校验 source ∩ sink = ∅；表变更 = 规则行为变更，走语料基线 diff。

## 6. 里程碑切片（M2 T2.1~T2.6 的实现边界）

| 切片 | 范围 | 验收 |
| --- | --- | --- |
| T2.1 脚手架 | engine-io + 桥接 + 降级 | cargo test + bun spawn 联通；降级路径有测试 |
| T2.2 消费层 | semantic/CFG 封装 + 流式分配 | spike ① walk 模式产品化；大文件内存曲线达标 |
| T2.3 taint 竖切 | worklist 产品化 + no-path-traversal | text-rpg readdir→join→readFile 判定正确（sanitizer 不误报）；语料基线零意外漂移 |
| T2.4 架构规则 | import 图 + 依赖方向 | 配置示例进 dogfood；误报复核清单 |
| T2.5 合并与契约 | 双报消解 + SARIF + type-aware 编排 | 三 owner 双报率 0；SARIF 输出 schema 快照 |
| T2.6 性能 | rayon 并行 + 增量 | §3.5 预算全达标 + bench 门禁扩展到引擎 |

## 7. 风险与开放问题

1. **Rust/TS 双栈人才**：规则层 JS/Rust 双轨的交接面 = 注册表 + 诊断模型，两边都不需要全栈理解（requirements §8.3 人才对冲的有效性待 M2 实测）。
2. **跨过程近似的误报**：M2 只做过程内 + 调用点保守展开，跨文件污点边界可能漏报（漏报优于误报的定位已评审）。
3. **oxc 上游节奏**：周更 + minor 破坏性变更（spike ① 实测 `BindingPattern` 形态变化）——引擎侧锁死版本，升级走独立评审。
4. **开放问题 1**：`pathEvents` 的粒度（表达式级 vs 语句级）待 T2.3 竖切后按平台消费需求定。
5. **开放问题 2**：type-aware 与 taint 的联合判定（类型事实增强污点过滤）是 M3 方向，M2 只做编排并行。
