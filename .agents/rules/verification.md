---
name: verification
description: 完工前自检规则，要求实际运行测试、lint 与针对性验证并附执行证据
alwaysApply: true
---

# 完工前自检规则（Verification）

在声明任务「完成」之前，必须完成以下自检。**不要仅凭「代码看起来对」就宣布完成。**

## 一、通用命令（按改动面选择）

```bash
bun run test                 # 规则构建 + bun 测试（不要用裸 bun test）
cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml
bun run lint                 # packages + plugins，0 警告基线
bun run format:check         # oxfmt
bun run bench                # 性能相关改动；hyperfine 不可用则说明
bun run corpus:check         # 规则/引擎行为改动；语料未同步则说明
bun run corpus:recall        # 规则召回相关改动
bun run check:change-id -- <commit-msg-file>  # 未启用 commit-msg hook 时手动校验
```

## 二、按改动类型的针对性验证

- **JS 规则**：fixtures（≥3 bad / ≥2 good / safe case）+ RuleTester + 注册表一致性测试；`bun run test`。
- **Rust 引擎/规则**：`cargo test --release`；taint 改动补表交叠校验、证据链、solve 收敛用例。
- **诊断/报告契约**：golden `report-v2.json`、SARIF 快照、指纹稳定性；契约字段缺失即失败。
- **缓存/增量**：冷/热扫诊断集合一致；重复内容、断环、tsconfig、文件删除等场景。
- **CLI/配置**：exit 0/1/2 契约、`--output` 通道、外部路径与 `--root`、ignore/产物过滤。
- **纯文档/模板**：链接存在、无未替换的占位符、AGENTS 索引无死链；不要求跑代码测试。

## 三、交付前确认

1. 相关命令**实际执行过**，不是「预期会通过」；
2. 改动范围可追溯到用户诉求，无顺手重构/无关变更；
3. 只清理本次产生的孤儿 import/变量，不动既有死代码；
4. 生成产物（`plugins/lintsight-rules/index.js`、golden）如被重建，`git diff` 必须可解释；不得静默提交产物漂移；
5. 规则 message/messageId 变更必须显式标注 breaking 并走评审。

## 四、测试豁免

满足以下之一可不写单测，但必须在交付说明中列出未测文件、原因、人工验证步骤：

- 纯文档、注释、模板、格式调整；
- 纯 UI/排版/文案类改动，单测价值低；
- 强依赖外部运行时或 mock 成本远高于收益。

豁免不免除 lint/format；代码改动仍需通过现有测试套件。

## 五、验证留痕

交付说明/PR 描述必须附命令输出摘要，例如：

- `bun run test`：167 pass / 0 fail
- `cargo test --release`：52 passed
- `bun run lint`：0 warnings / 0 errors
- `bun run format:check`：clean
- `bun run corpus:check`：unchanged / 已逐条归因

无法附输出时，说明最后执行时间与结果状态。
