/**
 * 阿里网盘 上传
 * 翟享2021-10-20
 */
const fs = require('fs')
const { open, read, stat, readdir } = fs.promises
const path = require('path')

const { AliyunDriver } = require("./aliyundriver")
const { TaskZx } = require("./task-base")
const { uploadStream, put } = require("./rp")
const { sleep, delay } = require('./util')


class MultipartUpload extends TaskZx {
  ali
  chunkSize = 2 * 1024 * 1024// 2MB/片: 2097152
  parent_file_id = '61591bd3213cd36a6e764f21ac3db7c06b063419' // /tmp
  rapidUpload = true
  overWrite

  constructor(opt) {
    super(opt)
    this.opt = opt
    this._init(opt)
  }

  _init(opt) {
    const { rapidUpload, parent_file_id, chunkSize, ali, overWrite } = opt
    typeof rapidUpload !== undefined && (this.rapidUpload = !!rapidUpload)
    typeof overWrite !== undefined && (this.overWrite = !!overWrite)
    parent_file_id && (this.parent_file_id = parent_file_id)
    chunkSize && (this.chunkSize = chunkSize)
    ali && (this.ali = ali)

  }

  async start() {
    await super.start()
    let opt = Object.assign({}, this.getConf('refresh_token access_token,drive_id,userInfo,parent_file_id'), this.opt)
    const ali = this.ali = new AliyunDriver(opt)
    opt.parent_file_id && (this.parent_file_id = opt.parent_file_id)
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
    this.setConf('access_token,refresh_token,drive_id,sbox_drive_id,userInfo', this.ali)
    return super.stop()
  }

  async checkException() {
    const list = this.checkTaskExpirse(2)
    console.log('checkException: ', list.length)
    list.filter(k => k.data.status === 3)
      .forEach(i => this.events.emit('upload', i))
  }

  async loadTask() {
    // 查检 过期 status 2 完成
    const list = this.checkTaskExpirse(2) // [{id, data}]

    // 触发任务
    list.filter(k => k.data.status < 4)
      .forEach(i => this.events.emit('upload', i))

    return list.filter(k => k.data.status < 4).length
  }

  // 上传文件
  async uploadFile({ id, data }) {
    let { name, fileName, file_id, upload_id, partNumber, part_info_list = [], status } = data
    if (status === 3) {
      const info = await this.ali.getMuPartUploadInfo(file_id, upload_id)
      if (info && info.data && info.data.code && info.data.code === "NotFound.UploadId") {
        console.log('file :%s upload is fail', name)
        this.updateTask(id, { status: 4 })
        // this.saveConfToFile()
        return
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
    if (retry === 0 && part_number < data.part_number) {
      data.status = 3
      this.updateTask(id, data)
      // return this.saveConfToFile()
    }
    this.updateTask(id, data)
    if (part_number >= data.part_number && retry > 0) this.events.emit('complete', id)
  }

  async completeUpload(id) {
    const { size, file_id, upload_id, content_hash, startTime, fileName, part_number } = this.getTask(id).data
    let res = await this.ali.complete(file_id, upload_id)
    if (res.data.code === "NotFound.UploadId") {
      this.updateTask(id, { status: 4 })
      // this.saveConfToFile()
      return
    }
    let status = 2, endTime = +new Date()
    // console.log('res.data:', res.data)
    if (res.data.content_hash === content_hash) {
      const time = (endTime - startTime) / 1000, speed = (size / time / 1048576).toFixed(2)
      console.log('%s upload ok: (%d)%s S, speed: %s MB/S, size: %s MB', fileName, part_number, time.toFixed(2), speed,
        (size / 1048576).toFixed(3))
      res.data.part_info_list = []
      this.updateTask(id, res.data)
    } else status = 3
    this.updateTask(id, { status, endTime })
    // this.saveConfToFile()
    const list = this.checkTaskExpirse(2) // [{id, data}]
    if (list.filter(k => k.data.status < 4).length === 0) return this.stop().then(() => {
      console.log('task complete.')
      console.timeEnd("start")
      process.exit(0)
    })
    return res.data
  }

  saveConfToFile() {
    this.setConf('access_token,refresh_token,drive_id,sbox_drive_id,userInfo', this.ali)
    super.saveConfToFile()
  }

  /**
   * 返回 时间戳 s
   * @param {string} url
   * @returns
   */
  getUrlExpirse(url) {
    let res = url.match(/&x-oss-expires=(\d+)/)
    if (res) return res[1]
    return null
  }

  /**
   * 查检 url 有效期
   * 返回 时间戳 s
   * @param {string} url
   * @returns
   */
  async checkUrlExpirse(list, file_id, upload_id, part_number) {
    if (list.length === 0 || this.getUrlExpirse(list[0].upload_url) * 1000 < +new Date()) {
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
    return uploadStream(upload_url, { stream, headers: { 'content-type': '', } })
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
      return
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
}

module.exports = { MultipartUpload }