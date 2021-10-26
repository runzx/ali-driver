/**
 * 阿里网盘 上传
 * 翟享2021-10-20
 */
const fs = require('fs')
const { open, read, stat, readdir, } = fs.promises
const path = require('path')

const { AliyunDriver } = require("./aliyundriver")
const { TaskZx } = require("./task-base")
const { uploadStream, put, downloadToFile } = require("./rp")
const { delay, selectProp, mkdirsSync, toMegabytes } = require('./util')

const TIMEOUT = 60  // S http timeout
const MAX_TASKS = 10  // max 并发执行任务数


class MultipartUpload extends TaskZx {
  ali
  chunkSize = 2 * 1024 * 1024   // 2MB/片: 2097152
  parent_file_id = '61591bd3213cd36a6e764f21ac3db7c06b063419' // root/tmp
  rapidUpload = true  // 闪电上传
  overWrite
  timeout = TIMEOUT
  maxTasks = MAX_TASKS

  constructor(opt) {
    super(opt)
    this.opt = opt
    this._init(opt)
  }

  _init(opt) {
    const {
      rapidUpload, parent_file_id, chunkSize, ali,
      overWrite, timeout, maxTasks
    } = opt

    typeof rapidUpload !== undefined && (this.rapidUpload = !!rapidUpload)
    typeof overWrite !== undefined && (this.overWrite = !!overWrite)
    parent_file_id && (this.parent_file_id = parent_file_id)
    chunkSize && (this.chunkSize = chunkSize)
    ali && (this.ali = ali)
    timeout && (this.timeout = timeout)
    maxTasks && (this.maxTasks = maxTasks)
  }

  async initAliyunDriver() {
    await super.start()
    let opt = Object.assign({}, this.getConf('refresh_token access_token,drive_id,parent_file_id'),
      selectProp(this.opt, 'refresh_token drive_id parent_file_id'))
    const ali = this.ali = new AliyunDriver(opt)
    opt.parent_file_id && (this.parent_file_id = opt.parent_file_id)
  }

