//! 规则层（T2.2 产品化）：`EngineRule` trait = Rust 轨道规则的唯一接入面。
//!
//! registry() 是全部引擎规则的登记处（Summary.rules 由此生成，将来 M2-DR5 的
//! source/sanitizer/sink 表交叠校验也挂在登记期）。规则 id 一律 `lintsight-engine/<name>`。
//! RawDiag 必须 arena 无关（全 owned/'static）——FileContext drop 后诊断仍存活。

use oxc_ast::AstKind;
use oxc_span::Span;

use crate::context::FileContext;
use crate::protocol::{ArchConfig, PathEvent, TsPathMapping};
use crate::taint::TaintTables;

pub struct RawDiag {
    pub rule_id: &'static str,
    pub severity: &'static str,
    pub message: String,
    pub span: Span,
    /// taint 规则证据链；普通规则为空
    pub path_events: Vec<PathEvent>,
}

/// Send+Sync：T2.6 rayon 文件级并行要求规则可跨线程共享（规则须无内部可变状态）
pub trait EngineRule: Send + Sync {
    fn id(&self) -> &'static str;
    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag>;
}

/// no-eval（T2.1 联通验证规则，CWE-95 动态代码执行）：oxlint 内置 no-eval 属
/// restriction 类未默认启用 → 语料零双报。span = 整个 CallExpression（保持 T2.1 口径）。
struct NoEval;

impl EngineRule for NoEval {
    fn id(&self) -> &'static str {
        "lintsight-engine/no-eval"
    }

    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag> {
        let mut out = Vec::new();
        for node in ctx.semantic().nodes().iter() {
            if let AstKind::CallExpression(call) = node.kind() {
                if let oxc_ast::ast::Expression::Identifier(ident) = &call.callee {
                    if ident.name == "eval" {
                        out.push(RawDiag {
                            rule_id: self.id(),
                            severity: "error",
                            message: "eval() allows arbitrary code execution; use safer alternatives. (no-eval)".into(),
                            span: call.span,
                            path_events: Vec::new(),
                        });
                    }
                }
            }
        }
        out
    }
}

/// no-path-traversal（CWE-22 路径穿越）函数表（M2-DR5 注册表 v0）：
/// readdir 是 source 不是 sink（spike ⑤ 教训 #1）；validate() 在登记期做交叠校验。
const PATH_TRAVERSAL_TABLES: TaintTables = TaintTables {
    name: "no-path-traversal",
    sources: &[("fs", "readdirSync")],
    member_sources: &[],
    propagators: &[("path", "join")],
    sanitizers: &[("path", "basename")],
    sinks: &[
        ("fs", "readFileSync"),
        ("fs", "readFile"),
        ("fs", "writeFileSync"),
        ("fs", "writeFile"),
        ("fs", "appendFileSync"),
        ("fs", "appendFile"),
    ],
    sink_arg_index: 0,
};

/// no-path-traversal：外部可控文件名（readdirSync）未消毒抵达 fs 读写 sink。
/// span = sink 调用表达式；pathEvents = source→…→sink 证据链。
struct NoPathTraversal;

impl EngineRule for NoPathTraversal {
    fn id(&self) -> &'static str {
        "lintsight-engine/no-path-traversal"
    }

    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag> {
        crate::taint::run(ctx, &PATH_TRAVERSAL_TABLES)
            .into_iter()
            .map(|hit| RawDiag {
                rule_id: self.id(),
                severity: "error",
                message: format!(
                    "Untrusted filename from {}.{} reaches {}.{} without sanitization; validate against an allowlist or wrap with path.basename. (no-path-traversal)",
                    PATH_TRAVERSAL_TABLES.sources[0].0,
                    PATH_TRAVERSAL_TABLES.sources[0].1,
                    hit.func.0,
                    hit.func.1,
                ),
                span: hit.span,
                path_events: hit.events,
            })
            .collect()
    }
}

