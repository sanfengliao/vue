/* @flow */

import config from '../config'
import { warn } from './debug'
import { set } from '../observer/index'
import { unicodeRegExp } from './lang'
import { nativeWatch, hasSymbol } from './env'

import {
  ASSET_TYPES,
  LIFECYCLE_HOOKS
} from 'shared/constants'

import {
  extend,
  hasOwn,
  camelize,
  toRawType,
  capitalize,
  isBuiltInTag,
  isPlainObject
} from 'shared/util'

/**
 * Option overwriting strategies are functions that handle
 * how to merge a parent option value and a child option
 * value into the final value.
 */
const strats = config.optionMergeStrategies

/**
 * Options with restrictions
 */
if (process.env.NODE_ENV !== 'production') {
  // 合并el和propsData选项
  strats.el = strats.propsData = function (parent, child, vm, key) {
    // 在生产环境下判断是否通过new构造函数，如果不是，则不能使用el和propsData选项
    if (!vm) {
      warn(
        `option "${key}" can only be used during instance ` +
        'creation with the `new` keyword.'
      )
    }
    // 采用默认的合并策略
    return defaultStrat(parent, child)
  }
}

/**
 * Helper that recursively merges two data objects together.
 */
function mergeData (to: Object, from: ?Object): Object {
  if (!from) return to
  let key, toVal, fromVal

  const keys = hasSymbol
    ? Reflect.ownKeys(from)
    : Object.keys(from)

  for (let i = 0; i < keys.length; i++) {
    key = keys[i]
    // in case the object is already observed...
    if (key === '__ob__') continue
    toVal = to[key]
    fromVal = from[key]
    // 如果to中不存在key,将from的key的值赋给tokey
    if (!hasOwn(to, key)) {
      set(to, key, fromVal)
    } else if (
      toVal !== fromVal &&
      isPlainObject(toVal) &&
      isPlainObject(fromVal)
    ) {
      // 如果toVal和fromVal是个对象，递归合并
      mergeData(toVal, fromVal)
    }
  }
  return to
}

/**
 * 合并data选项，返回一个可以获取data的函数
 */
export function mergeDataOrFn (
  parentVal: any, // data函数
  childVal: any, // data函数
  vm?: Component // Vue实例
): ?Function {
  // 通过判断是否存在Vue实例 判断是否通过 new 调用构造函数，使用Vue.extend构造组件时，data必须是函数
  if (!vm) {
    // in a Vue.extend merge, both should be functions
    // 不在在childVal,直接返会parentVal，即如果不存在childVal，直接返回parent data函数
    if (!childVal) {
      return parentVal
    }
    // 不在parentVal，直接返回child的data函数
    if (!parentVal) {
      return childVal
    }
    // when parentVal & childVal are both present,
    // we need to return a function that returns the
    // merged result of both functions... no need to
    // check if parentVal is a function here because
    // it has to be a function to pass previous merges.

    return function mergedDataFn () {
      // 
      return mergeData(
        typeof childVal === 'function' ? childVal.call(this, this) : childVal, // 如果是data是函数，则调用data函数获取data，
        typeof parentVal === 'function' ? parentVal.call(this, this) : parentVal
      )
    }
  } else {
    return function mergedInstanceDataFn () {
      // instance merge
      // 如果data是函数，则调用函数获取data
      const instanceData = typeof childVal === 'function'
        ? childVal.call(vm, vm)
        : childVal
      const defaultData = typeof parentVal === 'function'
        ? parentVal.call(vm, vm)
        : parentVal
        // 如果child options中存在data函数，合并父类的data，否则返回父类的data
      if (instanceData) {
        return mergeData(instanceData, defaultData)
      } else {
        return defaultData
      }
    }
  }
}

strats.data = function (
  parentVal: any,
  childVal: any,
  vm?: Component
): ?Function {
  // 检查childVal是否是函数，使用Vue.extend构造子组件时，data必须是函数
  if (!vm) {
    if (childVal && typeof childVal !== 'function') {
      process.env.NODE_ENV !== 'production' && warn(
        'The "data" option should be a function ' +
        'that returns a per-instance value in component ' +
        'definitions.',
        vm
      )
      return parentVal
    }
    return mergeDataOrFn(parentVal, childVal)
  }

  return mergeDataOrFn(parentVal, childVal, vm)
}

/**
 * 合并hooks(created,mounted)策略，这些hooks最终都会放在一个hook数组中
 * 从该函数中可以看出Vue 的hook函数可以使用数组
 * Hooks and props are merged as arrays.
 */
function mergeHook (
  parentVal: ?Array<Function>,
  childVal: ?Function | ?Array<Function>
): ?Array<Function> {
  //
  const res = childVal // 是否存在childVal
    ? parentVal // 是否存在parentVal
      ? parentVal.concat(childVal) // 存在则合并
      : Array.isArray(childVal) // 不存在 判断childVal是否是数组
        ? childVal
        : [childVal] // 如果不止构造数据
    : parentVal // 如果不存在直接使用parent的hooks
  return res
    ? dedupeHooks(res) // 去除重复的hooks，因为hook可能引用同一个函数
    : res
}

