/**
 * 阿里网盘 上传
 * 翟享2021-10-20
 */
const fs = require('fs')
const { open, read, stat, readdir, } = fs.promises
const path = require('path')

const { AliyunDriver } = require("./aliyundriver")
const { TaskZx } = require("./task-base")
const { uploadStream, put } = require("./rp")
const { delay, selectProp } = require('./util')

const TIMEOUT = 60  // S http timeout


class MultipartUpload extends TaskZx {
  ali
  chunkSize = 2 * 1024 * 1024   // 2MB/片: 2097152
  parent_file_id = '61591bd3213cd36a6e764f21ac3db7c06b063419' // root/tmp
  rapidUpload = true  // 闪电上传
  overWrite
  timeout = TIMEOUT

  constructor(opt) {
    super(opt)
    this.opt = opt
    this._init(opt)
  }

  _init(opt) {
    const { rapidUpload, parent_file_id, chunkSize, ali,
      overWrite, timeout } = opt

    typeof rapidUpload !== undefined && (this.rapidUpload = !!rapidUpload)
    typeof overWrite !== undefined && (this.overWrite = !!overWrite)
    parent_file_id && (this.parent_file_id = parent_file_id)
    chunkSize && (this.chunkSize = chunkSize)
    ali && (this.ali = ali)
    timeout && (this.timeout = timeout)
  }

  async initAliyunDriver() {
    await super.start()
    let opt = Object.assign({}, this.getConf('refresh_token access_token,drive_id,parent_file_id'), selectProp(this.opt, 'refresh_token drive_id parent_file_id'))
    const ali = this.ali = new AliyunDriver(opt)
    opt.parent_file_id && (this.parent_file_id = opt.parent_file_id)
  }

  async start() {
    await this.initAliyunDriver()
    // 事件加载
    this.events.on('upload', msg => this.uploadFile(msg))
    this.events.on('complete', id => this.completeUpload(id))
    this.events.on('interval', () => this.checkException())
    // 加载任务
    return await this.loadTask()
    // return this.getConf()
  }

  stop() {
    // this.handles.forEach(i => i.handle.stop())  // 各子任务存盘处理 
    this.setConf('access_token,refresh_token,drive_id', this.ali)   // ,sbox_drive_id,userInfo
    return super.stop()
  }

  /**
   * 检查异常的上传任务，重新开始
   * status=3 
   */
  async checkException() {
    const list = this.checkTaskExpirse(3)
    if (list.length > 0) {
      list.forEach(i => this.events.emit('upload', i))
      console.log('checkException: ', list.length)
    } else this.quitTask()

  }

  quitTask() {
    this.stop().then(() => {
      // console.log('task complete.')
      console.timeEnd("start")
      process.exit(0)
    })
  }

  /**
   * 加载任务表中 0,1,3 任务
   * 查检 expirseAt 过期; 
   * status: 0创建, 1执行中, 2完成, 3异常, 4废弃 
   * 任务结构: [{id, expirseAt, data}]
   * @returns 任务数量 
   */
  async loadTask() {
    const list = this.checkTaskExpirse(0, 1, 3)
    list.forEach(i => this.events.emit('upload', i))  // 触发任务

    return list.length
  }

  // 上传文件
  async uploadFile({ id, data }) {
    let { name, fileName, file_id, upload_id, partNumber, part_info_list = [], status } = data
    if (status === 0) this.updateTask(id, { status: 1 })

    if (status === 3) {
      const info = await this.ali.getMuPartUploadInfo(file_id, upload_id)
      if (info && info.data && info.data.code && info.data.code === "NotFound.UploadId") {
        console.log('file :%s upload is fail', name)
        return this.updateTask(id, { status: 4 })
      }
    }
    data.part_info_list = await this.checkUrlExpirse(part_info_list.filter(i => i.part_number >= partNumber),
      file_id, upload_id, data.part_number)
    if (!data.part_info_list) return this.updateTask(id, { status: 3 })

    let part_number = ++partNumber, retry = 3
    while (part_number <= data.part_number) {
      const task = data.part_info_list.find(i => i.part_number === part_number)
      let res = await this.uploadFilePart(id, task)
      if (res.data === '') {
        // console.log('upload ok:', part_number)
        data.partNumber = part_number++
        if (retry < 3) retry++
      } else {
        console.log('%s upload err  %d : %s', name, part_number, res.data)
        if (retry < 1) break
        await delay(1000) // 等1S再试
        retry--
      }
    }
    if (part_number <= data.part_number) data.status = 3
    this.updateTask(id, data)

    if (part_number > data.part_number) this.events.emit('complete', id)
  }

