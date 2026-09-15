# lintsight · 最小化闭环验证 Todo（竖切验证）

> 目标：在正式动工前，用最小成本验证 M1 主链路技术可行性。
> 依据：[requirements-v0.2.md](requirements/requirements-v0.2.md) §11.3 首个竖切 + §8.3 风险清单
> 状态：**✅ 已完成（2026-09-15）** · 报告：[spikes/vertical-slice-m1.md](spikes/vertical-slice-m1.md)
> 总结论：M1 技术路线可行；1 项降级（指纹 messageId 锚点缺失）、2 项待补测（bun --compile、tsgolint）

## 总验收标准（已达成）

`lintsight/no-empty-catch` 一条规则走通完整链路：

```
CLI 输入 → Bun 脚手架 → oxlint（JS Plugin 自有规则 + .vue 虚拟块）
        → 带指纹的 JSON 诊断 → exit code 语义正确
```

且指纹重跑稳定（实测：报告两次运行逐字节一致）。

## 依赖链与执行记录

SV1 → SV2 → SV3 → SV4 / SV5 → SV6 → SV7 · bun test 13/13 全绿

## 任务清单

### SV1. Bun monorepo 最小脚手架 — 验证 DR-7 ✅

- [x] bun init + workspaces（`packages/*`）+ bun.lock 提交，全程禁 Node（oxlint 锁 1.83.0）
- 验收：`bun install && bun run cli` 打印版本号 → 通过
- 备注：`bun build --compile` 单文件分发未测，T0.13 跟进

### SV2. oxlint 进程编排跑通 — 验证 spike ④ ✅

- [x] Bun spawn oxlint 扫描 fixture TS 文件，解析 JSON 诊断
- 验收：ruleId / span 取到；**实测无 messageId 字段** → 指纹降级 message 文本（breaking 评审纪律适用）

### SV3. 自有 JS Plugin 规则跑通 — 验证 DR-1 ✅

- [x] `lintsight/no-empty-catch` 以 oxlint JS Plugins（alpha）加载（写规则前已读 rule-authoring skill）
- 验收：bad fixture 触发诊断，Rule ID `lintsight/no-empty-catch` 命名合规，与内置规则共存

### SV4. bun test 承载 RuleTester — 验证修订④ ✅

- [x] no-empty-catch 共 5 组用例（3 bad / 2 good 含边界：可选 binding / 嵌套 / TS 断言共存 / 注释字符串干扰）
- 验收：bun test 全绿 → 通过

### SV5. Vue SFC 最小回映射 — 验证 spike ② 核心 ✅

- [x] `.vue` 提取 `<script>` 虚拟块喂 oxlint，1:1 行号对齐，诊断回映射原 .vue（不做 template）
- 验收：.vue 内空 catch 报告位置正确（line 13 / col 5）→ 通过
- 备注：同行开标签不支持；正式版须就地临时文件保 import 上下文（§11.2）

### SV6. 指纹 + exit code + JSON 报告闭环 — 验证 §5.4 / §6.3 ✅

- [x] fingerprint = hash(ruleId + file + span + ~~messageId~~ **message 文本**，spike ④ 降级)
- [x] exit 0（无 error）/ 1（有 error）/ 2（运行错误）——oxlint 自身 exit=1 有歧义（含「输入不存在」），运行错误判定由封装层自建
- 验收：目录扫描输出统一 JSON，重跑指纹一致 → 通过

### SV7. 竖切验证报告落档 docs/spikes/ ✅

- [x] 逐项技术风险给出 通过 / 失败 / 降级 结论
- 验收：[spikes/vertical-slice-m1.md](spikes/vertical-slice-m1.md) 已可评审

## 明确不在本次闭环（后续）

- spike ① oxc crate 直连（M2 路线）
- spike ③ tsgolint / `--type-aware`（M2 类型感知）
- `bun build --compile` 单文件分发（DR-7 收尾，T0.13）
- template 深度分析、safe fix 逆映射、SARIF、缓存、双报消解注册表
