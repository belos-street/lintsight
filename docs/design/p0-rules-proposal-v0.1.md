# P0 规则清单提案 v0.1（T1.0b 门禁，评审修订①）

> 日期：2026-09-16 · 状态：**评审修订①已吸收（2026-09-16 用户评审，6 点全部实证成立）** → 定稿，S3/S4 按本清单开工
> 去重基准：oxlint **1.83.0** `--rules` 全量快照（884 条内置，2026-09-16 实测）；差异化 = 内置无同名/同语义规则
> 上游依据：requirements-v0.2 §4.1（P0 批次）、§3.6（双报消解）、附录 A；[rule-authoring skill](../../.agents/skills/rule-authoring)（confidence 评级依据、用例门槛）
> 配套：[rule-sdk-rfc-v0.1.md](rule-sdk-rfc-v0.1.md)（T1.0a，两门禁配套评审）
> 数量口径（修订①后）：差异化 25 条（正确性 10 + 1 stretch，安全语法级 14）+ 已上线 `no-empty-catch` = **26 条**
>
> **修订记录 v0.1①（评审吸收）**：
> ① 🔴 正确性 #2 `no-then-without-catch` 与内置 `promise/catch-or-return` 同语义（promise 插件 16 条已 port）→ **移出自建清单，入 1b 映射**；
> ② 🔴 安全 #10 `no-innerhtml-assignment` 双 severity 违反 RFC → **改为单 severity**：仅右值非纯字面量时报 error，纯字面量不报；
> ③ 🟡 正确性 #5 `no-closure-loop-var` 与内置 `eslint/no-loop-func` 同域 → **写明分工**：内置误报面宽（函数表达式含无捕获场景）不启用，自有版收窄「var 声明被闭包捕获」语法可证；
> ④ 🟡 正确性 #6 `no-array-map-side-effect` 被 1b `array-callback-return`（error）覆盖半边 → **收窄**为「表达式语句丢弃 map 结果且回调有 return」；
> ⑤ 🟡 正确性 #3 补与 `no-unused-vars`（caughtErrors 选项）的边界说明；安全 #8 `no-math-random-secret` **限定同语句赋值维持 none 层**；安全 #14 注明与 `unicorn/no-document-cookie` 分工（1b 同步启用）；
> ⑥ 🟡 s2 `no-sync-io-in-async` 转正入主清单。

---

## 一、内置启用映射清单初版（builtin-mapping v1）

**原则**：与内置重复的不自建；映射清单只增不改语义。categories v0 已落地 `correctness=error`。

### 1a. categories 补充（拍板项）

| 项 | 建议 | 说明 |
| --- | --- | --- |
| suspicious | **warn**（试点） | FR-204 试点项目灰度；M1 默认集是否纳入待拍板 |
| perf | warn | 含 `no-await-in-loop` 等，试点口径同上 |

### 1b. 内置规则显式启用（当前 default 未开，语义属正确性/安全；default 状态按 1.83.0 `--rules` 快照）

| 内置规则 | 语义 | 建议级别 | 备注 |
| --- | --- | --- | --- |
| eslint/no-throw-literal | throw 字面量丢调用栈 | error | |
| eslint/no-new-func | new Function 动态执行 | error | 覆盖后自有清单**不再**做 new Function（去重） |
| eslint/no-unsafe-finally | finally 中 return/throw 吞异常 | error | 正确性候选 6 被此覆盖 → 从自有清单移除 |
| eslint/array-callback-return | 数组回调漏 return | error | |
| eslint/no-promise-executor-return | executor 返回值被忽略 | error | |
| eslint/no-fallthrough | switch 贯穿 | error | §4.1 点名由映射清单覆盖 |
| eslint/no-await-in-loop | 循环内串行 await | warn | perf 类 |
| eslint/no-proto | `__proto__` 标识符访问 | error | 与自有 no-prototype-pollution-syntax 分工见下 |
| eslint/no-prototype-builtins | 直接调用 hasOwnProperty | warn | |
| react/no-danger | dangerouslySetInnerHTML | error | CWE-79；react 插件已 port，不自建 |
| promise/catch-or-return | promise 链必须 catch/return 终结（含 allowThen 选项族） | error | **v0.1① 自建清单 #2 移入**；promise 插件 16 条已 port |
| unicorn/no-document-cookie | document.cookie 赋值 | warn | 与自有 no-insecure-cookie 分工：内置管 document.cookie，自有管 Set-Cookie 字符串与框架 cookie 选项 |
| typescript/no-misused-promises | promise 传给非 promise 感知 API | warn | ⚠️ 生效性待 spike ③（可能需 --type-aware → M2 生效） |

