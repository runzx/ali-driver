/*
 * @Author: zhaixiang 
 * @Date: 2019-11-04 12:52:13 
 * @Last Modified by: zx.B450
 * @Last Modified time: 2021-10-21 14:24:32
 * 翟享 20180206
 * 
 * rp(url, opt)
 *  opt = { method: 'GET', data, stream: false, timeout: 30 } 
 *  return: {data, statusCode, headers} | stream (opt.stream=true)
 *           data: buffer|string
 * 
 * get(url, opt) 
 * post(url, data, opt)
 * put(url, data, opt) 
 * _delete(url, opt) 
 * head(url, opt)
 *  
 *  opt = {isBuffer: false, }
 * 除 isBuffer, 默认返回 json 格式
 * GET 的 data 转换成 &key=val
 *
 * 有opt:{cert,key} -> new https.Agent()
 */
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const zlib = require('zlib')
const fs = require('fs')

const TIMEOUT = 30 // s

const defaultHeaders = {
  // 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
  'Accept': 'application/json',
  'content-type': 'application/json;charset=UTF-8',
  // 'content-type': 'application/json',
  'accept-encoding': 'gzip, deflate, br',
  // 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36 Edg/86.0.622.63'
  'User-Agent': 'runzhai'
}

const getBodyLength = body =>
  (body === null || body === undefined) ?
    0 : Buffer.byteLength(body)

const qs = (params) => new URLSearchParams(params).toString()

const isObject = (obj) => obj && typeof obj === 'object'

const isStream = stream => stream !== null
  && typeof stream === 'object'
  && typeof stream.pipe === 'function'

const reqPost = (req, { data, method }) => {
  if (isStream(data)) return data.pipe(req)
  if (data && method !== 'GET') req.write(data)
  req.end()
}

// `req` 是 http.IncomingMessage，它是可读流。
// `res` 是 http.ServerResponse，它是可写流。
function httpRequest(url, opt, response) {
  const protocol = url.includes('https') ? https : http
  const req = protocol.request(url, opt, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      httpRequest(headers.location, opt, response)
    } else response(res)
  }).on('error', e => {
    console.error(e)
  })
  return req
}

module.exports = exports = { isStream, isObject, qs }

const pipeEncoding = (response) => {
  const encoding = response.headers['content-encoding']
  if (encoding === 'gzip') return response.pipe(zlib.createGunzip())
  if (encoding === 'deflate') return response.pipe(zlib.createInflate())
  if (encoding === 'br') return response.pipe(zlib.createBrotliDecompress())
  return response
}

const httpRp = async (url, { method = 'GET', timeout = TIMEOUT, headers, ...options } = {}, cb) => {
  const opt = { method, headers: { ...defaultHeaders, ...headers }, ...options }
  return new Promise((resolve, reject) => {
    setTimeout(() => reject('time out: ' + timeout), timeout * 1000)
    const request = httpRequest(url, opt, async response => {
      const { statusCode, headers } = response
      const res = pipeEncoding(response) // pipe -> zip
      if (opt.stream) return resolve({ response: res, statusCode, headers })
      let buf = []
      for await (const chunk of res) {
        buf.push(chunk)  // ES6 异步迭代器 v11.14+
        cb && cb(chunk, headers)
      }
      resolve({
        statusCode, headers,
        data: Buffer.isBuffer(buf[0]) ? Buffer.concat(buf) : buf.join('')
      })
    })
    request.on('error', (error) => reject(error))
    reqPost(request, opt)
  })
}

const json = ({ data, headers, statusCode }) => {
  data = Buffer.isBuffer(data) ? data.toString('utf8') : data
  try {
    if (data && (!headers || !headers['content-type'] || !headers['content-type'].includes('xml')))
      data = JSON.parse(data)
  } catch (e) {
    console.log('e:', e)
  }
  return { data, headers, statusCode }
}

const preData = (data, { headers = {}, ...opt } = {}) => {
  const options = { data, headers, ...opt }
  if (data && isObject(data) && !Buffer.isBuffer(data) && !isStream(data)) {
    if (/x-www-form-urlencoded/.test(headers['content-type']))
      options.data = qs(data)
    else options.data = JSON.stringify(data)
  } else if (!data && /application\/json/.test(headers['content-type'])) options.data = '{}'
  options.headers['content-length'] = getBodyLength(options.data)
  if (opt.key && opt.cert) {
    options.agent = new https.Agent(options)
  }
  return options
}

exports.rp = async (url, { data, method, isBuffer, ...opt } = {}) => {
  if (!method || method === 'GET' || method === 'get') return exports.get(url, { data, isBuffer, ...opt })
  const res = await httpRp(url, preData(data, { method, isBuffer, ...opt }))
  if (isBuffer) return res
  return json(res)
}

