# SAST 评审检查清单

> 用法：按 A→H 顺序取证；每条记录“证据 / 判断 / 红旗”。证据优先用 `file:line` 或命令输出；文档自报必须标注“自报”。

## A. 快照与范围

- [ ] 记录 `git rev-parse HEAD`、`git status --short`、构建文件、CI 配置。
- [ ] 明确评审边界：是引擎、规则集、平台，还是三者混合；平台能力是否被误算进引擎。
- [ ] 明确目标栈：Vue/React/Angular、Express/Nest/其他、ORM/数据库。
- [ ] 记录跑过/没跑过的命令；缺依赖、缺语料、缺工具都写“未验证”。

## B. 声明 vs 事实

- [ ] 从 README/设计文档/升级计划提取可证伪声明：规则数、性能、召回、误报、测试数、CI、扩展性、平台契约。
- [ ] 每条声明建一行：`声明 | 来源 | 实测/证据 | 差异/口径`。
- [ ] 规则数分三口径：**注册**（`--rules`）、**启用**（配置生效）、**有效**（实际产生诊断）。
- [ ] 性能分两口径：**引擎单测**（parse/taint/规则）与**端到端**（含 oxlint spawn/缓存/IO）。
- [ ] 测试分两口径：`bun test` / `cargo test` 是否都在默认命令里；README 数字是否过期。
- [ ] 召回分两口径：全部样本 vs “可静态锚定”子集；精确行 vs 锚点区域任意命中。

## C. 架构

### C1 分层与依赖方向

- [ ] 入口层（CLI/pipeline）是否只做编排，业务逻辑是否下沉。
- [ ] 包之间依赖是否单向；有没有循环依赖；共享层是否被塞入业务。
- [ ] 一个框架/规则的改动会穿透几层：CLI → bridge → engine → rules → plugin。

### C2 解析器抽象

- [ ] JS 轨道规则是否只走 ESLint 兼容 API，不 import parser AST。
- [ ] Rust 轨道是否真正有 IR API 面，还是直接 `use oxc_ast`（铁律是否只在文档里）。
- [ ] 升级 parser/oxc 版本时，规则代码要改多少；是否有版本锁定与回归门禁。

### C3 双引擎与协议

- [ ] sidecar 协议是否版本化、单向、可测试；诊断字段是否完备。
- [ ] 引擎失败是否 fail-open；降级是否可观测（报告/日志/退出码）。
- [ ] 双引擎诊断是否有归属、去重、supersedes/接管关系；冷/热路径是否一致。

### C4 确定性与输出

- [ ] 诊断排序是否稳定；指纹是否覆盖 rule/file/span/message；文案变更是否视为 breaking。
- [ ] 同一 commit 多次运行、不同并发度、冷/热缓存，诊断集合是否一致。
- [ ] 输出契约版本是否递增；golden/SARIF 快照是否锁定。

### C5 缓存与增量

- [ ] 缓存键包含哪些成分：文件内容、规则配置、插件产物、引擎版本、tsconfig、依赖闭包。
- [ ] 跨文件/图规则是否按文件缓存；图 pass 是否只看到缓存未命中文件。
- [ ] 改动一个文件后，反向依赖文件的诊断是否失效；冷扫与热扫是否等价。
- [ ] `--fix` 是否禁用缓存；缓存损坏/IO 异常是否 fail-open。

### C6 并发与内存

- [ ] 并行粒度（文件/包/规则）；结果是否保序。
- [ ] 每文件 arena 是否及时释放；峰值内存 ≈ 线程数 × 最大文件还是全量。
- [ ] 单文件大小/超时/内存上限；超大文件是否降级而非拖垮全局。

### C7 fail-open 与可观测性

- [ ] 引擎缺失/崩溃/协议损坏分别是什么行为；是否阻塞流水线。
- [ ] `degraded` 是否进入报告/退出码，而非只写日志。
- [ ] CI 能否选择 fail-closed；平台能否区分“代码坏”与“工具坏”。

### C8 部署与分发

- [ ] 产物形态（单文件二进制/包/容器）；运行时依赖（Bun/oxlint/tsgolint/引擎二进制）。
- [ ] 多平台产物、版本标识、校验和、离线/内网供给。
- [ ] 业务侧是否需要额外安装 oxlint；缺失时是否有明确提示。

## D. SAST 专业性

### D1 检测深度

- [ ] 当前处于 L0-L4 哪一层：AST / scope / CFG / 过程内 taint / 过程间+跨文件。
- [ ] 是否有函数摘要、参数/返回值传播、调用图、跨包图。
- [ ] type-aware 是默认、opt-in 还是缺失；tsgolint/tsc 的降级路径。

### D2 规则面

- [ ] 自有规则数量与构成（语法/局部/taint/图/治理）；与 oxlint 内置的分工。
- [ ] 是否有覆盖矩阵：现有引擎规则清单 100% 有结论（实现/映射/缺口/豁免）。
- [ ] 规则是否按 CWE/OWASP 家族组织；有没有“数量多但高危家族空白”。
- [ ] 规则文档是否含 falsePositives、rationale、bad/good examples、confidence 依据。

