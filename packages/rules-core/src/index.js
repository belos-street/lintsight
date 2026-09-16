/**
 * @lintsight/rules-core —— 自有规则集源码（每规则一文件）。
 * 构建聚合为自包含单文件产物（plugins/lintsight-rules/index.js），
 * 产物被 oxlint 嵌入式 runtime 加载——该 runtime 不支持相对 import（实测），必须自包含。
 */
import noEmptyCatch from './rules/no-empty-catch.js'
import noAsyncArrayMethod from './rules/no-async-array-method.js'
import noFloatingPromise from './rules/no-floating-promise.js'
import noSwallowedPromiseError from './rules/no-swallowed-promise-error.js'
import noClosureLoopVar from './rules/no-closure-loop-var.js'
import noArrayMapSideEffect from './rules/no-array-map-side-effect.js'
import noJsonStructuredClone from './rules/no-json-structured-clone.js'
import noIgnoredReduceResult from './rules/no-ignored-reduce-result.js'
import noEmptyPromiseCatch from './rules/no-empty-promise-catch.js'
import noAsyncConstructorCall from './rules/no-async-constructor-call.js'
import noSyncIoInAsync from './rules/no-sync-io-in-async.js'

export default {
  name: 'lintsight',
  meta: { name: 'lintsight' },
  rules: {
    'no-empty-catch': noEmptyCatch,
    'no-async-array-method': noAsyncArrayMethod,
    'no-floating-promise': noFloatingPromise,
    'no-swallowed-promise-error': noSwallowedPromiseError,
    'no-closure-loop-var': noClosureLoopVar,
    'no-array-map-side-effect': noArrayMapSideEffect,
    'no-json-structured-clone': noJsonStructuredClone,
    'no-ignored-reduce-result': noIgnoredReduceResult,
    'no-empty-promise-catch': noEmptyPromiseCatch,
    'no-async-constructor-call': noAsyncConstructorCall,
    'no-sync-io-in-async': noSyncIoInAsync
  }
}