  async completeUpload(id) {
    const { size, file_id, upload_id, content_hash, startTime, fileName, part_number } = this.getTask(id).data
    let res = await this.ali.complete(file_id, upload_id)
    if (res.data.code === "NotFound.UploadId" || (res.data.content_hash && res.data.content_hash !== content_hash)) {
      console.log('%s upload err: %s', fileName, res.data.code ? res.data.code : 'hash err')
      return this.updateTask(id, { status: 4 })
    }

    const endTime = +new Date()
    const time = (endTime - startTime) / 1000, speed = (size / time / 1048576).toFixed(2)
    console.log('%s upload ok: (%d)%s S, speed: %s MB/S, size: %s MB',
      fileName, part_number, time.toFixed(2), speed, (size / 1048576).toFixed(3))

    res.data.part_info_list = []
    res.data.status = 2
    res.data.endTime = endTime
    this.updateTask(id, res.data)

    const list = this.checkTaskExpirse(0, 1, 3)
    if (list.length === 0) {
      console.log('task complete.')
      this.quitTask()
    }
  }

  saveConfToFile() {
    this.setConf('access_token,refresh_token,drive_id', this.ali) // ,sbox_drive_id,userInfo
    super.saveConfToFile()
  }

  /**
   * 没过期 返回 时间戳 s
   * 过期 null
   * @param {string} url
   * @returns
   */
  getUrlExpirse(url) {
    let res = url.match(/&x-oss-expires=(\d+)/)
    if (res && res[1] * 1000 < +new Date())
      return res[1]
    return null
  }

  /**
   * 查检 url 有效期
   * 返回 时间戳 s
   * @param {string} url
   * @returns
   */
  async checkUrlExpirse(list, file_id, upload_id, part_number) {
    if (list.length === 0 || this.getUrlExpirse(list[0].upload_url)) {
      // 过期重新刷新 url
      console.log('url update for expired ...', list.length)
      let res = await this.ali.getUploadUrl(file_id, upload_id,
        list.length > 0 ? list.map(i => i.part_number) : part_number)
      return res.part_info_list
    }
    return list
  }

  /**
   * 分片 流
   * @param {number} part_number
   * @returns
   */
  getFileStreamPart(id, part_number) {
    const { size, part_number: partNumber, fileName } = this.getTask(id).data
    let end = partNumber === part_number ? size - 1 : part_number * this.chunkSize - 1
    return fs.createReadStream(fileName, {
      // fd,
      // return fileHandle.createReadStream({   // v16+
      start: (part_number - 1) * this.chunkSize,
      end,  // 包括end位置
      // emitClose: false, // true: 流将在销毁后触发 'close' 事件
      // autoClose: false,
      // highWaterMark, // <integer> 默认值: 64 * 1024 (64kB)
    })
  }

  /**
   * 上传对应分片 文件
   * @param {number} part_number
   * @param {string} upload_url
   * @returns
   */
  async uploadFilePart(id, { part_number, upload_url }) {
    const stream = this.getFileStreamPart(id, part_number)
    return uploadStream(upload_url, { stream, headers: { 'content-type': '', }, timeout: this.timeout })
  }