/// no-command-injection（CWE-78 命令注入，FR-303 硬门槛，FR-305 后端扩展首批）：
/// 用户输入（成员表达式 source：req.query/body/params/headers/cookies 及 Koa
/// ctx.request.* 形态）未验证抵达 shell 执行 sink。裸标识符 sink 支持
/// `import { exec } from 'node:child_process'` 的解构导入形态（obj=""约定）。
/// v0 无 sanitizer 表（shell 转义不可靠，正确做法是 execFile + 参数数组）。
const COMMAND_INJECTION_TABLES: TaintTables = TaintTables {
    name: "no-command-injection",
    sources: &[],
    member_sources: &[
        ("req", "query"),
        ("req", "body"),
        ("req", "params"),
        ("req", "headers"),
        ("req", "cookies"),
        ("request", "query"),
        ("request", "body"),
        ("request", "params"),
        ("request", "headers"),
        ("request", "cookies"),
        ("ctx", "query"),
        ("ctx", "request"),
    ],
    propagators: &[("path", "join")],
    sanitizers: &[],
    sinks: &[
        ("", "exec"),
        ("", "execSync"),
        ("", "spawn"),
        ("", "spawnSync"),
        ("cp", "exec"),
        ("cp", "execSync"),
        ("cp", "spawn"),
        ("cp", "spawnSync"),
        ("child_process", "exec"),
        ("child_process", "execSync"),
        ("child_process", "spawn"),
        ("child_process", "spawnSync"),
    ],
    sink_arg_index: 0,
};

/// no-command-injection：外部可控输入未验证抵达 shell 执行 sink。
/// span = sink 调用表达式；pathEvents = source→…→sink 证据链（链头 = 实际 source 形态）。
struct NoCommandInjection;

impl EngineRule for NoCommandInjection {
    fn id(&self) -> &'static str {
        "lintsight-engine/no-command-injection"
    }

    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag> {
        crate::taint::run(ctx, &COMMAND_INJECTION_TABLES)
            .into_iter()
            .map(|hit| RawDiag {
                rule_id: self.id(),
                severity: "error",
                message: format!(
                    "Untrusted input from {} reaches {}.{} without validation; use an allowlist or execFile with argument arrays. (no-command-injection)",
                    hit.events
                        .first()
                        .map(|e| e.node.as_str())
                        .unwrap_or("request input"),
                    hit.func.0,
                    hit.func.1,
                ),
                span: hit.span,
                path_events: hit.events,
            })
            .collect()
    }
}

/// no-ssrf（CWE-918 服务端请求伪造，FR-303 stretch）：
/// 用户可控 URL 抵达服务端出站请求——可打内网（169.254.169.254 元数据/内网 IP）。
/// sink 覆盖 fetch（解构/全局）+ axios（方法调用 + options 对象裸调用）+ node
/// http/https 常用方法；options 对象形态（axios({ url })）由引擎的
/// options-object 污染形态识别（URL 语义键 url/uri/baseURL/hostname）。
const SSRF_TABLES: TaintTables = TaintTables {
    name: "no-ssrf",
    sources: &[],
    member_sources: &[
        ("req", "query"),
        ("req", "body"),
        ("req", "params"),
        ("req", "headers"),
        ("request", "query"),
        ("request", "body"),
        ("request", "params"),
        ("ctx", "query"),
        ("ctx", "request"),
    ],
    propagators: &[("path", "join")],
    sanitizers: &[],
    sinks: &[
        ("", "fetch"),
        ("", "axios"),
        ("axios", "get"),
        ("axios", "post"),
        ("axios", "put"),
        ("axios", "delete"),
        ("axios", "request"),
        ("http", "get"),
        ("http", "request"),
        ("https", "get"),
        ("https", "request"),
    ],
    sink_arg_index: 0,
};

/// no-ssrf：外部可控 URL 未验证（host allowlist）抵达服务端出站请求。
struct NoSsrf;