exports.get = async (url, { data, isBuffer, ...opt } = {}) => {
  if (isObject(data)) {
    url = url.includes('?') ? `${url}&${qs(data)}` : `${url}?${qs(data)}`
  }
  const res = await httpRp(url, opt)
  if (isBuffer) return res
  return json(res)
}

exports.put = async (url, data, opt = {}) => {
  return exports.rp(url, { data, method: 'PUT', ...opt })
}

exports.post = async (url, data, opt = {}) => {
  return exports.rp(url, { data, method: 'POST', ...opt })
}

exports._delete = async (url, opt = {}) => {
  const res = await httpRp(url, { ...opt, method: 'DELETE' })
  return json(res)
}

exports.head = async (url, opt = {}) => {
  const res = await httpRp(url, { ...opt, method: 'HEAD' })
  return json(res)
}
/**
 * 解码 base64 -> utf8
 * 返回 'utf8', 'ascii','hex' 格式字符串
 * @param {string} str base64
 * @param encoding
 */
exports.atob = (str, encoding = 'utf8') => {
  return Buffer.from(str, 'base64').toString(encoding)
}

/**
 * 编码 base64
 * str 格式,'utf8', 'ascii','hex'
 * @param {string} str utf8 格式
 * @param encoding  'utf8'
 */
exports.btoa = (str, encoding = 'utf8') => {
  const buf = Buffer.isBuffer(str) ? str : Buffer.from(str, encoding)
  return buf.toString('base64')
}

/**
 * 下载 to stream
 * @param {string} url
 * @param {object} param {stream} stream 传入可写流
 * @returns
 */
exports.downloadToStream = async (url, opt, cb) => {
  const { response, headers, statusCode } = await httpRp(url, { ...opt, stream: true }, cb)
  cb && cb(null, headers)
  response.pipe(opt.stream)
  let totalLength = 0
  response.on('data', (chunk) => {
    // 每次 1400 B (TCP 数据包的最大负载是 1480-20 = 1460 字节)
    totalLength += chunk.length
    cb && cb(chunk, headers)
    // console.log('recevied data size: %d / %d ', chunk.length, totalLength)
  })
  response.on('end', () => {
    console.log('recevied end size: %d', totalLength)
    if (totalLength !== +headers['content-length'])
      console.log('recevied size err! file length: %d', headers['content-length'])
  })
  return new Promise((resolve, reject) => {
    opt.stream.on('close', () => {
      resolve({ totalLength, statusCode, headers, })
    })
  })
}

/**
 * 下载 到文件(流)
 * 指定文件名 | dir+其自带文件名 | stream 流
 * dir 优先，此为路径;
 * @param {string} url
 * @param {object} param {hash} hash 'sha1'|'md5' 返回相应hash值
 * @param {function} cb {chunk,headers}
 * @returns {{statusCode,headers,totalLength,hash,contentHash}}
 */
exports.downloadToFile = async (url, { dir, fileName, hash, ...opt }, cb) => {
  let fsHash = hash ? crypto.createHash(hash) : null
  const res = await exports.downloadToStream(url, opt, (chunk, headers) => {
    if (!chunk && !opt.stream) {
      if (dir && headers['content-disposition']) {
        let tmp = headers['content-disposition'].match(/filename\*=UTF-8''(.+)/i)
        tmp && (fileName = dir + decodeURIComponent(tmp[1]))  // 中文
      }
      opt.stream = fs.createWriteStream(fileName)
    } else {
      hash && fsHash.update(chunk)
      cb && cb(chunk, headers)
    }
  })
  if (hash) {
    res.contentHash = fsHash.digest('hex').toUpperCase()
    res.hash = hash
  }
  return res
}

/**
 * 上传 文件|流
 * @param {string} url
 * @param {object} param {method, fileName, stream, hash} method:PUT,POST;
 * hash 'sha1'|'md5' 返回相应hash值
 * @returns {{data, statusCode, headers, totalLength, hash, contentHash}}
 */
exports.uploadStream = async (url, { fileName, stream, method = 'PUT', hash, ...opt }, cb) => {
  let data = stream ? stream : fs.createReadStream(fileName)
  let fsHash = hash ? crypto.createHash(hash) : null
  let totalLength = 0
  data.on('data', chunk => {
    totalLength += chunk.length
    hash && fsHash.update(chunk)
    cb && cb(chunk)
  })
  data.on('end', () => {
    // console.log('data end:',)
  })
  let res = await httpRp(url, { ...opt, data, method },)
  res = json(res)
  if (hash) {
    res.contentHash = fsHash.digest('hex').toUpperCase()
    res.hash = hash
  }
  res.totalLength = totalLength
  return res
}