function dedupeHooks (hooks) {
  const res = []
  for (let i = 0; i < hooks.length; i++) {
    if (res.indexOf(hooks[i]) === -1) {
      res.push(hooks[i])
    }
  }
  return res
}
// 
LIFECYCLE_HOOKS.forEach(hook => {
  strats[hook] = mergeHook
})

/**
 * Assets
 * 合并资源例如components, directives,filters
 * When a vm is present (instance creation), we need to do
 * a three-way merge between constructor options, instance
 * options and parent options.
 */
function mergeAssets (
  parentVal: ?Object,
  childVal: ?Object,
  vm?: Component,
  key: string
): Object {
  // 如果存在parentVal,根据parentValcreate结果
  const res = Object.create(parentVal || null)
  if (childVal) {
    process.env.NODE_ENV !== 'production' && assertObjectType(key, childVal, vm)
    // 将childVal合并
    return extend(res, childVal)
  } else {
    return res
  }
}

ASSET_TYPES.forEach(function (type) {
  strats[type + 's'] = mergeAssets
})

/**
 * Watchers.
 * 合并watcher，通过这个函数，可以看出watcher 可以使用数据定义不同的监听watcher
 * Watchers hashes should not overwrite one
 * another, so we merge them as arrays.
 */
strats.watch = function (
  parentVal: ?Object,
  childVal: ?Object,
  vm?: Component,
  key: string
): ?Object {
  // work around Firefox's Object.prototype.watch...
  if (parentVal === nativeWatch) parentVal = undefined
  if (childVal === nativeWatch) childVal = undefined
  /* istanbul ignore if */
  if (!childVal) return Object.create(parentVal || null)
  if (process.env.NODE_ENV !== 'production') {
    assertObjectType(key, childVal, vm)
  }
  // 不存在直接parentVal直接返回
  if (!parentVal) return childVal
  const ret = {}
  extend(ret, parentVal)
  for (const key in childVal) {
    // 获取parent的watcher
    let parent = ret[key]
    // 获取child的watcher
    const child = childVal[key]
    // 如果存在parent,且parent不是数据，则将parent放入一个数组中
    if (parent && !Array.isArray(parent)) {
      parent = [parent]
    }
    ret[key] = parent
      ? parent.concat(child) // 如果存在parent watcher，则合并child watcher
      : Array.isArray(child) ? child : [child] // 不在在parent watcher, 则将child watcher存入数组并返回
  }
  return ret
}

/**
 * props,methods,inject的合并策略
 * Other object hashes.
 */
strats.props =
strats.methods =
strats.inject =
strats.computed = function (
  parentVal: ?Object,
  childVal: ?Object,
  vm?: Component,
  key: string
): ?Object {
  if (childVal && process.env.NODE_ENV !== 'production') {
    assertObjectType(key, childVal, vm)
  }
  // 如果不存在parentVal，直接返回childVal
  if (!parentVal) return childVal
  // 否则合并parentVal
  const ret = Object.create(null)
  extend(ret, parentVal)
  if (childVal) extend(ret, childVal) // 如果存在childVal，合并childVal
  return ret
}
strats.provide = mergeDataOrFn

/**
 * Default strategy.
 */
const defaultStrat = function (parentVal: any, childVal: any): any {
  return childVal === undefined
    ? parentVal
    : childVal
}

/**
 * Validate component names
 */
function checkComponents (options: Object) {
  for (const key in options.components) {
    validateComponentName(key)
  }
}

export function validateComponentName (name: string) {
  if (!new RegExp(`^[a-zA-Z][\\-\\.0-9_${unicodeRegExp.source}]*$`).test(name)) {
    warn(
      'Invalid component name: "' + name + '". Component names ' +
      'should conform to valid custom element name in html5 specification.'
    )
  }
  if (isBuiltInTag(name) || config.isReservedTag(name)) {
    warn(
      'Do not use built-in or reserved HTML elements as component ' +
      'id: ' + name
    )
  }
}

/**
 * 规范化props，将props规范为{xxx: {type: xxx,...}}的形式
 * Ensure all props option syntax are normalized into the
 * Object-based format.
 */
function normalizeProps (options: Object, vm: ?Component) {
  const props = options.props
  if (!props) return
  const res = {}
  let i, val, name
  if (Array.isArray(props)) {
    // 如果是数组，说明options采用的是['prop1', 'prop2']的形式定义props
    i = props.length
    while (i--) {
      val = props[i]
      if (typeof val === 'string') {
        // 将连字符转化为驼峰 即a-xx => aXx
        name = camelize(val)
        res[name] = { type: null }
      } else if (process.env.NODE_ENV !== 'production') {
        warn('props must be strings when using array syntax.')
      }
    }
  } else if (isPlainObject(props)) {
    /**
     * 如果是对象的形式如{xxx: Number, xxxx: {type: NUmber}}
     */
    for (const key in props) {
      val = props[key]
      name = camelize(key)
      res[name] = isPlainObject(val)
        ? val // {xx: {type: xxx}}的形式
        : { type: val } // {xx: String}的形式
    }
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `Invalid value for option "props": expected an Array or an Object, ` +
      `but got ${toRawType(props)}.`,
      vm
    )
  }
  options.props = res
}