---

## 二、P0 正确性（S3，差异化 10 条 + 1 stretch）

| # | ruleId | 检测逻辑（一句话） | 检测层 | severity | confidence | 已知误报 / 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | lintsight/no-floating-promise | 表达式语句中的 Promise 产生值未 await / void / return（内置启发：async 调用、`.then` 返回、已知 Promise API 名单） | local | error | medium | fire-and-forget 需显式 `void`；启发式有漏报。**M2 接管对** → typescript/no-floating-promises（实测默认不生效，需 type-aware） |
| 2 | ~~lintsight/no-then-without-catch~~ | ~~移出~~ | — | — | — | **v0.1① 移出自建**：与 promise/catch-or-return 同语义，入 1b 映射 |
| 3 | lintsight/no-swallowed-promise-error | `catch (e)` 体内未引用 e 且无 rethrow/包装抛出 | none | error | medium | `console.error` 视为处理；空 catch 由 no-empty-catch 覆盖；与 `no-unused-vars`(caughtErrors) 分工：内置只管「未使用变量」，本条语义是「吞错」（未引用**且**无任何处理动作） |
| 4 | lintsight/no-async-array-method | forEach/map/filter/reduce 传入 async 回调（返回 Promise 被静默忽略） | none | error | high | 语法可证；有意并发者改写 Promise.all 后消除 |
| 5 | lintsight/no-closure-loop-var | 循环体内 `var` 声明且被函数表达式捕获 | none | error | high | 与内置 no-loop-func 分工：内置覆盖所有函数表达式捕获（误报面宽）不启用；自有版仅 var+捕获，语法可证 |
| 6 | lintsight/no-array-map-side-effect | 表达式语句丢弃 `map` 结果**且回调有 return**（回调漏 return 由 1b array-callback-return 管） | none | warn | medium | map 语义误用（应 forEach） |
| 7 | lintsight/no-json-structured-clone | `JSON.parse(JSON.stringify(x))` 模式 | none | warn | high | 纯可序列化数据场景可配 `allow: true`；丢 Date/Map/Set/undefined 是价值所在 |
| 8 | lintsight/no-ignored-reduce-result | `reduce` 返回值被丢弃（非表达式语句链尾） | none | error | high | |
| 9 | lintsight/no-empty-promise-catch | `.catch(() => {})` / `.catch(() => undefined)` 静默吞错 | none | error | high | 与 no-empty-catch 分工：内置 no-empty 不查回调 |
| 10 | lintsight/no-async-constructor-call | constructor 内调用 `this.asyncXxx()` 且未 await/void | none | warn | medium | 异步初始化丢失是常见坑；白名单选项留 `allowInit` |
| 11 | lintsight/no-sync-io-in-async | async 函数内调用 readFileSync 等 *Sync API（原 s2 转正，评审⑥） | none | warn | high | 事件循环阻塞；node 语义 |
| s1 | lintsight/no-mutation-during-iteration | for-of/forEach 遍历期间对同一数组 push/splice | none | error | medium | stretch：跨函数引用追踪做不全，先做直接引用面 |

## 三、P0 安全语法级（S4，差异化 14 条，OWASP 2021 / CWE 对齐）

