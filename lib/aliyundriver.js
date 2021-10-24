// const { post, rp } = require("./rp-json")
const { post, rp } = require("./rp")
const { md5 } = require("./util")
const fs = require('fs')
const { open, read, stat, } = fs.promises
const crypto = require('crypto')

const baseUrl = 'https://api.aliyundrive.com'

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

/**
 * 计算文件内容的 hash 值
 * @param {string|FileHandle} file (FileHandle nodejs v16.11+)
 * @param {string} type
 * @param {string} outCoding
 * @returns {string}
 */
const fileHash = async (file, type = 'sha1', outCoding = 'hex') => {
  // if (typeof file === 'string') file = await open(file, 'r')
  // const stream = file.createReadStream()                     // nodejs v16.11+
  const stream = fs.createReadStream(file)
  const c = crypto.createHash(type)
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => c.update(chunk))
    stream.on('close', () => resolve(c.digest(outCoding).toUpperCase()))
    stream.on('error', err => reject(err))
  })
}

class AliyunDriver {
  drive_id = "54017262"
  sbox_drive_id = '64017262'
  userInfo = {
    user_id: '4c9a1737c6534496a00d7675d6ecabf3',
    user_name: '',
    avatar: '',
    user_data: null
  }
  refresh_token
  access_token
  headers = { 'content-type': 'application/json;charset=UTF-8', }
  retry = 3
  handles = []
  deferreds = {}
  loading = false

  constructor(opt) {
    // this.opt = opt
    Object.assign(this, opt)
    if (opt.access_token)
      this.headers.authorization = `Bearer ${opt.access_token}`
  }

  async getFileHash(file, type = 'sha1') {
    return fileHash(file, type)
  }

  /**
   * 计算 文件 proof_code
   * @param {string} fileName
   * @returns
   */
  async getFileProofCode(file) {
    if (typeof file === 'string') file = await open(file, 'r')
    const { size } = await file.stat()
    const md5str = md5(this.access_token)
    // 16位的md5str是8字节的 16进制数，Number类型已不精确
    const start = Number(BigInt('0x' + md5str.substr(0, 16)) % BigInt(size))
    const end = Math.min(start + 8, size)
    const buf = Buffer.alloc(end - start)
    await file.read(buf, 0, end - start, start)
    return buf.toString('base64')
  }

  /**
   * 查询 保险箱 信息
   * @returns {{category, url, parent_file_id}}
   */
  async getSboxInfo() {
    const url = '/v2/sbox/get'
    let res = await this.post(url, { file_id, name, check_name_mode },)
    return res
  }

  /**
   * 更改 文件 名称
   * @param {string} file_id
   * @param {string} name
   * @param {string} check_name_mode
   * @returns {{category, url, parent_file_id}}
   */
  async renameFile(file_id, name, check_name_mode = "refuse") {
    const url = '/v3/file/update'
    let res = await this.post(url, { file_id, name, check_name_mode },)
    return res
  }

  /**
   * 收藏 状态
   * @param {string} file_id
   * @param {boolean} starred
   * @returns
   */
  async starredFile(file_id, starred = true) {
    const url = '/v2/file/update'
    let res = await this.post(url, { file_id, custom_index_key: "starred_yes", starred },)
    return res
  }

  /**
   * 移动 垃圾筒
   * @param {string} file_id
   * @returns ''
   * statusCode=204
   */
  async trashFile(file_id) {
    const url = '/v2/recyclebin/trash'
    let res = await this.post(url, { file_id, },)
    return res = ''
  }

  /**
   * 删除 文件->移动到垃圾筒(批量)
   * @param {[string]} fileIds
   * @returns {[{id, status}]} status:204
   */
  async removeFile(fileIds) {
    if (!fileIds || fileIds.length === 0 || !to_parent_file_id) return null
    const url = '/v2/batch'
    const data = {
      "requests": fileIds.map(file_id =>
        ({
          "body": { "drive_id": this.drive_id, file_id },
          "headers": { "Content-Type": "application/json" },
          "id": file_id,
          "method": "POST",
          "url": "/recyclebin/trash"
        })),
      "resource": "file"
    }
    let res = await this.post(url, data,)
    return res.responses
  }

