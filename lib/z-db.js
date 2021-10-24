/*
 * @Author: xiang.zhai 
 * @Date: 2021-10-09 00:52:13 
 * @Last Modified by: zx.B450
 * @Last Modified time: 2021-10-21 02:25:12
 * 本地简单小量数据 存储
 * JSON格式,也支持ymal,json5(要先yarn add yaml json5)
 *  json5 可以 单引号，加注释，属性key可以不使用引号包含，尾部有多余逗号，16进制表示
 *  yaml  : 表达 键值对，- 表达 数组元素
 * nodejs v10+
 * TODO 异常要退出时统一 write()
 */
const fs = require('fs')
const path = require('path')
const { readFile, writeFile, } = fs.promises


const DB_DIR = './DB/'
fs.existsSync(DB_DIR) || fs.mkdirSync(DB_DIR, { recursive: true })
let adapter = {}   // 对应接口
const dbs = {}       // 以文件为元素 

/**
 * 函数防抖
 * 默认 300 ms
 * n秒后延迟执行
 */
const debounce = (fn, delay = 300, timeID = null) => {
  return function (...args) {
    timeID && clearTimeout(timeID)
    // 定时里直接用 this, 必须用 箭头函数
    timeID = setTimeout(() => {
      fn.call(this, ...args)
      timeID = null
    }, delay)
  }
}

class ZDb {
  data      // 数据体
  name      // 数据库名 name
  fileName  // ./DB/name.json 文件名(带路径)
  type      // json, yaml
  new = false // 不自动保存
  delayTime = 3 * 1000  // 间隔时间
  constructor(name, type = 'json', fileName, delay) {
    this.name = name
    this.type = type
    this.fileName = fileName
    this.write = debounce(this._write, delay || 1000)  // 函数防抖
  }

  static async init(name, type = 'json', fileName) {
    let file = fileName ? fileName : path.join(DB_DIR, name)
    let res = fs.existsSync(path.dirname(file))
    if (!res) fs.mkdirSync(res, { recursive: true })
    fileName || (fileName = file + '.' + type, type)
    const db = new ZDb(name, type, fileName)
    if (type !== 'json') db.initAdapter(type)
    await db.read()
    console.log('ZDb: ❤️')
    return db
  }

  /**
   * 可设定 修改后延时自动保存
   * 默认 3s
   * @param {boolean} val
   * @param {number} time ms
   * @returns
   */
  setAutoSave(val = true, time) {
    time && (this.delayTime = time)
    this.new = val
    return this
  }

  autoSave(time = this.delayTime) {
    this.new = false
    setTimeout(() => {
      this.write().then(() => {
        this.new = true
      })
    }, time)
  }

  start() {
    return this.read()
  }

  stop() {
    return this._write().then(() => {
      dbs[this.fileName] = null
    })
  }

  async read() {
    if (!fs.existsSync(this.fileName)) return this
    const data = await readFile(this.fileName, 'utf-8')
    if (!data) return this
    if (this.type !== 'json') this.data = adapter[this.type].parse(data)
    else this.data = JSON.parse(data)
    return this
  }

  async _write() {
    let txt = this.type !== 'json' ? adapter[this.type].stringify(this.data, null, 2)
      : JSON.stringify(this.data, null, 2)
    if (this.data) await writeFile(this.fileName, txt)
    return this
  }

  /**
   * 赋值，key 'product.category.sub'
   * '.'分隔
   * @param {string} key
   * @param {*} val
   * @returns
   */
  set(key, val) {
    if (!this.data) this.data = {}
    if (!key.includes('.')) this.data[key] = val
    else {
      const prop = key.split('.')
      let res = this.data
      const lastKey = prop.pop()
      for (const i of prop) {
        if (!res[i]) res[i] = {}
        res = res[i]
      }
      res[lastKey] = val
    }
    this.new && this.autoSave()
    return this
  }

  /**
   * 同时 obj里多个属性 赋值，空格，','分隔
   * @param {string} keys
   * @param {object} obj
   * @returns
   */
  sets(keys, obj) {
    let arr = keys.split(/\s+|,/)
    if (!arr || arr.length === 0) return null
    if (arr.length === 1) return this.set(arr[0], obj)
    const res = {}
    arr.forEach(i => {
      if (obj[i] !== undefined) this.set(i, obj[i])
    })
    return this
  }