| # | ruleId | 检测逻辑 | 检测层 | severity | confidence | CWE | OWASP | 已知误报 / 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | lintsight/no-hardcoded-credentials | 键名/变量名含 password/secret/token/api_key/private_key + 高熵字符串字面量 | none（词法，正则豁免铁律外） | error | medium | 798 | A07/A02 | 测试文件默认豁免；`test/**` 与 `*.spec.*` 内置 ignore 选项 |
| 2 | lintsight/no-unsafe-regex | 正则字面量/RegExp 的 ReDoS 静态特征（嵌套量词、重叠 alternation） | none | warn | high | 1333 | A05 | 完整 ReDoS 不可判定，特征法保守报 |
| 3 | lintsight/no-prototype-pollution-syntax | 字面量/计算键 `'__proto__'`、`constructor.prototype`；Object.assign/深合并到字面量目标 | none | error | high（字面量键） | 1321 | A08 | 与内置 no-proto 分工：内置管标识符访问，本条管字面量键与合并面；**◆ M2 taint 接管**（附录 C 竖切候选） |
| 4 | lintsight/no-child-process-nonliteral | child_process.exec/execSync 第二参命令非字面量 | none | error | medium | 78 | A03 | 命令白名单场景可配 allow |
| 5 | lintsight/no-non-literal-fs-filename | fs.* 路径参数非字面量（变量名含 path/file/dir 启发收紧） | none | warn | low | 22 | A01 | **low 禁入门禁**（detect-non-literal-fs 的历史教训）；报告供复核 |
| 6 | lintsight/no-non-literal-require | require()/import() 参数非字面量 | none | error | high | 94 | A03 | 动态装配场景可配 allow |
| 7 | lintsight/no-weak-hash | crypto.createHash('md5'/'sha1') 字面量参数 | none | warn | high | 327 | A02 | 非 TLS 场景（缓存键）可配 allow；eslint-plugin-security detect-* 同语义，oxlint 未 port |
| 8 | lintsight/no-math-random-secret | Math.random 结果**同语句**赋给 token/secret/key/otp/salt 命名的标识符（`const token = Math.random()`） | none | error | medium | 338 | A02 | 限定同语句维持 none 层；跨语句追踪属 local（M2）；应为 crypto.randomUUID/getRandomValues |
| 9 | lintsight/no-sensitive-storage | localStorage/sessionStorage.setItem 键名含 token/secret/jwt/credential/password/refresh | none | error | medium | 312 | A02 | 非 Auth 场景键名撞车时用行内 ignore |
| 10 | lintsight/no-innerhtml-assignment | innerHTML/outerHTML/document.write 右值**非纯字面量**时报 error；纯字面量为静态内容不报（单 severity，降噪走 allow/ignore） | none | error | medium | 79 | A03 | **◆ M2 taint 接管** |
| 11 | lintsight/no-sql-concat | 模板字符串以 SELECT/INSERT/UPDATE/DELETE 开头且含 `${}` 插值；字符串 `+` 拼接进查询 API | none | error | medium | 89 | A03 | 参数占位符（?/$1）写法不报 |
| 12 | lintsight/no-cors-wildcard | `Access-Control-Allow-Origin: '*'` 字面量；cors({ origin: true }) | none | warn | high | 942 | A05 | 纯公开 API 可配 allow |
| 13 | lintsight/no-vm-dynamic-code | vm.runInContext/runInNewContext/runInThisContext 参数非字面量 | none | error | medium | 94 | A03 | new Function 已由映射清单 no-new-func 覆盖 |
| 14 | lintsight/no-insecure-cookie | Set-Cookie 字符串缺 HttpOnly/Secure；res.cookie/cookies.set 选项缺 httpOnly/secure（express 系启发） | none | warn | medium | 614/1004 | A05 | 与 1b unicorn/no-document-cookie 分工：内置管 document.cookie 赋值；框架面逐步扩展 |

## 四、M2 taint ◆ 预接管（M1 不做，登记备查）

- `lintsight/no-prototype-polluting-merge`（附录 C 竖切验收规则，M1 语法近似版即上表 #3）
- `lintsight/no-ssrf-url`（fetch/axios URL sink）、`lintsight/no-open-redirect`（location sink）、`lintsight/no-path-traversal`（fs path sink）——M2 taint 竖切候选，M1 不出语法近似版（误报不可控）

## 五、规则用例门槛（评审后成为 S3/S4 验收契约）

每条 ≥3 bad / ≥2 good / safe case / 边界矩阵（TS 断言共存、注释与字符串干扰、跨行）；confidence 评级依据见 rule-authoring skill；语料库门禁（zod/dayjs）随 S7 建立后回补 diff。

## 六、评审结论回填

- [ ] 每行拍板结果记录于本文档（通过/砍掉/降级 + 理由）
- [ ] 定稿后：安全批 14 条写入 rules-core 任务分解；映射清单 1a/1b 写入 builtin-mapping.ts