  /**
   * 移动 文件 (批量)
   * @param {[string]} fileIds [file_id]
   * @param {string} to_parent_file_id 目的目录
   * @returns {[{body, id, status}]} status:200
   */
  async moveFile(fileIds, to_parent_file_id) {
    if (!fileIds || fileIds.length === 0 || !to_parent_file_id) return null
    const url = '/v3/batch'
    const data = {
      "requests": fileIds.map(file_id =>
        ({
          "body": {
            "drive_id": this.drive_id, file_id,
            "to_drive_id": this.drive_id, to_parent_file_id
          },
          "headers": { "Content-Type": "application/json" },
          "id": file_id,
          "method": "POST",
          "url": "/file/move"
        })),
      "resource": "file"
    }
    let res = await this.post(url, data,)
    return res.responses
  }

  /**
   * 查询 分片上传 状态
   * @param {string} file_id
   * @param {string} upload_id
   * @param {number} part_number_marker
   * @returns
   */
  async getMuPartUploadInfo(file_id, upload_id, part_number_marker = 0) {
    const url = '/v2/file/list_uploaded_parts'
    let res = await this.post(url, { file_id, upload_id, part_number_marker },)
    // next_part_number_marker 要再次调用 
    return res
  }

  /**
   * 上传后要以这来结束 进程
   * @param {string} file_id
   * @param {string} upload_id
   * @returns
   */
  async complete(file_id, upload_id) {
    const url = '/v2/file/complete'
    let res = await this.post(url, { file_id, upload_id },)
    return res
  }

  /**
   * 取 上传 url
   * url 默认有效期 1h
   * upload_id 完成上传后就作废了。NotFound.UploadId
   * @param {string} file_id
   * @param {string} upload_id
   * @param {number|[number]} list num 返回 1-num 的url; 数组 则返回里相应的part_number->url
   * @param {object} part_info_list
   * @returns
   */
  async getUploadUrl(file_id, upload_id, list = [1], part_info_list = []) {
    const url = '/v2/file/get_upload_url'
    if (part_info_list.length === 0) {
      if (Array.isArray(list)) part_info_list = list.map(i => ({ part_number: i }))
      else for (let index = 1; index <= +list; index++) part_info_list.push({ part_number: index })
    }
    let res = await this.post(url, { file_id, part_info_list, upload_id },)
    return res.data
  }

  /**
   * 查询 目录 中 可有相同文件
   * @param {string} parent_file_id
   * @param {string} name
   * @param {number} limit
   * @param {string} order_by
   * @returns
   */
  async searchFile(parent_file_id, name, limit = 100, order_by = "name ASC") {
    const url = '/adrive/v3/file/search'
    let query = `parent_file_id = "${parent_file_id}" and (name = "${name}")`
    // 'name match "12" and category = "image"'
    let res = await this.post(url, { query, limit, order_by },)
    return res
  }

  /**
   * 创建 文件
   *  目录 type:'folder'
   * @param {object} data
   * 默认 part_info_list:[]
   * @returns
   * 'auto_rename'
   * rapid_upload=true 快速上传ok(系统已有别人上传过，秒传？)
   */
  async createWithFolders({ parent_file_id, name, type = 'file', check_name_mode = 'refuse', part_number = 1, ...data }) {
    const url = '/adrive/v2/file/createWithFolders'
    let part_info_list = []
    for (let i = 1; i <= part_number; i++) part_info_list.push({ part_number: i })
    let res = await this.post(url, { parent_file_id, name, type, check_name_mode, part_info_list, ...data, })
    return res.data
  }

  /**
   * 取下载url, 只有此链可以断点续传
   * @param {string} file_id
   * @param {object} param1
   * @returns
   * 断点 续传成功 206
   */
  async getDownloadUrl(file_id, { expire_sec = 14400, ...data } = {}) {
    const url = '/v2/file/get_download_url'
    let res = await this.post(url, { expire_sec, ...data, file_id },)
    return res
  }

