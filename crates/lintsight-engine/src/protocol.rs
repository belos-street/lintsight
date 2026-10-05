//! 协议层（design-m2 §4.2 v0）：输入/输出结构 + JSON Lines 输出 + fatal 退出。

use serde::Serialize;

#[derive(serde::Deserialize)]
pub struct EngineInput {
    pub files: Vec<String>,
    /// M2 架构规则配置（T2.4，config-bridge 校验后直传）；None = 不注册 arch 规则
    pub arch: Option<ArchConfig>,
    /// tsconfig paths 映射（FR-304 别名兜底，Bun 侧归一化：相对 root、POSIX、
    /// 已按 TS best-match 排序）；None = 裸说明符维持跳过语义
    #[serde(rename = "tsPaths")]
    pub ts_paths: Option<Vec<TsPathMapping>>,
}

/// tsconfig paths 单条映射（pattern/targets 保留 `*` 通配）。
/// `dir` = 拥有该 tsconfig 的目录（相对 root 的 POSIX 路径，"" = 根 tsconfig）——
/// FR-304① 嵌套 tsconfig：引擎按 importer 的最近祖先 tsconfig 选映射集（TS 语义）。
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TsPathMapping {
    #[serde(default)]
    pub dir: String,
    pub pattern: String,
    pub targets: Vec<String>,
}

/// 架构边界配置（design-m2 §4.1 arch-rules；shape 由 Bun config-bridge 校验保证）。
/// `import_cycles` / `enforce_exports` 为 opt-in 能力开关（FR-304②③，typeAware 同款
/// 纪律：缺省关闭，corpus/golden 契约零漂移；试点后再评估默认值）。
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ArchConfig {
    pub zones: Vec<ArchZone>,
    #[serde(rename = "importCycles", default)]
    pub import_cycles: bool,
    #[serde(rename = "enforceExports", default)]
    pub enforce_exports: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ArchZone {
    pub name: String,
    /// 文件归属 glob（POSIX 相对路径；首匹配生效）
    #[serde(rename = "match")]
    pub match_paths: Vec<String>,
    /// 允许 import 的目标 glob（同 zone 互引恒允许，无需列举）
    #[serde(default)]
    pub allow: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Span {
    pub offset: u32,
    pub length: u32,
    pub line: u32,
    pub column: u32,
}

/// taint 证据链事件（design-m2 §4.2 附录 C v0）：kind ∈ source|propagation|sanitizer|sink
#[derive(Debug, Clone, Serialize)]
pub struct PathEvent {
    pub kind: &'static str,
    /// 如 "fs.readdirSync" / "path.join" / "path.basename"
    pub node: String,
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Diagnostic {
    #[serde(rename = "type")]
    pub kind: &'static str, // 恒 "diagnostic"
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    pub severity: &'static str,
    pub message: String,
    pub file: String,
    pub span: Span,
    /// taint 规则必带（source→…→sink 证据链）；普通规则为空且不序列化（向后兼容）
    #[serde(rename = "pathEvents", skip_serializing_if = "Vec::is_empty")]
    pub path_events: Vec<PathEvent>,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    #[serde(rename = "type")]
    pub kind: &'static str, // 恒 "summary"
    pub files: usize,
    pub rules: Vec<String>,
}

pub fn emit_line<T: Serialize>(value: &T) {
    println!("{}", serde_json::to_string(value).expect("serialize"));
}

/// 协议级 fatal：stderr 错误 + exit 2（Bun 侧 fail-open 降级纯 M1 扫描）
pub fn fatal(message: &str) -> ! {
    eprintln!("lintsight-engine: {message}");
    std::process::exit(2);
}