  async initFile(file, fileName, name, parent_file_id) {
    const { size } = await file.stat()
    if (!size) return
    if (!name) name = path.basename(fileName)

    const part_number = Math.ceil(size / this.chunkSize)
    const content_hash_name = 'sha1'
    const content_hash = await this.ali.getFileHash(fileName, content_hash_name)
    const proof_code = await this.ali.getFileProofCode(file)
    const proof_version = "v1"
    const opt = {
      name, parent_file_id, part_number, size,
      check_name_mode: this.overWrite ? 'auto_rename' : 'refuse',   // 
    }
    // 带这些参数，ali 会判断 rapid_upload(秒传)
    if (this.rapidUpload) Object.assign(opt, { content_hash, content_hash_name, proof_code, proof_version, })
    let res = await this.ali.createWithFolders(opt)
    if (!res) return null

    const { exist, type, file_id, status, } = res
    if (exist) {
      console.log('file is exist:', { type, file_id, status, parent_file_id })
      return file.close()
    }
    const { upload_id, location, file_name, part_info_list, rapid_upload } = res

    const fileInfo = {
      ...opt, file_name, fileName,
      file_id, upload_id, location,
      partNumber: 0, // 已完成的分片，0:无
      status: 0, // 0: 初始化，没有开始上传； 1: 正在上传中； 2: 完成； 3: 失败; 4: 作废
      rapid_upload,
      content_hash, content_hash_name, proof_code, proof_version,
      part_info_list,
      startTime: +new Date()
    }
    let { id, expirseAt, data } = this.createTask(fileInfo, 3600 * 24 * 7)
    if (rapid_upload) {
      console.log('rapid_upload: 秒传成功',)
      this.updateTask(id, { status: 2 })
    } else {
      this.events.emit('upload', { id, expirseAt, data })
    }
    file.close()
    // this.saveConfToFile()
  }

  /**
   * 文件上传初始化
   *  upload_url, createTask->taskList
   *  status=0
   * @param {string} fileName 源文件名
   * @param {string} name 目标文件名
   * @param {string} parent_file_id 目录id
   * @returns
   */
  async initUpload(fileName, name, parent_file_id = this.parent_file_id) {
    const file = await open(fileName)
    if (!file) return console.log('not find file: ', fileName)
    const stats = await file.stat()
    if (!name) name = path.basename(fileName)

    if (stats.isDirectory()) {
      let res = await this.ali.createWithFolders({
        name, parent_file_id, type: 'folder',
        check_name_mode: 'refuse',
      })
      const list = await readdir(fileName)
      for (const f of list) {
        await this.initUpload(fileName + '/' + f, null, res.file_id)
      }
      file.close()
    } else await this.initFile(file, fileName, name, parent_file_id)
  }

  /**
   * ls 相应状态的任务表 空显示所有任务
   * @param {[]} statusArr [1,3]
   */
  async listTask(statusArr) {
    statusArr = statusArr.map(i => +i)
    await super.start()
    const list = this.checkTaskExpirse(...statusArr)
    list.forEach(i => console.log(i.data))
    console.log('list task num: ', list.length)
    console.timeEnd("start")
    process.exit(0)
  }

  /**
   * remove 相应状态的任务 空 不删除
   * @param {[]} statusArr [1,3]
   */
  async clearTask(statusArr) {
    if (statusArr.length === 0) {
      console.log('clear task num: 0')
      console.timeEnd("start")
      return process.exit(0)
    }

    statusArr = statusArr.map(i => +i)
    await super.start()
    const list = this.checkTaskExpirse(...statusArr)
    console.log('clear task num: ', list.length)
    if (list.length > 0) {
      list.forEach(i => this.removeTask(i.id))
      await super.stop()
    }
    console.timeEnd("start")
    return process.exit(0)
  }

  /**
   * 显示云盘的目录 ls dir
   * @param {string} dir 
   */
  async lsDir(dir) {
    await this.initAliyunDriver()
    const items = await this.ali.aliPath(dir)
    items.forEach(i => {
      const { name, type, created_at, updated_at, file_id, size } = i
      console.log(`${type === 'file' ? '  ' : '>>'} ${name} ${!size ? '' : 'size: ' + (size / 1048576).toFixed(3) + 'MB'}`)
      console.log(`     ${new Date(created_at).format('yyyy-MM-dd mm:hh')} ${file_id}`)
    })

    return this.quitTask()
  }
}

module.exports = { MultipartUpload }