  /**
   * 取文件 信息
   * @param {string} file_id
   * @param {object} data 否
   * @returns {{type: "folder", name: "tmp", parent_file_id: "root",}}
   * 返回的url可以下载, download_url 多了response-content-disposition文件名参数
   * headers:{Referer: 'https://www.aliyundrive.com/'} 必须！ 防盗链
   */
  async getFileInfo(file_id, { url_expire_sec = 14400, ...data } = {}) {
    const url = '/v2/file/get'
    let res = await this.post(url, { url_expire_sec, ...data, file_id },)
    return res
  }

  /**
   * 取 文件列表
   * @param {string} parent_file_id 父目录 'root'
   * @param {object} param
   * @returns
   * url expires 900s max 3600*4
   */
  async getFileList(parent_file_id = 'root', { url_expire_sec = 3600 * 4, ...data } = {}) {
    const url = '/adrive/v3/file/list'
    // const data = { "drive_id": "54017262", "parent_file_id": "root", "limit": 100, "all": false, "url_expire_sec": 1600, "image_thumbnail_process": "image/resize,w_400/format,jpeg", "image_url_process": "image/resize,w_1920/format,jpeg", "video_thumbnail_process": "video/snapshot,t_0,f_jpg,ar_auto,w_300", "fields": "*", "order_by": "updated_at", "order_direction": "DESC" }
    let res = await this.post(url, { ...data, url_expire_sec, parent_file_id },)
    return res
  }

  async getUserInfo() {
    const url = '/v2/user/get'
    let res = await this.post(url)
    return res
  }

  async refreshToken() {
    const url = 'https://api.aliyundrive.com/token/refresh'
    const data = {
      refresh_token: this.refresh_token,
      // Grant_Type: 'refresh_token'
    }
    let res = await post(url, data, { headers: { 'content-type': 'application/json;charset=UTF-8', } })
    if (!res || !res.data || !res.data.access_token) {
      console.log(res.data)
      throw new Error('refresh token err!')
    }
    const {
      default_drive_id: drive_id, default_sbox_drive_id: sbox_drive_id,
      access_token, refresh_token, token_type,
      user_id, user_data, user_name, avatar,
    } = res.data
    Object.assign(this,
      {
        access_token, refresh_token, drive_id, sbox_drive_id, token_type,
        userInfo: { user_id, user_data, user_name, avatar }
      })
    this.headers.authorization = `${token_type} ${access_token}`
    return access_token
  }

  get(url, data, opt) {
    return this.http({ url, data, ...opt, method: 'GET' })
  }

  post(url, data, opt) {
    return this.http({ url, data, ...opt, method: 'POST' })
  }

  put(url, data, opt) {
    return this.http({ url, data, ...opt, method: 'PUT' })
  }

  async http(options) {
    const { url, headers = {}, data, ...opt } = options
    data && (data.drive_id = this.drive_id)

    const res = await rp(baseUrl + url, { headers: { ...this.headers, ...headers }, data, ...opt })

    if (res && res.data && res.data.code) {
      console.log('aliyun driver code: ', res.data.code)
      if (res.data.code === 'AccessTokenInvalid') {
        return await this.authRetry(options)
      }

      console.log('aliyun driver message: ', res.data.message)
    }
    return res
  }

  authRetry(options) {
    const { promise, resolve, reject } = new Deferred()
    this.handles.push({ promise, resolve, reject, options })  // 先缓存 网络请求
    if (this.loading === false && this.retry > 0) {
      this.loading = true
      this.refreshToken()
        .then(() => {
          while (this.handles.length > 0) {
            const { resolve, reject, options } = this.handles.shift()
            this.http(options)
              .then(res => resolve(res))
              .catch(err => reject(err))
          }
          this.loading = false
          if (this.retry < 3) this.retry++
        })
        .catch(err => {
          console.log('authRetry err:', e)
          this.retry--
          if (this.retry === 0) {
            while (this.handles.length > 0) {
              const { reject } = this.handles.shift()
              reject && reject('refresh token出错,请与系统管理员联系!')
            }
            this.handles = null
          }
          this.loading = false
        })
    }

    return promise
  }
}

module.exports = { AliyunDriver }