impl EngineRule for NoSsrf {
    fn id(&self) -> &'static str {
        "lintsight-engine/no-ssrf"
    }

    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag> {
        crate::taint::run(ctx, &SSRF_TABLES)
            .into_iter()
            .map(|hit| RawDiag {
                rule_id: self.id(),
                severity: "error",
                message: format!(
                    "Untrusted input from {} reaches {}.{} without validation; validate the URL against a host allowlist (SSRF can reach internal networks). (no-ssrf)",
                    hit.events
                        .first()
                        .map(|e| e.node.as_str())
                        .unwrap_or("request input"),
                    hit.func.0,
                    hit.func.1,
                ),
                span: hit.span,
                path_events: hit.events,
            })
            .collect()
    }
}

/// no-prototype-pollution-merge（CWE-1321，FR-303 硬门槛第 3 条，taint 版接管
/// M1 no-prototype-pollution-syntax 的动态合并面）：
/// 外部可控对象（req.body 等，攻击者可控 `__proto__`/`constructor` 键）流入
/// Object.assign / lodash merge·defaultsDeep·set 的合并目标——sink 污染点在
/// 第二参数（sink_arg_index=1）。与 M1 语法版分工：语法版抓字面量 `__proto__`
/// 键（确定性、不依赖污染源），本条抓动态可控源（互补不重叠，不登记 supersedes）。
const PROTO_POLLUTION_TABLES: TaintTables = TaintTables {
    name: "no-prototype-pollution-merge",
    sources: &[],
    member_sources: &[
        ("req", "body"),
        ("req", "query"),
        ("req", "params"),
        ("request", "body"),
        ("request", "query"),
        ("ctx", "request"),
    ],
    propagators: &[],
    sanitizers: &[],
    sinks: &[
        ("Object", "assign"),
        ("lodash", "merge"),
        ("lodash", "mergeWith"),
        ("lodash", "defaultsDeep"),
        ("lodash", "set"),
        ("_", "merge"),
        ("_", "mergeWith"),
        ("_", "defaultsDeep"),
        ("_", "set"),
    ],
    sink_arg_index: 1,
};

/// no-prototype-pollution-merge：可控源流入合并/深写目标，攻击者可借
/// `__proto__` 键污染原型链。span = 合并调用表达式。
struct NoPrototypePollutionMerge;

impl EngineRule for NoPrototypePollutionMerge {
    fn id(&self) -> &'static str {
        "lintsight-engine/no-prototype-pollution-merge"
    }

    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag> {
        crate::taint::run(ctx, &PROTO_POLLUTION_TABLES)
            .into_iter()
            .map(|hit| RawDiag {
                rule_id: self.id(),
                severity: "error",
                message: format!(
                    "Untrusted input from {} reaches {}.{} as a merge source; attacker-controlled `__proto__`/`constructor` keys can pollute the prototype chain. Freeze the target or copy only allowlisted keys. (no-prototype-pollution-merge)",
                    hit.events
                        .first()
                        .map(|e| e.node.as_str())
                        .unwrap_or("request input"),
                    hit.func.0,
                    hit.func.1,
                ),
                span: hit.span,
                path_events: hit.events,
            })
            .collect()
    }
}

/// 全部引擎规则登记处（表交叠校验随登记执行——校验失败即引擎启动 panic，
/// Bun 侧 fail-open 降级，cargo test 提前拦截）。
/// arch 配置缺省时架构规则不注册（Summary.rules 亦不含）；ts_paths 同随 stdin 下发。
pub fn registry(arch: Option<&ArchConfig>, ts_paths: &[TsPathMapping]) -> Vec<Box<dyn EngineRule>> {
    PATH_TRAVERSAL_TABLES
        .validate()
        .expect("no-path-traversal 函数表交叠");
    COMMAND_INJECTION_TABLES
        .validate()
        .expect("no-command-injection 函数表交叠");
    SSRF_TABLES.validate().expect("no-ssrf 函数表交叠");
    PROTO_POLLUTION_TABLES
        .validate()
        .expect("no-prototype-pollution-merge 函数表交叠");
    let mut rules: Vec<Box<dyn EngineRule>> = vec![
        Box::new(NoEval),
        Box::new(NoPathTraversal),
        Box::new(NoCommandInjection),
        Box::new(NoSsrf),
        Box::new(NoPrototypePollutionMerge),
    ];
    if let Some(cfg) = arch {
        rules.push(Box::new(ArchBoundaries {
            config: cfg.clone(),
            ts_paths: ts_paths.to_vec(),
        }));
    }
    rules
}

