# juice-shop 逐挑战召回对照报告 v0.2（制度化）

> 日期：2026-10-05 · 依据：FR-303 验收配套（误报率 <15% 平台复核口径的数据底座）
> 前序：[juice-shop-recall-v0.1.md](./juice-shop-recall-v0.1.md)（文件级人工对照）→
> 本版将对照方法制度化：challenges.yml 解析 + codefixes 映射转正进 corpus-lib，
> `bun run corpus:recall` 一键产出逐挑战对照表（每加规则/改规则重跑即得新对照）。

## 1. 判定口径

| 判定 | 语义 |
| --- | --- |
| ✅ recalled | 锚点文件（codefixes 片段 / writeup 公认路由埋洞）中存在自有规则（lintsight/* 或 lintsight-engine/*）诊断 |
| ⚠️ pending-human | 有锚点但零命中——**人工复核清单**：规则面不覆盖（预期）或真漏报（需补规则/补表）|
| ➖ no-static-anchor | 无静态可定位锚点（逻辑绕过 / 动态解题 / 依赖 CVE / 前端交互类），**不计入静态召回分母** |

锚点 = codefixes 自动映射（官方修复挑战片段，basename 内嵌挑战 key）+ EXTRA_ANCHORS
（v0.1 人工确认的 8 个路由级埋洞：login.ts 同洞覆盖 loginAdmin/loginBender/loginJim/
unionSql 四挑战；search.ts；profileImageUrlUpload.ts；insecurity.ts；captcha.ts）。

## 2. 汇总（111 官方挑战）

- **recalled 10**（静态锚点可对照面的召回率 = 10/26 = 38.5%；分母 26 = recalled 10 + pending-human 16）
- pending-human 16（§3 人工复核清单）
- no-static-anchor 85（§4 分布；非漏报）
- 扫描面 601 文件 / 全量诊断 573 条（冷扫）

### 召回明细（10）

| 挑战 | 规则 |
| --- | --- |
| loginAdminChallenge / loginBenderChallenge / loginJimChallenge / unionSqlInjectionChallenge | lintsight/no-sql-concat（routes/login.ts 同洞） |
| dbSchemaChallenge | lintsight/no-sql-concat（routes/search.ts + codefixes 片段） |
| ssrfChallenge | lintsight-engine/no-ssrf（routes/profileImageUrlUpload.ts，官方 SSRF 埋洞） |
| weirdCryptoChallenge | lintsight/no-weak-hash + no-hardcoded-credentials + no-insecure-cookie（lib/insecurity.ts） |
| captchaBypassChallenge | lintsight-engine/no-eval（routes/captcha.ts） |
| forgedReviewChallenge | lintsight/no-floating-promise（codefixes 片段） |
| noSqlReviewsChallenge | lintsight/no-floating-promise（codefixes 片段） |

## 3. 人工复核清单（pending-human 16）

均为 codefixes-only 锚点（修复挑战片段无自有规则命中）。逐条定性提示：

| 挑战 | 预期判定方向 |
| --- | --- |
| localXssChallenge / restfulXssChallenge / xssBonusChallenge | XSS 类：漏洞面在 DOM/前端或 API 响应侧，静态规则面（no-innerhtml-assignment）锚点文件未命中——复核片段与规则语义 |
| redirectChallenge / redirectCryptoCurrencyChallenge | 开放重定向：规则面当前无 redirect 规则——预期「规则面不覆盖」，是规则清单输入 |
| weakPasswordChallenge / registerAdminChallenge | 弱口令/注册校验：逻辑+校验类，预期不覆盖 |
| adminSectionChallenge / changeProductChallenge / accessLogDisclosureChallenge / directoryListingChallenge / exposedMetricsChallenge | 访问控制/信息暴露类：多为路由/配置逻辑，预期不覆盖；accessLog/directoryListing 涉及路径处理，可评估 no-path-traversal 表扩展（静态文件服务 sink） |
| resetPasswordMortyChallenge | 重置流程时序类，预期不覆盖 |
| scoreBoardChallenge / tokenSaleChallenge / web3SandboxChallenge | 杂项/区块链类，预期不覆盖 |

## 4. no-static-anchor（85，不计入分母）

逻辑/动态/依赖类挑战无静态可定位锚点。类别分布：Sensitive Data Exposure 15 ·
Improper Input Validation 11 · Broken Authentication 8 · Vulnerable Components 9 ·
Broken Access Control 6 · XSS 6 · Miscellaneous 6 · Injection 5 · Cryptographic
Issues 4 · Security Misconfiguration 4 · Insecure Deserialization 3 · 其余各类 2。

## 5. 制度化说明

- 解析/映射在 `scripts/corpus-lib.ts`（parseChallengesYml / mapCodefixes，纯函数 + 单测），
  编排在 `scripts/corpus-recall.ts`；机器可读结果写入
  `.lintsight-cache/corpus/recall-now.json`（gitignore）。
- 每新增/修改规则后重跑 `bun run corpus:recall`，与 recall-now.json 的 rows 比对：
  recalled 集合只增不减为回归底线；pending-human 集合缩小为正反馈。
- EXTRA_ANCHORS 扩充 = 人工对照成果沉淀（须 writeup 公认，防自我实现）。

## 6. 逐挑战对照表（corpus:recall 生成）

| 挑战 key | 类别 | 判定 | 锚点 | 命中规则 |
| --- | --- | --- | --- | --- |
| accessLogDisclosureChallenge | Observability Failures | ⚠️ pending-human | codefixes ×4 |  |
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
| directoryListingChallenge | Sensitive Data Exposure | ⚠️ pending-human | codefixes ×4 |  |
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
| localXssChallenge | XSS | ⚠️ pending-human | codefixes ×4 |  |
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
| redirectChallenge | Unvalidated Redirects | ⚠️ pending-human | codefixes ×4 |  |
| redirectCryptoCurrencyChallenge | Unvalidated Redirects | ⚠️ pending-human | codefixes ×4 |  |
| reflectedXssChallenge | XSS | ➖ no-anchor |  |  |
| registerAdminChallenge | Improper Input Validation | ⚠️ pending-human | codefixes ×4 |  |
| resetPasswordBenderChallenge | Broken Authentication | ➖ no-anchor |  |  |
| resetPasswordBjoernChallenge | Broken Authentication | ➖ no-anchor |  |  |
| resetPasswordBjoernOwaspChallenge | Broken Authentication | ➖ no-anchor |  |  |
| resetPasswordJimChallenge | Broken Authentication | ➖ no-anchor |  |  |
| resetPasswordMortyChallenge | Broken Anti Automation | ⚠️ pending-human | codefixes ×4 |  |
| resetPasswordUvoginChallenge | Sensitive Data Exposure | ➖ no-anchor |  |  |
| restfulXssChallenge | XSS | ⚠️ pending-human | codefixes ×4 |  |
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
| xssBonusChallenge | XSS | ⚠️ pending-human | codefixes ×4 |  |
| xxeDosChallenge | XXE | ➖ no-anchor |  |  |
| xxeFileDisclosureChallenge | XXE | ➖ no-anchor |  |  |
| yamlBombChallenge | Insecure Deserialization | ➖ no-anchor |  |  |
| zeroStarsChallenge | Improper Input Validation | ➖ no-anchor |  |  |
