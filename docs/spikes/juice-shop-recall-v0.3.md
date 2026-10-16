# juice-shop 逐挑战召回对照报告 v0.3（T3.3 规则面扩充后）

> 日期：2026-10-16 · 依据：T3.3 规则面扩充验收（拍板「仅补规则提召回」，验收线 recalled ≥ 15）
> 前序：[juice-shop-recall-v0.1.md](./juice-shop-recall-v0.1.md)（文件级人工对照）→
> [juice-shop-recall-v0.2.md](./juice-shop-recall-v0.2.md)（制度化 + 逐挑战对照表）→
> 本版：pending-human 收敛轮的结果——3 条新规则 + taint 能力补齐 + EXTRA_ANCHORS 补真实文件锚点，
> recalled 10 → **17**，静态可对照面召回率 38.5% → **65.4%**（17/26）。

## 0. v0.2 → v0.3 变更摘要

| 项 | v0.2 | v0.3 | 变化 |
| --- | --- | --- | --- |
| recalled | 10 | **17** | +7（redirect×2 / localXss / xssBonus / restfulXss / directoryListing / accessLog） |
| pending-human | 16 | **9** | −7（6 条转召回 + 1 条同文件合并），余 9 条全部定性「静态不可达」 |
| no-static-anchor | 85 | 85 | 不变 |
| 静态可对照面召回率 | 10/26 = 38.5% | **17/26 = 65.4%** | 验收线 recalled ≥ 15 ✓ |
| 规则面 | 33 | 36 | +lintsight/no-unsafe-trust-bypass、+lintsight/no-serve-index、+lintsight-engine/no-open-redirect |
| 扫描面 / 全量诊断 | 601 / 573 | 599 / 615 | 冷扫口径（fixture 变更不影响语料库面） |

本轮新增：

1. **`lintsight-engine/no-open-redirect`**（taint，CWE-601）：`res/response/ctx/c.redirect` + `location` sink；
   携 `anchored_concat_clean` 表语义（字面量前缀锚定拼接 `'/user/' + id` 不报——误报门禁 25%→0% 的反哺产物）。
2. **`lintsight/no-unsafe-trust-bypass`**（CWE-79）：`bypassSecurityTrust{Html,Script,Style,Url,ResourceUrl}`
   非纯字面量实参 = 绕过 Angular XSS 防护。命中 localXss/xssBonus/restfulXss 的真实洞位
   `frontend/src/app/search-result/search-result.component.ts`（官方 `vuln-code-snippet vuln-line` L170/L132）。
3. **`lintsight/no-serve-index`**（CWE-548）：serveIndex 目录浏览 → directoryListing/accessLog 两挑战。
4. **taint 能力补齐**：TS as/satisfies/non-null/instantiation 表达式剥离穿透、解构请求源回退
   （`({ query }: Request)` 链根 ∈ REQUEST_SCOPE_NAMES 即 source）。

锚点修正：**codefixes 方法体片段结构残缺不可解析**（oxc parse error 误归类的根因），对 XSS 类挑战
先天无法命中——本轮将 localXss/xssBonus/restfulXss 的锚点补到真实文件（官方 writeup `vuln-line` 标记，
非自我实现）；redirect×2 补 `routes/redirect.ts`；directoryListing/accessLog 补 codefixes 全文件锚点。

## 1. 判定口径

同 v0.2：✅ recalled（锚点内有自有规则诊断）/ ⚠️ pending-human（有锚点零命中）/
➖ no-static-anchor（无静态可定位锚点，不计入分母）。

## 2. 汇总（111 官方挑战）

- **recalled 17**（静态锚点可对照面召回率 = 17/26 = 65.4%）
- pending-human 9（§3，**全部定性「静态不可达」**，退出召回目标）
- no-static-anchor 85（§4，不计入分母）
- 扫描面 599 文件 / 全量诊断 615 条（冷扫）

### 召回明细（17）