/// arch-boundaries（T2.4）：zone 依赖方向，配置驱动（stdin 下发，缺省不注册）。
/// 拥有配置/映射克隆（'static）——不借用 stdin 输入的生命周期。
struct ArchBoundaries {
    config: ArchConfig,
    ts_paths: Vec<TsPathMapping>,
}

impl EngineRule for ArchBoundaries {
    fn id(&self) -> &'static str {
        crate::arch::rule_id()
    }

    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag> {
        crate::arch::run(ctx, &self.config, &self.ts_paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hits(source: &str) -> Vec<Span> {
        let allocator = oxc_allocator::Allocator::default();
        let mut spans = Vec::new();
        crate::context::with_context(&allocator, "a.ts", source, |ctx| {
            spans = NoEval.check(ctx).into_iter().map(|d| d.span).collect();
        });
        spans
    }

    #[test]
    fn detects_direct_eval_call() {
        let spans = hits("eval('1+1')\n");
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].start, 0);
        assert_eq!(spans[0].end, 11); // 整个 CallExpression：eval('1+1') = 11 chars
    }

    #[test]
    fn ignores_member_call_and_clean_code() {
        assert!(hits("foo.eval('1')\n").is_empty());
        assert!(hits("const e = 1\nconsole.log(e)\n").is_empty());
    }

    // —— no-path-traversal（taint 竖切验收用例，对应 text-rpg readdir→join→readFile 场景） ——

    fn traversal_hits(source: &str) -> Vec<(u32, Vec<&'static str>)> {
        let allocator = oxc_allocator::Allocator::default();
        let mut out = Vec::new();
        crate::context::with_context(&allocator, "a.ts", source, |ctx| {
            for d in NoPathTraversal.check(ctx) {
                out.push((d.span.start, d.path_events.iter().map(|e| e.kind).collect()));
            }
        });
        out
    }

    const REaddir_JOIN_READ: &str = "\
import fs from 'node:fs'
import path from 'node:path'
const files = fs.readdirSync('./data')
for (const f of files) {
  fs.readFileSync(path.join('./data', f))
}
";

    #[test]
    fn detects_readdir_join_sink_loop() {
        let hits = traversal_hits(REaddir_JOIN_READ);
        assert_eq!(hits.len(), 1, "回边不动点收敛后 sink 只报一次");
        // 证据链完整：source → propagation(join) → sink
        assert_eq!(hits[0].1, vec!["source", "propagation", "sink"]);
    }

    #[test]
    fn sanitizer_flow_not_reported() {
        let src = "\
import fs from 'node:fs'
import path from 'node:path'
const files = fs.readdirSync('./data')
for (const f of files) {
  fs.readFileSync(path.join('./data', path.basename(f)))
}
";
        assert!(traversal_hits(src).is_empty(), "basename 消毒后不得误报");
    }

    #[test]
    fn detects_computed_index_sink() {
        let src = "\
import fs from 'node:fs'
const files = fs.readdirSync('./data')
fs.writeFileSync(files[0], 'x')
";
        let hits = traversal_hits(src);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].1, vec!["source", "sink"]);
    }

    #[test]
    fn clean_project_no_report() {
        assert!(
            traversal_hits("import fs from 'node:fs'\nfs.readFileSync('./config.json')\n")
                .is_empty()
        );
    }

    #[test]
    fn tables_have_no_overlap() {
        assert!(PATH_TRAVERSAL_TABLES.validate().is_ok());
        assert!(COMMAND_INJECTION_TABLES.validate().is_ok());
        assert!(SSRF_TABLES.validate().is_ok());
        assert!(PROTO_POLLUTION_TABLES.validate().is_ok());
    }

    // —— no-ssrf（CWE-918） ——

    fn ssrf_hits(source: &str) -> Vec<Vec<&'static str>> {
        let allocator = oxc_allocator::Allocator::default();
        let mut out = Vec::new();
        crate::context::with_context(&allocator, "a.ts", source, |ctx| {
            for d in NoSsrf.check(ctx) {
                out.push(d.path_events.iter().map(|e| e.kind).collect());
            }
        });
        out
    }

    #[test]
    fn detects_ssrf_from_request_url() {
        // 全局 fetch + 成员 source
        let src = "\
export async function proxy(req) {
  return fetch(req.query.target)
}
";
        assert_eq!(ssrf_hits(src), [vec!["source", "sink"]]);
        // axios 命名空间形态
        let src = "\
import axios from 'axios'
export async function pull(req) {
  return axios.get(req.body.url)
}
";
        assert_eq!(ssrf_hits(src), [vec!["source", "sink"]]);
    }

    #[test]
    fn clean_ssrf_not_reported() {
        let src = "\
export async function ok(req) {
  return fetch('https://api.internal/status')
}
";
        assert!(ssrf_hits(src).is_empty());
    }

    // —— no-prototype-pollution-merge（CWE-1321，sink_arg_index=1 模型） ——

    fn proto_hits(source: &str) -> Vec<Vec<&'static str>> {
        let allocator = oxc_allocator::Allocator::default();
        let mut out = Vec::new();
        crate::context::with_context(&allocator, "a.ts", source, |ctx| {
            for d in NoPrototypePollutionMerge.check(ctx) {
                out.push(d.path_events.iter().map(|e| e.kind).collect());
            }
        });
        out
    }

    #[test]
    fn detects_proto_pollution_via_object_assign() {
        // 经典 CVE 形态：body 可控对象 merge 进 config——污染点在第二参数
        let src = "\
export function updateConfig(req, config) {
  Object.assign(config, req.body)
  return config
}
";
        assert_eq!(proto_hits(src), [vec!["source", "sink"]]);
    }

    #[test]
    fn detects_proto_pollution_via_lodash() {
        let src = "\
import _ from 'lodash'
export function patch(req, doc) {
  return _.merge(doc, req.body)
}
";
        assert_eq!(proto_hits(src), [vec!["source", "sink"]]);
    }

    #[test]
    fn clean_merge_not_reported() {
        let src = "\
export function safe(req, config) {
  Object.assign(config, { verbose: true })
  return config
}
";
        assert!(proto_hits(src).is_empty(), "非源实参不得报");
    }

    // —— no-command-injection（CWE-78，FR-303 硬门槛：成员表达式 source 模型首批） ——

    fn injection_hits(source: &str) -> Vec<(u32, Vec<&'static str>)> {
        let allocator = oxc_allocator::Allocator::default();
        let mut out = Vec::new();
        crate::context::with_context(&allocator, "a.ts", source, |ctx| {
            for d in NoCommandInjection.check(ctx) {
                out.push((d.span.start, d.path_events.iter().map(|e| e.kind).collect()));
            }
        });
        out
    }

    #[test]
    fn detects_injection_from_express_member_source() {
        let src = "\
import { exec } from 'node:child_process'
export function handler(req) {
  exec(`ls ${req.query.name}`)
}
";
        let hits = injection_hits(src);
        assert_eq!(hits.len(), 1);
        // 链头 = 成员表达式 source（req.query），经模板串传播到 sink
        assert_eq!(hits[0].1, vec!["source", "propagation", "sink"]);
    }

    #[test]
    fn detects_injection_from_hono_call_source() {
        // Hono 形态：c.req.query('cmd') 调用返回值污染 → 模板串 → 裸 execSync
        let src = "\
import { execSync } from 'node:child_process'
export function h(c) {
  const cmd = c.req.query('cmd')
  return execSync(`git log ${cmd}`)
}
";
        let hits = injection_hits(src);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].1, vec!["source", "propagation", "sink"]);
    }

    #[test]
    fn clean_commands_not_reported() {
        let src = "\
import { exec } from 'node:child_process'
const fixed = 'ls -la'
export function run(cmd) {
  exec('ls -la')
  exec(fixed)
}
";
        assert!(injection_hits(src).is_empty(), "字面量与非源变量不得报");
    }

    // —— v0 边界补齐：解构传播 / 导入别名 / options 对象 / 回调参数污点 ——

    #[test]
    fn detects_destructuring_propagation() {
        // 对象解构：cmd 继承 req.query 污染（no-command-injection 轨）
        let src = "\
import { exec } from 'node:child_process'
export function handler(req) {
  const { cmd } = req.query
  exec(cmd)
}
";
        let hits = injection_hits(src);
        assert_eq!(hits.len(), 1, "对象解构绑定应继承污染");
        assert_eq!(hits[0].1, vec!["source", "sink"]);

        // 数组解构：first 继承 readdir 清单污染（no-path-traversal 轨）
        let src = "\
import fs from 'node:fs'
const files = fs.readdirSync('./data')
const [first] = files
fs.writeFileSync(first, 'x')
";
        let hits = traversal_hits(src);
        assert_eq!(hits.len(), 1, "数组解构绑定应继承污染");
        assert_eq!(hits[0].1, vec!["source", "sink"]);
    }

    #[test]
    fn destructuring_from_clean_source_not_reported() {
        // 负面：解构自非污染源（字面量对象/数组）不得报
        let src = "\
import fs from 'node:fs'
const { a } = { a: './safe.txt' }
const [x] = ['also-safe.txt']
fs.readFileSync(a)
fs.readFileSync(x)
";
        assert!(traversal_hits(src).is_empty(), "解构自非污染源不得报");
    }

    #[test]
    fn detects_import_default_and_namespace_alias() {
        // default 导入别名：fs2/p2 归一到 fs/path 标准名（source/propagator/sink 全链）
        let src = "\
import fs2 from 'node:fs'
import p2 from 'node:path'
const files = fs2.readdirSync('./data')
fs2.readFileSync(p2.join('./data', files[0]))
";
        let hits = traversal_hits(src);
        assert_eq!(hits.len(), 1, "default 导入别名应命中 sink");
        assert_eq!(hits[0].1, vec!["source", "propagation", "sink"]);

        // namespace 导入：fsp → fs
        let src = "\
import * as fsp from 'fs'
const files = fsp.readdirSync('./data')
fsp.writeFileSync(files[0], 'x')
";
        let hits = traversal_hits(src);
        assert_eq!(hits.len(), 1, "namespace 导入别名应命中 sink");
        assert_eq!(hits[0].1, vec!["source", "sink"]);
    }

    #[test]
    fn alias_to_unknown_module_not_reported() {
        // 负面：别名表只收录函数表涉及的标准模块——fs-extra 不归一，不产生幻影 sink
        let src = "\
import fake from 'fs-extra'
fake.readFileSync('./config.json')
";
        assert!(traversal_hits(src).is_empty());
    }

    #[test]
    fn detects_ssrf_via_axios_options_object() {
        // 裸调用 + options 对象 url 键污染（复核清单项）
        let src = "\
import axios from 'axios'
export async function pull(req) {
  return axios({ url: req.body.target, method: 'get' })
}
";
        assert_eq!(ssrf_hits(src), [vec!["source", "propagation", "sink"]]);

        // baseURL 键形态
        let src = "\
import axios from 'axios'
export async function pull(req) {
  return axios({ baseURL: req.query.host })
}
";
        assert_eq!(ssrf_hits(src), [vec!["source", "propagation", "sink"]]);
    }

    #[test]
    fn clean_axios_options_not_reported() {
        // 负面：url 值为字面量 / 污染值不在 URL 语义键下 → 不报
        let src = "\
import axios from 'axios'
export async function ok(req) {
  axios({ url: '/api/safe', method: 'get' })
  axios({ timeout: req.query.ms })
}
";
        assert!(ssrf_hits(src).is_empty());
    }

    #[test]
    fn detects_arrow_callback_param_taint() {
        // map 回调参数继承容器污染（容器 = readdir source）
        let src = "\
import fs from 'node:fs'
const files = fs.readdirSync('./data')
files.map((f) => fs.readFileSync(f))
";
        let hits = traversal_hits(src);
        assert_eq!(hits.len(), 1, "map 回调参数应继承容器污染");
        assert_eq!(hits[0].1, vec!["source", "sink"]);
    }

    #[test]
    fn clean_arrow_callback_not_reported() {
        // 负面：回调内未使用污染参数；容器非污染（字面量数组）不得驱动参数污点
        let src = "\
import fs from 'node:fs'
const files = fs.readdirSync('./data')
files.map((f) => fs.readFileSync('safe.txt'))
";
        assert!(traversal_hits(src).is_empty());
        let src = "\
import fs from 'node:fs'
const names = ['a', 'b']
names.forEach((n) => fs.readFileSync(n))
";
        assert!(
            traversal_hits(src).is_empty(),
            "非污染容器不得驱动回调参数污点"
        );
    }

    // —— arch-boundaries（T2.4） ——

    #[test]
    fn arch_zone_boundary_violation_and_allow() {
        let cfg: ArchConfig = serde_json::from_str(
            r#"{"zones":[
                {"name":"core","match":["src/core/**"],"allow":["src/core/**"]},
                {"name":"ui","match":["src/ui/**"],"allow":["src/core/**"]}
            ]}"#,
        )
        .unwrap();
        let allocator = oxc_allocator::Allocator::default();

        // core → ui：越界（ui 不在 core 的 allow）
        let mut out = Vec::new();
        crate::context::with_context(
            &allocator,
            "src/core/a.ts",
            "import { x } from '../ui/b'\n",
            |ctx| {
                out = crate::arch::run(ctx, &cfg, &[]);
            },
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].rule_id, "lintsight-engine/arch-boundaries");
        assert!(out[0].message.contains("'core' → 'ui'"));

        // ui → core：allow 放行
        let mut out = Vec::new();
        crate::context::with_context(
            &allocator,
            "src/ui/b.ts",
            "import { x } from '../core/a'\nimport 'lodash'\n",
            |ctx| {
                out = crate::arch::run(ctx, &cfg, &[]);
            },
        );
        assert!(out.is_empty(), "allow 内 + 裸说明符不得报告");

        // 未归 zone 文件不受约束
        let mut out = Vec::new();
        crate::context::with_context(&allocator, "src/other/c.ts", "import '../ui/b'\n", |ctx| {
            out = crate::arch::run(ctx, &cfg, &[]);
        });
        assert!(out.is_empty());
    }

    #[test]
    fn arch_alias_via_tsconfig_paths() {
        // importer（app）与目标（lib）都要归 zone：别名解析后 app→lib 越界
        let cfg: ArchConfig = serde_json::from_str(
            r#"{"zones":[
                {"name":"app","match":["src/app/**"],"allow":[]},
                {"name":"lib","match":["src/lib/**"],"allow":["src/app/**"]}
            ]}"#,
        )
        .unwrap();
        let ts_paths: Vec<TsPathMapping> =
            serde_json::from_str(r#"[{"pattern":"@lib/*","targets":["src/lib/*"]}]"#).unwrap();
        let allocator = oxc_allocator::Allocator::default();

        // 别名 import 兜底解析后命中 zone 边界（FR-304）
        let mut out = Vec::new();
        crate::context::with_context(
            &allocator,
            "src/app/a.ts",
            "import { x } from '@lib/util'\n",
            |ctx| {
                out = crate::arch::run(ctx, &cfg, &ts_paths);
            },
        );
        assert_eq!(out.len(), 1);
        // message 含解析后的目标路径（比别名 specifier 更可定位）与 zone 对
        assert!(out[0].message.contains("src/lib/util"));
        assert!(out[0].message.contains("'app' → 'lib'"));

        // 无 ts_paths 时同名 import 维持跳过（v0 语义回归哨兵）
        let mut out = Vec::new();
        crate::context::with_context(
            &allocator,
            "src/app/a.ts",
            "import { x } from '@lib/util'\n",
            |ctx| {
                out = crate::arch::run(ctx, &cfg, &[]);
            },
        );
        assert!(out.is_empty());
    }
}
