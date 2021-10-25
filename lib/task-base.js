/**
 * 任务管理器
 * 自动 加载/保存(start/stop) 配置信息、任务信息(taskList)
 * 翟享2021-10-17
 */
const EventEmitter = require('events')
const { initZDb, deleteFile } = require('./z-db')


class Deferred {
  id
  promise
  resolve
  reject

  constructor(id) {
    this.id = id
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

class TaskZx {
  db = {}
  name // 任务名称
  handles = []
  deferreds = {}
  taskList = new Map()  // 任务列表
  events = new EventEmitter()
  intervalTime = null // 定时检查
  intervalId = null  // 定时id

  constructor(opt) {
    this._initTaskZx(opt)
  }

  _initTaskZx(opt = {}) {
    const {
      name = this.constructor.name, events, handles,
      deferreds, fileName, intervalTime
    } = opt
    name && (this.name = name)
    handles && (this.handles = handles)
    deferreds && (this.deferreds = deferreds)
    intervalTime && (this.intervalTime = intervalTime)
    this.db[this.name] = initZDb(this.name, 'json', fileName)
    if (this.intervalTime)
      this.intervalId = setInterval(() => {
        // console.log('%s still running: %d', sKey,)
        this.events.emit('interval')
      }, this.intervalTime * 1000)
  }

  initDb(name, fileName) {
    if (!this.db[name]) {
      this.db[name] = initZDb(name, 'json', fileName)
    }
    return this.db[name].start()
  }

  // 生成唯一 id, 任务列表 标识； (以时间戳为起始)
  id() {
    let key = +new Date()
    while (this.taskList.has(key)) key++
    return key
  }

  /**
   * 把默认的db(配置)取出，加载
   */
  async start() {
    const db = await this.db[this.name].start()
    const taskList = db.get('taskList')
    if (taskList && taskList.length > 0)
      taskList.forEach(i => this.saveTask(i))
    return db
  }

  /**
   * 把默认的db存盘，(taksList 表保存)
   */
  async stop() {
    const db = this.db[this.name]
    const res = this.checkTaskExpirse()
    db.set('taskList', res)
    return db.stop()
  }

  /**
   * 取配置属性，
   * 无key 返回全部配置对象
   * @param {string} key 'xx.yy', 'xx, yy, zz'
   * @returns
   */
  getConf(key) {
    if (key) return this.db[this.name].gets(key)
    return this.db[this.name]
  }

  setConf(key, val) {
    return this.db[this.name].sets(key, val)
  }

  saveConfToFile() {
    const res = this.checkTaskExpirse()
    this.db[this.name].set('taskList', res)
    return this.db[this.name].write()
  }

  /**
   * 删除 默认的保存数据 文件
   */
  deleteDefaultFile() {
    deleteFile(this.name)
  }

  /**
   * 创建任务
   * @param {object} data
   * @param {number} ttl s
   * @param {number} expirseAt s
   * @returns {object} { id, expirseAt, data }
   */
  createTask(data, ttl = 7200, expirseAt) {
    if (!expirseAt) expirseAt = +new Date() + ttl * 1000
    const id = this.id()
    this.taskList.set(id, { id, expirseAt, data })
    return { id, expirseAt, data }
  }

  /**
   * 如不传id, 则返回可迭代 Map (是 iterable)
   * @param {string} taskId
   * @returns
   */
  getTask(taskId) {
    if (taskId) {
      let res = this.taskList.get(taskId)
      if (res && res.expirseAt && res.expirseAt > +new Date()) return res
      this.removeTask(taskId)
      return null
    }
    return this.taskList
  }
  /**
   * 保存 元素值
   * @param {object} param  { id, expirseAt, data }
   * @returns {Map} 
   */
  saveTask({ id, expirseAt, data }) {
    if (expirseAt > +new Date())
      return this.taskList.set(id, { id, expirseAt, data })
    this.removeTask(id)
    return this.taskList
  }

  /**
   * 修改为对象时，合并原来的值 $Set
   * @param {string} taskId
   * @param {object} data
   * @returns 修改后的值
   */
  updateTask(taskId, data) {
    let { id, expirseAt, data: d } = this.getTask(taskId) || {}
    if (!id) return null
    return this.saveTask({ id, expirseAt, data: { ...d, ...data } }).get(id)
  }
  /**
   * 删除元素
   * @param {string} taskId 
   * @returns {boolean}
   */
  removeTask(taskId) {
    return this.taskList.delete(taskId)
  }

  /**
   * 查检taskList 的各任务有新期，过期删除
   * 返回 新的 任务数组　1,2
   * status 为空返回all list
   */
  checkTaskExpirse(...status) {
    const res = []
    this.taskList.forEach((value, key) => {
      const { id, expirseAt, data } = value
      if (expirseAt < +new Date()) this.removeTask(key)
      else if (status.length > 0) {
        status.includes(data.status) && res.push({ id, expirseAt, data })
      } else res.push({ id, expirseAt, data })
    })
    return res
  }

  findHanele(id) {
    return this.handles.find(i => i.id === id)
  }

  addHanele(id, handle) {
    if (this.findHanele(id)) return
    return this.handles.push({ id, handle })
  }
}

module.exports = exports = { TaskZx }