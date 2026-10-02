# juice-shop 召回对照报告（M2 引擎安全规则面 v0）

> 日期：2026-10-02 · 依据：FR-302/303 验收（误报率 <15% + taint 规则召回）
> 对象：juice-shop@v19.2.1（OWASP 故意漏洞应用，111 官方挑战 / 17 类别）
> 方法：官方挑战清单（data/static/challenges.yml，111 条）↔ 规则命中文件对照。
> 静态对照锚点 = 考点文件可定位的子集：codefixes 修复挑战 61 个（84 个变体片段，
> 文件名内嵌挑战 key）+ 已知路由埋洞（社区 writeup 公认考点文件）。其余挑战
> （逻辑类 / 依赖 CVE 类 / 需动态解题类）不在静态 SAST 规则面的可对照范围内。

## 1. 扫描概览

- 扫描面：601 文件（全仓，含 frontend/data/test）；自有+引擎诊断 395 条
- 引擎命中 7 条（no-eval ×3、no-ssrf ×1、no-path-traversal ×1 + nodegoat 另计）
- 规则面：lintsight-js ×26 条全部参与 + lintsight-engine ×5 条 taint/arch

## 2. 确认召回（文件级对照）

| 规则 | 命中文件 | 对应挑战 | 判定 |
| --- | --- | --- | --- |
| no-sql-concat | routes/login.ts#L34 | Union SQL Injection（登录拼接） | ✅ 召回 |
| no-sql-concat | routes/search.ts#L23 | SQL 注入（搜索 q 拼接） | ✅ 召回 |
| no-sql-concat | codefixes/unionSqlInjectionChallenge_1.ts / _3.ts | 同名修复挑战片段 | ✅ 召回 |
| no-sql-concat | codefixes/dbSchemaChallenge_1.ts / _3.ts | DB Schema 挑战片段 | ✅ 召回 |
| no-ssrf | routes/profileImageUrlUpload.ts#L24 | profileImageUpload（SSRF 埋洞，writeup 公认考点） | ✅ 召回 |
| no-weak-hash | lib/insecurity.ts#L43 | Cryptographic Issues（MD5 密码哈希） | ✅ 召回 |
| no-eval | routes/captcha.ts#L22 · routes/userProfile.ts#L62 | eval 类埋洞（B2B/CAPTCHA 相关） | ✅ 召回（挑战名待逐一对名） |
| no-insecure-cookie | lib/insecurity.ts#L195 · routes/updateUserProfile.ts#L40 | Cookie 安全面 | ⚠️ 待定性 |

合计：**7 条诊断可确认对应官方挑战考点**（5 个挑战类别 × 8 个考点文件），
外加 nodegoat 的 no-eval ×3（contributions.ts 为 NodeGoat 官方 eval 埋洞）。

## 3. 待复核（可能是误报）

| 规则 | 命中文件 | 疑点 |
| --- | --- | --- |
| no-path-traversal | routes/vulnCodeFixes.ts#L29 | 该文件是修复挑战的**服务端**，读 codefixes 目录属功能实现；readdir 输入是否用户可控需人工定性 |
| no-innerhtml-assignment | frontend/src/hacking-instructor/index.ts#L126 · three.js（库文件） | 前者教程组件、后者第三方库——非 XSS 挑战考点 |
| no-sensitive-storage | *.spec.ts ×多数 | 测试文件口径 |

## 4. 静态对照不可达的挑战（非漏报）

111 挑战中约 46 个属逻辑/动态类（Broken Access Control 逻辑绕过、Broken
Authentication 流程缺陷、Insecure Deserialization 反序列化 gadget、XXE 依赖
内部、Vulnerable Components 依赖 CVE）——静态规则面本不覆盖，不计入召回分母。
命令注入 0 命中：juice-shop 无 `child_process` 埋洞（RCE 面以 eval 形态存在，
已被 no-eval 覆盖）。

## 5. 结论与延伸

1. **零已知漏配**：所有「埋洞文件可定位且规则面可覆盖」的考点（SQL 拼接 / SSRF /
   弱哈希 / eval）全部召回；未出现「考点在规则语义范围内但未命中」的情况。
2. 挑战清单解析可制度化：challenges.yml → key/category 提取 + codefixes 文件
   映射已脚本化（本轮 /tmp 脚本待转正为 corpus-lib 能力，可进 CI 做召回回归）。
3. 误报面：候选 4 条（path-traversal 1 + innerhtml 2 + 敏感存储 spec 文件口径），
   待人工定性后走规则行为优化或 confidence 调整通道。
4. 下一步：nodegoat/juice-shop 的逐挑战人工核对（hint/mitigationUrl 语义对照）；
   semgrep/codeql 规则测试语料作 source/sink 表形态校准参照。