  async start() {
    await this.initAliyunDriver()
    // 事件加载
    this.events.on('upload', msg => this.uploadFile(msg))
    this.events.on('download', msg => this.downloadFile(msg))
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
   * maxTasks 限制并发执行任务数量 10
   */
  async checkException() {
    let list = this.checkTaskExpirse(1)
    console.log('  ===> run task: %d', list.length)
    if (list.length > this.maxTasks) return

    list = this.getMaxTask(0, list.length)
    if (list.length > 0) {
      list.forEach(i => {
        if (i.data.download_url) this.events.emit('download', i)
        else this.events.emit('upload', i)
      })
      console.log('  ==> add checkException: ', list.length)
    } else if (this.checkTaskExpirse(0, 1, 3).length === 0)
      this.quitTask()

  }

  getMaxTask(status = 0, len = 0) {
    let list = this.checkTaskExpirse(status)
    if (list.length < this.maxTasks - len && status === 0) {
      return list.concat(this.getMaxTask(3, len + list.length))
    }
    return list.slice(0, this.maxTasks - len)
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
   * status: 0创建/等待中, 1执行中, 2完成, 3异常, 4废弃
   * 任务结构: [{id, expirseAt, data}]
   * @returns 任务数量
   */
  async loadTask() {
    const list = this.checkTaskExpirse(0, 1, 3)
    list.slice(0, list.length > this.maxTasks ? this.maxTasks : list.length).forEach(i => {
      if (i.data.download_url) this.events.emit('download', i)
      else this.events.emit('upload', i)
    })  // 触发任务

    return list.length
  }

  // 上传文件
  async uploadFile({ id, data }) {
    let {
      name, fileName, file_id, upload_id, partNumber,
      part_info_list = [], status, retry,
      part_number,
    } = data

    if (status === 3) {
      if (retry <= 0) {
        console.log(' ** %s retry 0: ', fileName)
        this.updateTask(id, { status: 4 })
        return this.checkException()
      }
      retry--
      this.updateTask(id, { retry })
    }
    if ([2, 4].includes(status)) return
    else this.updateTask(id, { status: 1 })

    part_info_list = await this.checkUrlExpirse(part_info_list.filter(i => i.part_number >= partNumber),
      file_id, upload_id, part_number)
    if (!part_info_list) return this.updateTask(id, { status: 3 })
    this.updateTask(id, { part_info_list })
    // partNumber 准备下载的的分片号 1
    while (partNumber <= part_number) {
      const task = part_info_list.find(i => i.part_number === partNumber)
      if (!task) {
        partNumber++
        continue
      }
      let res = await this.uploadFilePart(id, task).catch(err => {
        console.log('uploadFilePart err:', err)
        console.log('uploadFilePart err:', fileName)
        return null
      })
      if (res && res.data === '') {
        console.log('%s upload --> %d', fileName, partNumber)
        partNumber++
        this.updateTask(id, { partNumber })
      } else if (res && typeof res.data === 'string') {
        if (res.data.includes('PartAlreadyExist')) {
          // && res.statusCode === 409
          console.log(' ** PartAlreadyExist: %d %s  %s %s', partNumber, fileName, file_id, upload_id)
          partNumber++
          this.updateTask(id, { partNumber })
        } else if (res.data.includes('NoSuchUpload')) {
          console.log(' ** NoSuchUpload: %s  %s %s', fileName, file_id, upload_id)
          this.updateTask(id, { status: 4 })
          return this.checkException()
        } else {
          console.log('%s upload err ----> %d \n    /s', name, partNumber, res.data)
          this.updateTask(id, { status: 3 })
          return
        }
      } else if (res && res.data
        && res.data.code
        && res.data.code === 'NotFound.UploadId') {
        console.log(' ** NotFound.UploadId: %s  %s %s', fileName, file_id, upload_id)
        this.updateTask(id, { status: 4 })
        return this.checkException()
      } else {
        console.log('%s upload err ----> %d ', name, partNumber,)
        console.log(res)
        return this.updateTask(id, { status: 3 })
      }
    }

    if (partNumber > part_number) this.events.emit('complete', id)
  }

  async completeUpload(id) {
    const { data } = this.getTask(id)
    const { size, file_id, upload_id, content_hash, startTime, fileName, part_number, status } = data
    if (status !== 1) {
      console.log('  --> completeUpload ???:', data)
      return
    }
    let res = await this.ali.complete(file_id, upload_id)
    if (res.data.code === "NotFound.UploadId" || (res.data.content_hash && res.data.content_hash !== content_hash)) {
      console.log('%s upload err: %s', fileName, res.data.code ? res.data.code : 'hash err')
      res.data.status = 4
      this.updateTask(id, res.data)
    } else {
      const endTime = +new Date()
      const time = (endTime - startTime) / 1000, speed = (size / time / 1048576).toFixed(2)
      console.log('%s upload ok: (%d)%s S, speed: %s MB/S, size: %s MB',
        fileName, part_number, time.toFixed(2), speed, (size / 1048576).toFixed(3))

      res.data.part_info_list = []
      res.data.status = 2
      res.data.endTime = endTime
      this.updateTask(id, res.data)
    }

    this.checkException()
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

  /**
   * 初始化上传文件任务
   * @param {FileHandle} file
   * @param {string} fileName
   * @param {string} name
   * @param {string} parent_file_id
   * @returns
   */
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
    file.close()
    // 带这些参数，ali 会判断 rapid_upload(秒传)
    if (this.rapidUpload) Object.assign(opt, { content_hash, content_hash_name, proof_code, proof_version, })
    let res = await this.ali.createWithFolders(opt)
    if (!res) return null

    const { exist, type, file_id, status, } = res
    if (exist) {
      console.log('%s name is exist', fileName)
      return
    }
    const { upload_id, location, file_name, part_info_list, rapid_upload } = res

    const fileInfo = {
      ...opt, file_name, fileName,
      file_id, upload_id, location,
      partNumber: 0, // 已完成的分片，0:无
      status: 0, // 0: 初始化，没有开始上传； 1: 正在上传中； 2: 完成； 3: 失败; 4: 作废
      retry: 3,
      rapid_upload,
      content_hash, content_hash_name, proof_code, proof_version,
      part_info_list,
      startTime: +new Date()
    }

    if (rapid_upload) {
      console.log('%s : 秒传成功', fileName)
      fileInfo.status = 2
    }
    this.createTask(fileInfo, 3600 * 24 * 7)

    this.checkException()
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
        this.initUpload(fileName + '/' + f, null, res.file_id)
      }
      file.close()
    } else this.initFile(file, fileName, name, parent_file_id)
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
    if (Array.isArray(items)) items.forEach(i => {
      const { name, type, created_at, updated_at, file_id, size } = i
      console.log(
        `${type === 'file' ? '  ' : '>>'} ${name} ${!size ? '' : 'size: ' + (size / 1048576).toFixed(3) + 'MB'}`)
      console.log(`     ${new Date(created_at).format('yyyy-MM-dd mm:hh')} ${file_id}`)
    })
    else console.log('%s not find', items)
    return this.quitTask()
  }