/**
 * 将injection规范为{xxx: {from: xxx的形式}}
 * Normalize all injections into Object-based format
 */
function normalizeInject (options: Object, vm: ?Component) {
  const inject = options.inject
  if (!inject) return
  const normalized = options.inject = {}
  if (Array.isArray(inject)) {
    // injecc: ['xx', 'xxx']的形式
    for (let i = 0; i < inject.length; i++) {
      normalized[inject[i]] = { from: inject[i] }
    }
  } else if (isPlainObject(inject)) {
    for (const key in inject) {
      const val = inject[key]
      normalized[key] = isPlainObject(val)
        ? extend({ from: key }, val) // 如果是{xxx: {from: xxx2}}的形式
        : { from: val } // 如果是 {xxx: xxxx}的形式
    }
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `Invalid value for option "inject": expected an Array or an Object, ` +
      `but got ${toRawType(inject)}.`,
      vm
    )
  }
}

/**
 * 将directivies规范为{bind: fn1: update:fn2}的形式
 * Normalize raw function directives into object format.
 */
function normalizeDirectives (options: Object) {
  const dirs = options.directives
  if (dirs) {
    for (const key in dirs) {
      const def = dirs[key]
      if (typeof def === 'function') {
        // 如果是directives: {dir1: fn}的情况，将fn作为dir的bind和update函数
        dirs[key] = { bind: def, update: def }
      }
    }
  }
}

function assertObjectType (name: string, value: any, vm: ?Component) {
  if (!isPlainObject(value)) {
    warn(
      `Invalid value for option "${name}": expected an Object, ` +
      `but got ${toRawType(value)}.`,
      vm
    )
  }
}

/**
 * Merge two option objects into a new one.
 * Core utility used in both instantiation and inheritance.
 */
export function mergeOptions (
  parent: Object,
  child: Object,
  vm?: Component
): Object {
  if (process.env.NODE_ENV !== 'production') {
    // 检查选项components中的值是否符合规范,component的命名不能是内置标签和Vue已经定义的组件
    checkComponents(child)
  }

  if (typeof child === 'function') {
    child = child.options
  }

  // 规范化props,将props 规范为{xxx: {type: xxx,default: xxx}}的形式
  normalizeProps(child, vm)
  // 规范化injection
  normalizeInject(child, vm)
  // 规范化directions
  normalizeDirectives(child)

  // Apply extends and mixins on the child options,
  // but only if it is a raw options object that isn't
  // the result of another mergeOptions call.
  // Only merged options has the _base property.

  // 如果child options 存在extends或者mixins，现将child extends和mixins mixins选项合并到parent里面
  if (!child._base) {
    // 先合并extends到parent
    if (child.extends) {
      parent = mergeOptions(parent, child.extends, vm)
    }
    //合并mixns到parent
    if (child.mixins) {
      for (let i = 0, l = child.mixins.length; i < l; i++) {
        parent = mergeOptions(parent, child.mixins[i], vm)
      }
    }
  }

  /**
   * 接下来就是合并选项的核心部分，因为options有不同的属性，如el，data，computed等，不同属性有不同的合并策略，所以采用了策略模式合并
   */
  const options = {}
  let key
  // 现将父类中存在的选项合并
  for (key in parent) {
    mergeField(key)
  }
  // 接着合并父类中没有的选项
  for (key in child) {
    // 如果父类中没有该选项，就合并，因为父类中存在的选项，上一步已经合并了
    if (!hasOwn(parent, key)) {
      mergeField(key)
    }
  }
  // 采用不同的策略合并
  function mergeField (key) {
    const strat = strats[key] || defaultStrat
    options[key] = strat(parent[key], child[key], vm, key)
  }
  return options
}

/**
 * Resolve an asset.
 * This function is used because child instances need access
 * to assets defined in its ancestor chain.
 */
export function resolveAsset (
  options: Object,
  type: string,
  id: string,
  warnMissing?: boolean
): any {
  /* istanbul ignore if */
  if (typeof id !== 'string') {
    return
  }
  const assets = options[type]
  // check local registration variations first
  if (hasOwn(assets, id)) return assets[id]
  const camelizedId = camelize(id)
  if (hasOwn(assets, camelizedId)) return assets[camelizedId]
  const PascalCaseId = capitalize(camelizedId)
  if (hasOwn(assets, PascalCaseId)) return assets[PascalCaseId]
  // fallback to prototype chain
  const res = assets[id] || assets[camelizedId] || assets[PascalCaseId]
  if (process.env.NODE_ENV !== 'production' && warnMissing && !res) {
    warn(
      'Failed to resolve ' + type.slice(0, -1) + ': ' + id,
      options
    )
  }
  return res
}
