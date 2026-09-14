# 测试与门禁：RuleTester、语料库与误报分析

> 验收口径以 docs/requirements/requirements-v0.1.md 的 FR-202/302/702/703 为准；标注流程以「标注规范 v0」为准（M0 交付物）。

## RuleTester 用例标准（FR-202）

每条规则最低配：**≥3 组 invalid + ≥2 组 valid**，且必须覆盖边界矩阵：

| 维度 | 要求 |
| --- | --- |
| 触发变体 | 同一问题至少 2 种语法写法（如点号/方括号、字面量/变量） |
| **safe case** | 清洗后的输入、安全替代写法——**valid 用例里必须有**，防误报回归 |
| 边界 | 跨行、嵌套作用域、TS 类型语法共存（as/satisfies/泛型）、注释与字符串中的干扰 |
| Vue | 涉及 SFC 的规则补 `.vue` 虚拟块用例（经 VueProcessor 路径，位置回映射断言） |
| fix | 可 fix 规则断言 fix 输出文本与区间，并断言 fix 后不再触发（收敛） |

用例即契约：改实现不改用例 = 没改对；改用例放宽断言必须在 PR 里说明原因。

## 语料库门禁（FR-702，每次发版必跑）

```
corpus/
├─ zod/        # 小：单包 TS 库
├─ dayjs/      # 中：带构建链
├─ vue/        # 大：框架本体（含 SFC）
└─ company-monorepo/   # 公司仓（M0 确认授权与脱敏后才入库）
```

流程：

1. 发版/规则变更前全量重扫 3+1 语料库；
2. 诊断 diff 逐条评审：新增 = 真问题（补 invalid 用例）或误报（回炉）；消失 = 修复了或规则退化了（查明原因）；
3. **PR 必附**：语料库 diff 摘要 + 误报分析（每条误报：根因、边界、是否可修）；
4. 性能对照：hyperfine 基准，回退 >15% 拦截（FR-703）。

## 误报率验收口径

| 规则类 | 指标 | 口径 |
| --- | --- | --- |
| correctness（差异化） | 人工抽检误报率 <5% | 标注规范 v0：抽样方法 + 双人交叉标注 + 仲裁 |
| security（语法级） | <10% | 同上 |
| taint 硬门槛 3 条（M2） | <15% | **平台复核口径**（依赖 cleancode 复核 SLA 就位，过渡期用双人标注） |

误报超标 ≠ 自动降级——触发**门禁拦截 + 人工决策**（修复 / 降级 / 禁用），不静默改 severity（技术设计文档 §4.3 修订②）。

## confidence 评级依据

| confidence | 判据（PR 里必须写明属于哪种） |
| --- | --- |
| high | 检测条件可证伪且无已知误报场景；safe case 全覆盖；纯语法/常量级判定 |
| medium | 有启发式成分（命名启发、熵检测、局部推断）；存在文档化的误报场景 |
| low | 依赖假设（动态分发、装饰器行为）或仅供人工参考——**禁止进 CI 门禁** |

虚标 confidence = 上线即拦错 = 团队绕过工具（技术设计文档 §10 反模式 5）。

## 反模式对照（技术设计文档 §10 全文适用）

- 正则匹配代码写规则（除纯词法类）；
- severity/confidence 混用；
- 把动态特性当确定性（Proxy/装饰器/HOC 直接断言 → 宁漏报）;
- 诊断无稳定指纹（M1 口径 = ruleId+文件+span+messageId 哈希；messageId 增删/改名视为 breaking）；
- 规则间私下共享缓存（跨文件走 createProgramRule）。

## 规则合入 checklist

- [ ] FR/附录 A 编号关联
- [ ] meta 全字段（含 falsePositives、cwe/owasp tags）
- [ ] RuleTester：≥3 bad / ≥2 good / safe case / fix 断言
- [ ] 语料库 diff + 误报分析随 PR
- [ ] 性能：timings 无异常热点
- [ ] 规则注册表登记（ruleId/owner/检测层/active）
- [ ] 文档：规则 docs 站条目（description/rationale/examples/falsePositives）