  /**
   * 断点续存， 流文件
   * @param {string} fileName 可带路径
   * @returns
   */
  async downloadFile({ id, data }) {
    let {
      name, fileName, file_id, type, size, content_hash, content_hash_name,
      download_url, dir, tempSize, status,
    } = data
    if ([2, 4].includes(status)) return
    else this.updateTask(id, { status: 1 })
    // const fileName = path.resolve(dir, name)
    // fileName 带下载目录路径的文件名
    const f = await stat(fileName).catch(err => null)
    if (!f) {
      mkdirsSync(path.dirname(fileName))
    }
    if (f && f.size !== tempSize) {
      console.log('download err: ', fileName)
      tempSize = f.size
    }
    // const tempSize = f && f.size ? f.size : 0
    if (tempSize < size) {
      let res = await downloadToFile(download_url, {
        fileName, flags: 'a', // 追加，续存； hash不用
        headers: {
          Referer: 'https://www.aliyundrive.com/',
          'content-type': '', 'Range': `bytes=${tempSize}-`
        }
      })
    }
    const fileHash = await this.ali.getFileHash(fileName, content_hash_name)
    if (content_hash === fileHash) {
      this.updateTask(id, { status: 2 })
      console.log('%s download ok, size: %s', name, toMegabytes(size))
    } else {
      console.log('%s download err')
      this.updateTask(id, { status: 3 })
    }

    this.checkException()
  }

  /**
   * 下载文件 生成任务
   *
   * @param {string} fileName
   */
  async initDownload(sfileName, dir = this.opt.out || '', deep = 10) {
    const files = await this.ali.aliPath(sfileName)
    if (typeof files === 'string') return console.log('"%s" not find: %s', sfileName, files)

    for (const file of files) {
      const { name, type, file_id, size, content_hash, content_hash_name, download_url } = file
      const fileName = path.resolve(dir, name)
      const f = await stat(fileName).catch(err => null)
      const tempSize = f && f.size ? f.size : 0
      const fileInfo = {
        name, type, file_id, size, content_hash, content_hash_name, download_url,
        status: 0, // 0: 初始化，没有开始下载； 1: 正在下载中； 2: 完成； 3: 失败; 4: 作废
        dir, tempSize, fileName
      }
      if (type === 'file') {
        let { id, expirseAt, data } = this.createTask(fileInfo, 3600 * 24 * 7)
        // this.events.emit('download', { id, expirseAt, data })
        this.checkException()
      } else if (deep > 0) {
        await this.initDownload(sfileName + '/' + name, dir + '/' + name, deep - 1)
      }
    }
  }
}

module.exports = { MultipartUpload }