| 挑战 | 规则 |
| --- | --- |
| loginAdminChallenge / loginBenderChallenge / loginJimChallenge / unionSqlInjectionChallenge | lintsight/no-sql-concat（routes/login.ts 同洞） |
| dbSchemaChallenge | lintsight/no-sql-concat（routes/search.ts + codefixes 片段） |
| ssrfChallenge | lintsight-engine/no-ssrf（routes/profileImageUrlUpload.ts） |
| weirdCryptoChallenge | lintsight/no-weak-hash + no-hardcoded-credentials + no-insecure-cookie（lib/insecurity.ts） |
| captchaBypassChallenge | lintsight-engine/no-eval（routes/captcha.ts） |
| forgedReviewChallenge / noSqlReviewsChallenge | lintsight/no-floating-promise（codefixes 片段） |
| **redirectChallenge / redirectCryptoCurrencyChallenge** | **lintsight-engine/no-open-redirect（routes/redirect.ts）** |
| **localXssChallenge / xssBonusChallenge / restfulXssChallenge** | **lintsight/no-unsafe-trust-bypass（search-result.component.ts L170/L132）** |
| **directoryListingChallenge / accessLogDisclosureChallenge** | **lintsight/no-serve-index（codefixes 片段）** |

### v0.3 新增（7，加粗行）

redirect×2、localXss、xssBonus、restfulXss、directoryListing、accessLogDisclosure。

## 3. 人工复核清单（pending-human 9）——全部「静态不可达」

剩余 9 条均为业务逻辑 / 鉴权缺失 / 模板插值类，静态规则面（语法级 + 函数内 taint）不可判定，
**照实标注退出召回目标**（拍板口径：不可静态化的明确标注退出分母）：

| 挑战 | 静态不可达原因 |
| --- | --- |
| adminSectionChallenge | 端点缺鉴权中间件——「缺失」无 AST 形态可锚 |
| changeProductChallenge | 价格改写业务逻辑校验缺失 |
| exposedMetricsChallenge | 端点缺鉴权中间件（同 adminSection） |
| registerAdminChallenge | 注册参数 `role` 信任边界校验逻辑缺失 |
| weakPasswordChallenge | 口令强度策略缺失（字典/长度规则是配置语义） |
| resetPasswordMortyChallenge | 重置流程时序 / 竞态类 |
| scoreBoardChallenge | 隐藏端点可达性（路由暴露逻辑） |
| tokenSaleChallenge | 业务逻辑类（时间窗校验） |
| web3SandboxChallenge | 区块链沙箱执行环境类 |

## 4. no-static-anchor（85，不计入分母）

同 v0.2：逻辑/动态/依赖类挑战无静态可定位锚点。类别分布不变（Sensitive Data Exposure 15 ·
Improper Input Validation 11 · Broken Authentication 8 · Vulnerable Components 9 ·
Broken Access Control 6 · XSS 6 · Miscellaneous 6 · Injection 5 · Cryptographic
Issues 4 · Security Misconfiguration 4 · Insecure Deserialization 3 · 其余各类 2）。

## 5. 制度化说明（v0.3 增补教训）

- **codefixes 方法体片段盲区**：官方修复片段是方法体片段（结构残缺），oxc 解析失败 → 诊断 0。
  对照方法必须区分「规则未命中」与「锚点不可解析」——不可解析锚点需补真实文件锚点
  （writeup `vuln-line` 标记）才能形成有效对照。
- **误报反哺闭环先例**：no-open-redirect 首扫误报 25% > FR-303 硬门槛 15%，未降级未禁用，
  走 `anchored_concat_clean` 表语义修复 → 0/3 = 0%。规则面扩充必须过 corpus 误报门禁后才登记。
- **召回数据源**：`bun run corpus:recall` → `.lintsight-cache/corpus/recall-now.json`（gitignore），
  本报告表格由该 JSON 生成；每加/改规则重跑即得新对照。

## 6. 逐挑战对照表（corpus:recall 生成，2026-10-16）