  /**
   * 查找 相应 属性
   * 可多级 'person.name'
   * @param {string} key
   * @returns
   */
  get(key) {
    if (!this.data) return null
    if (!key.includes('.')) return this.data[key]
    const prop = key.split('.')
    let res = this.data
    for (const i of prop) {
      res = res[i]
      if (!res) return res
    }
    return res
  }

  /**
   * 同时取多个属性 ，空格，','分隔
   * @param {string} keys
   * @returns
   */
  gets(keys) {
    let arr = keys.split(/\s+|,/)
    if (!arr || arr.length === 0) return null
    const res = {}
    arr.forEach(i => {
      res[i] = this.get(i)
    })
    return res
  }

  /**
   * 删除 属性
   * 可多级 'person.name'
   * @param {string} key
   * @returns
   */
  del(key) {
    if (!this.data) return this
    if (!key.includes('.')) delete this.data[key]
    else {
      const prop = key.split('.')
      let res = this.data
      const lastKey = prop.pop()
      for (const i of prop) {
        if (!res[i]) return this
        res = res[i]
      }
      delete res[lastKey]
    }
    this.new && this.autoSave()
    return this
  }

  /**
   * 把key 作为数组，val当元素插入
   * 原如不是数组，则作为数组第一个元素
   * @param {string} key
   * @param {*} val
   * @returns this
   */
  insert(key, val) {
    let res = this.get(key)
    if (Array.isArray(res)) {
      res.push(val)
      return this
    }
    if (res === null || res === undefined) res = [val]
    else res = [res, val]
    this.set(key, res)
    this.new && this.autoSave()
    return this
  }

  /**
   * key->val为数组时查找相应元素，只 查找 第1个符合条件的
   *  update 不空时 $set 修改对应属性值
   * @param {string} key
   * @param {object} query
   * @param {*} update
   * @returns val
   */
  find(key, query, update) {
    let res = this.get(key)
    if (!Array.isArray(res)) return null
    let id = null
    let k = res.find((i, idx) => {
      for (const [p, v] of Object.entries(query)) {
        if (!i || i[p] !== v) return false
      }
      id = idx
      return true
    })
    if (update !== undefined && id !== null) {
      if (typeof res[id] === 'object' && typeof update === 'object')
        Object.assign(res[id], update)
      else res[id] = update
      this.new && this.autoSave()
    }
    return k
  }

  /**
   * 删除 key数组的相应元素
   * @param {string} key
   * @param {object} query
   * @returns this
   */
  remove(key, query) {
    let res = this.get(key)
    if (!Array.isArray(res) || !query) return this
    let id = null
    let k = res.find((i, idx) => {
      for (const [p, v] of Object.entries(query)) {
        if (!i || i[p] !== v) return false
      }
      id = idx
      return true
    })
    if (id !== null) res.splice(id, 1)
    this.new && this.autoSave()
    return this
  }

  initAdapter(type = 'yaml') {
    if (type === 'yaml') adapter[type] = require('yaml')
    else if (type === 'json5') adapter[type] = require('json5')
  }
}

module.exports = exports = ZDb

exports.initZDb = (name, type = 'json', fileName, delay) => {
  let file = fileName ? fileName : path.join(DB_DIR, name)
  fileName || (fileName = file + '.' + type, type)
  if (dbs[fileName]) return dbs[fileName]

  let res = fs.existsSync(path.dirname(file))
  if (!res) fs.mkdirSync(res, { recursive: true })

  const db = new ZDb(name, type, fileName, delay)
  if (type !== 'json') db.initAdapter(type)
  // await db.read()
  dbs[fileName] = db
  console.log('ZDb: ❤️ ' + fileName)
  return db
}

exports.closeZDb = (name, type = 'json', fileName) => {
  let file = fileName ? fileName : path.join(DB_DIR, name)
  fileName || (fileName = file + '.' + type, type)
  if (dbs[fileName]) dbs[fileName].stop()
}

exports.deleteFile = (name, type = 'json', fileName) => {
  let file = fileName ? fileName : path.join(DB_DIR, name)
  fileName || (fileName = file + '.' + type, type)
  let res = fs.existsSync(fileName)
  if (res) fs.rm(fileName)
}