### D3 taint 正确性

- [ ] source/sink/sanitizer 是注册表驱动还是硬编码名字；表之间是否有交叠校验。
- [ ] 是否路径敏感/流敏感；worklist 是否单调收敛；循环回边是否处理。
- [ ] sanitizer 是否真正 kill/strong update，还是只对表达式结果生效。
- [ ] 参数位建模（sink_arg_index）、options 对象、解构、导入别名、回调参数是否处理。
- [ ] 是否有已知误报/漏报边界文档（跨过程、动态分发、Proxy、装饰器）。

### D4 框架语义

- [ ] Vue：script/template 是否都分析；引用索引、宏、组件归一、模板 sink。
- [ ] Angular/React：是否有 template/JSX AST、hooks/DI/RxJS、DomSanitizer。
- [ ] 后端：Express/Koa/Hono/Nest 的入口、req source、res sink、中间件、装饰器。
- [ ] ORM/DB：Prisma/TypeORM/Sequelize/Mongoose 的查询 sink 与参数化 sanitizer。
- [ ] 框架差异是否在 profile 层，而不是散落在规则/引擎源码里。

### D5 精度与召回

- [ ] 有没有逐行标注的漏洞样本与干净样本；TP/FP/FN 是否按规则统计。
- [ ] 召回分母是否可解释；是否把无关规则命中算作召回。
- [ ] 误报是否按 correctness/security 分口径；是否有独立复核。
- [ ] 差分测试：与 Semgrep/ESLint-plugin-security/SonarJS/CodeQL 的同语料对比。
- [ ] 语料库回归：双报率、指纹 diff、规则行为变更评审。

### D6 标准与消费面

- [ ] CWE/OWASP 标签是否输出；confidence 是否输出；severity 与 confidence 是否解耦。
- [ ] 证据链（pathEvents）是否结构化、可映射 SARIF codeFlows/relatedLocations。
- [ ] 指纹是否跨 commit 稳定；抑制/基线是否按指纹对齐。
- [ ] SARIF 是否 schema 合规；GitHub/GitLab 消费面是否实测。

## E. 工程质量

- [ ] 测试分层：规则 fixture、闭环、golden、注册表一致性、跨平台、Rust 单测。
- [ ] 默认 `test` 命令是否覆盖全部测试（bun + cargo）；是否有 CI 自动执行。
- [ ] lint/format/bench/corpus 门禁是脚本还是流水线；基线是否过期。
- [ ] 版本锁定（oxlint/oxc/Bun）；依赖审计；生成产物是否入库且有重建校验。
- [ ] 文档与实现是否漂移；README 数字是否由脚本生成。
- [ ] 跨平台路径/行尾/可执行文件解析是否有测试。

## F. 框架扩展性

- [ ] 加一个新框架要改哪些文件：pipeline、config-bridge、engine-bridge、Rust 表、规则聚合产物。
- [ ] 是否存在 `FrameworkProfile`：入口、source/sink/sanitizer、模板、宏、规则包、置信度策略。
- [ ] 是否存在通用 `Processor`/`SemanticAdapter`：按文件类型分发模板解析，CLI 不硬编码 `.vue`。
- [ ] 是否存在 `RulePack` 加载器：多 jsPlugins、版本声明、独立构建/启用。
- [ ] 语言面：TSX/JSX 是否有 fixture 与 JSX sink 规则；装饰器/Nest legacy 是否验证。
- [ ] 数据型 profile（后端/ORM）能否 JSON 加载不重编译；代码型 profile（模板/AST）接口是否稳定。
- [ ] 框架语料与误报门禁是否独立；没有真实项目验证的 profile 是否默认关闭。

## G. 工具自身的健壮性

- [ ] 解析不可信代码：单文件超时、大小上限、内存上限、崩溃隔离。
- [ ] fuzz：parser/processor 是否有 fuzz target；崩溃是否 P0。
- [ ] 插件运行时：JS plugin 崩溃是否被归一为 internal 诊断；是否可隔离。
- [ ] fail-open 是否会让安全扫描静默漏报；平台是否能感知 degraded。
- [ ] 供应链：依赖锁定、校验和、发布签名、内网镜像。

## H. 结论与评分

- [ ] 每个维度至少两条证据；每个 High 及以上问题有修复与验收标准。
- [ ] 同时给“MVP 视角”和“企业级替代视角”两个总分，并解释差异。
- [ ] 三个决定性差距按影响排序，不按文档章节排序。
- [ ] 路线图分 P0/P1/P2，并明确“不该做什么”。
- [ ] 对 Top 3 结论给“什么证据会改变判断”。
- [ ] 声明评审局限：没跑的命令、缺失的语料、无法验证的声明。