| 挑战 key | 类别 | 判定 | 锚点 | 命中规则 |
| --- | --- | --- | --- | --- |
| accessLogDisclosureChallenge | Observability Failures | ✅ recalled | codefixes ×4 | lintsight/no-serve-index |
| adminSectionChallenge | Broken Access Control | ⚠️ pending-human | codefixes ×4 |  |
| basketAccessChallenge | Broken Access Control | ➖ no-anchor |  |  |
| basketManipulateChallenge | Broken Access Control | ➖ no-anchor |  |  |
| bullyChatbotChallenge | Miscellaneous | ➖ no-anchor |  |  |
| captchaBypassChallenge | Broken Anti Automation | ✅ recalled | routes/captcha.ts | lintsight-engine/no-eval |
| changePasswordBenderChallenge | Broken Authentication | ➖ no-anchor |  |  |
| changeProductChallenge | Broken Access Control | ⚠️ pending-human | codefixes ×4 |  |
| christmasSpecialChallenge | Injection | ➖ no-anchor |  |  |
| closeNotificationsChallenge | Miscellaneous | ➖ no-anchor |  |  |
| continueCodeChallenge | Cryptographic Issues | ➖ no-anchor |  |  |
| csafChallenge | Miscellaneous | ➖ no-anchor |  |  |
| csrfChallenge | Broken Access Control | ➖ no-anchor |  |  |
| dataExportChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| dbSchemaChallenge | Injection | ✅ recalled | codefixes ×3<br>routes/search.ts | lintsight/no-sql-concat |
| deprecatedInterfaceChallenge | Security Misconfiguration | ➖ no-anchor |  |  |
| directoryListingChallenge | Sensitive Data Exposure | ✅ recalled | codefixes ×4 | lintsight/no-serve-index |
| dlpPasswordSprayingChallenge | Observability Failures | ➖ no-anchor |  |  |
| dlpPastebinDataLeakChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| easterEggLevelOneChallenge | Broken Access Control | ➖ no-anchor |  |  |
| easterEggLevelTwoChallenge | Cryptographic Issues | ➖ no-anchor |  |  |
| emailLeakChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| emptyUserRegistration | Improper Input Validation | ➖ no-anchor |  |  |
| ephemeralAccountantChallenge | Injection | ➖ no-anchor |  |  |
| errorHandlingChallenge | Security Misconfiguration | ➖ no-anchor |  |  |
| exposedCredentialsChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| exposedMetricsChallenge | Observability Failures | ⚠️ pending-human | codefixes ×3 |  |
| extraLanguageChallenge | Broken Anti Automation | ➖ no-anchor |  |  |
| feedbackChallenge | Broken Access Control | ➖ no-anchor |  |  |
| fileWriteChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| forgedCouponChallenge | Cryptographic Issues | ➖ no-anchor |  |  |
| forgedFeedbackChallenge | Broken Access Control | ➖ no-anchor |  |  |
| forgedReviewChallenge | Broken Access Control | ✅ recalled | codefixes ×3 | lintsight/no-floating-promise |
| forgottenBackupChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| forgottenDevBackupChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| freeDeluxeChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| geoStalkingMetaChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| geoStalkingVisualChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| ghostLoginChallenge | Broken Authentication | ➖ no-anchor |  |  |
| hiddenImageChallenge | Security through Obscurity | ➖ no-anchor |  |  |
| httpHeaderXssChallenge | XSS | ➖ no-anchor |  |  |
| jwtForgedChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| jwtUnsignedChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| killChatbotChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| knownVulnerableComponentChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| leakedApiKeyChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| lfrChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| localXssChallenge | XSS | ✅ recalled | codefixes ×4<br>frontend/src/app/search-result/search-result.component.ts | lintsight/no-floating-promise, lintsight/no-unsafe-trust-bypass |
| loginAdminChallenge | Injection | ✅ recalled | codefixes ×4<br>routes/login.ts | lintsight/no-sql-concat |
| loginAmyChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| loginBenderChallenge | Injection | ✅ recalled | codefixes ×4<br>routes/login.ts | lintsight/no-sql-concat |
| loginJimChallenge | Injection | ✅ recalled | codefixes ×4<br>routes/login.ts | lintsight/no-sql-concat |
| loginRapperChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| loginSupportChallenge | Security Misconfiguration | ➖ no-anchor |  |  |
| manipulateClockChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| misplacedSignatureFileChallenge | Observability Failures | ➖ no-anchor |  |  |
| missingEncodingChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| negativeOrderChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| nftMintChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| nftUnlockChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| noSqlCommandChallenge | Injection | ➖ no-anchor |  |  |
| noSqlOrdersChallenge | Injection | ➖ no-anchor |  |  |
| noSqlReviewsChallenge | Injection | ✅ recalled | codefixes ×3 | lintsight/no-floating-promise |
| nullByteChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| oauthUserPasswordChallenge | Broken Authentication | ➖ no-anchor |  |  |
| passwordHashLeakChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| passwordRepeatChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| persistedXssFeedbackChallenge | XSS | ➖ no-anchor |  |  |
| persistedXssUserChallenge | XSS | ➖ no-anchor |  |  |
| premiumPaywallChallenge | Cryptographic Issues | ➖ no-anchor |  |  |
| privacyPolicyChallenge | Miscellaneous | ➖ no-anchor |  |  |
| privacyPolicyProofChallenge | Security through Obscurity | ➖ no-anchor |  |  |
| rceChallenge | Insecure Deserialization | ➖ no-anchor |  |  |
| rceOccupyChallenge | Insecure Deserialization | ➖ no-anchor |  |  |
| redirectChallenge | Unvalidated Redirects | ✅ recalled | codefixes ×4<br>routes/redirect.ts | lintsight-engine/no-open-redirect |
| redirectCryptoCurrencyChallenge | Unvalidated Redirects | ✅ recalled | codefixes ×4<br>routes/redirect.ts | lintsight-engine/no-open-redirect |
| reflectedXssChallenge | XSS | ➖ no-anchor |  |  |
| registerAdminChallenge | Improper Input Validation | ⚠️ pending-human | codefixes ×4 |  |
| resetPasswordBenderChallenge | Broken Authentication | ➖ no-anchor |  |  |
| resetPasswordBjoernChallenge | Broken Authentication | ➖ no-anchor |  |  |
| resetPasswordBjoernOwaspChallenge | Broken Authentication | ➖ no-anchor |  |  |
| resetPasswordJimChallenge | Broken Authentication | ➖ no-anchor |  |  |
| resetPasswordMortyChallenge | Broken Anti Automation | ⚠️ pending-human | codefixes ×4 |  |
| resetPasswordUvoginChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| restfulXssChallenge | XSS | ✅ recalled | codefixes ×4<br>frontend/src/app/search-result/search-result.component.ts | lintsight/no-floating-promise, lintsight/no-unsafe-trust-bypass |
| retrieveBlueprintChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| scoreBoardChallenge | Miscellaneous | ⚠️ pending-human | codefixes ×3 |  |
| securityPolicyChallenge | Miscellaneous | ➖ no-anchor |  |  |
| ssrfChallenge | Broken Access Control | ✅ recalled | routes/profileImageUrlUpload.ts | lintsight-engine/no-ssrf |
| sstiChallenge | Injection | ➖ no-anchor |  |  |
| supplyChainAttackChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| svgInjectionChallenge | Security Misconfiguration | ➖ no-anchor |  |  |
| timingAttackChallenge | Broken Anti Automation | ➖ no-anchor |  |  |
| tokenSaleChallenge | Security through Obscurity | ⚠️ pending-human | codefixes ×3 |  |
| twoFactorAuthUnsafeSecretStorageChallenge | Broken Authentication | ➖ no-anchor |  |  |
| typosquattingAngularChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| typosquattingNpmChallenge | Vulnerable Components | ➖ no-anchor |  |  |
| unionSqlInjectionChallenge | Injection | ✅ recalled | codefixes ×3<br>routes/login.ts | lintsight/no-sql-concat |
| uploadSizeChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| uploadTypeChallenge | Improper Input Validation | ➖ no-anchor |  |  |
| usernameXssChallenge | XSS | ➖ no-anchor |  |  |
| videoXssChallenge | XSS | ➖ no-anchor |  |  |
| weakPasswordChallenge | Broken Authentication | ⚠️ pending-human | codefixes ×4 |  |
| web3SandboxChallenge | Broken Access Control | ⚠️ pending-human | codefixes ×3 |  |
| web3WalletChallenge | Miscellaneous | ➖ no-anchor |  |  |
| weirdCryptoChallenge | Cryptographic Issues | ✅ recalled | lib/insecurity.ts | lintsight/no-hardcoded-credentials, lintsight/no-insecure-cookie, lintsight/no-weak-hash |
| xssBonusChallenge | XSS | ✅ recalled | codefixes ×4<br>frontend/src/app/search-result/search-result.component.ts | lintsight/no-floating-promise, lintsight/no-unsafe-trust-bypass |
| xxeDosChallenge | XXE | ➖ no-anchor |  |  |
| xxeFileDisclosureChallenge | XXE | ➖ no-anchor |  |  |
| yamlBombChallenge | Insecure Deserialization | ➖ no-anchor |  |  |
| zeroStarsChallenge | Improper Input Validation | ➖ no-anchor |  |  |
