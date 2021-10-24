const crypto = require('crypto')
const fs = require('fs')
const path = require('path')


// 48 ->64位 yHE9Jux1bVtCfmfUbgAUhjr6s_OJpFl1FwwGauXOWlAa7qIhIzfpMypMxMsQnYAX
// 16,18 -> 24位字符: 43K1zmgDiTC_UHaey6CoCg== 18最后不会是2个=
// 6,8 -> 8B, 12B
exports.generateRandom = (len = 18) =>
  crypto.randomBytes(len)
    .toString('base64')
    .replace(/\//g, '_')
    .replace(/\+/g, '-')

exports.hash = (str, type = 'sha256', outCoding = 'hex', inputEncoding = 'utf8') =>
  crypto.createHash(type)
    .update(str, inputEncoding)
    .digest(outCoding)

// 默认sha256 密钥相关的哈希运算消息认证码, encoding=null 返回Buffer
const hmac = (str, key, { method = 'sha256', encoding = 'hex', inputEncoding = 'utf8' } = {}) =>
  crypto
    .createHmac(method, key)
    .update(str, inputEncoding)
    .digest(encoding)


exports.md5 = (str, encoding = 'hex', inputEncoding = 'utf8') =>
  crypto.createHash('md5')
    .update(str, inputEncoding)
    .digest(encoding)

/**
 * hash 校验
 * @param {*} pubKey        pem格式，要有换行
 * @param {*} signature     base64 格式
 * @param {*} signStr       utf8 字符串
 * @param {*} signatureCode 'base64'
 * @param {*} hashes        'RSA-MD5' 'RSA-SHA256'
 */
exports.rsaVerify = (pubKey, signature, signStr, signatureCode = 'base64', hashes = 'RSA-MD5') =>
  crypto.createVerify(hashes)
    .update(signStr)
    .verify(pubKey, signature, signatureCode)
/* 
{
  var verify = crypto.createVerify(hashes)
  verify.update(signStr)
  return verify.verify(pubKey, signature, signatureCode)
} */

// 从对象中 指定属性 生成新对象 'prop1 prop2'
exports.selectProp = (obj = {}, properties = '') => {
  let include = null
  if (Array.isArray(properties)) include = properties
  else if (typeof properties !== 'string') return null
  else if (properties.includes('-')) {
    const exclude = properties.replace('-', '').split(' ')
    include = Object.keys(obj).filter(i => !exclude.includes(i))
  } else include = properties.split(' ')
  return include.reduce((o, key) => (o[key] = obj[key], o), {})
}

// 瘦身对象（只留部分） ▶ slim({ name: 'Benjy', age: 18 }, ['age']) // => { age: 18 }
exports.slim = (obj, properties = []) => properties.reduce((p, c) => (p[c] = obj[c], p), {})
// 瘦身对象（排除异己） ▶ omit({ name: 'Benjy', age: 18 }, ['age']) // => {name: "Benjy"}
exports.omit = (obj, properties = []) => Object.entries(obj).reduce(
  (p, [k, v]) => !properties.includes(k) ? (p[k] = v, p) : p, {})

exports.selectBody = (body, properties) => {
  if (properties.includes('-')) {
    const defaultProps = ['no', '_id', 'bisId']
    defaultProps.forEach(key => {
      if (!properties.includes(key)) properties += ` ${key}`
    })
  }
  return exports.selectProp(body, properties)
}


// 单个数字返回双字符串, 5 -> '05', 58 -> '58'
exports.numFmt2B = (n) => ('' + n)[1] ? '' + n : '0' + n

// 易懂数字显示: '1.58K'
exports.numFmtByUnit = (num, digits = 2) => {
  const si = [
    { value: 1e18, symbol: 'E' },
    { value: 1e15, symbol: 'P' },
    { value: 1e12, symbol: 'T' },
    { value: 1073741824, symbol: 'G' },
    { value: 1048576, symbol: 'M' },
    { value: 1024, symbol: 'K' },
    { value: 1, symbol: '' }
  ]
  const rx = /\.0+$|(\.[0-9]*[1-9])0+$/
  let i
  for (i of si) if (num >= i.value) break

  return (num / i.value).toFixed(digits).replace(rx, '$1') + i.symbol
}

// 3位加 ','
exports.toThousandslsFilter = num => (+num || 0).toString()
  .replace(/^-?\d+/g, m => m.replace(/(?=(?!\b)(\d{3})+$)/g, ','))

/**
 * 解码
 * 返回 'utf8', 'ascii','hex' 格式字符串
 * @param {string} str base64格式
 */
exports.atob = (str, encoding = 'utf8') => Buffer.from(str, 'base64').toString(encoding)
/**
 * 编码 base64
 * str 格式,'utf8', 'ascii','hex'
 * @param {string|Buffer} str 默认: utf8格式
 */
exports.btoa = (str, encoding = 'utf8') => (Buffer.isBuffer(str) ? str : Buffer.from(str, encoding))
  .toString('base64')

/**
 * 延时，不影响其它的http进程
 * @param {number} ms 延时ms
 */
exports.delay = (ms = 1000) => {
  return new Promise(res => setTimeout(res, ms))
}
/**
 * 延时，卡死cpu！, nodejs主线程要等待！！
 * @param {number} ms
 */
exports.sleep = (ms = 0) => {
  for (var start = new Date; new Date - start <= ms;) {
  }
}

/**
 * 判断是否为空
 * @param {object|array|String}obj 对象,数组,字符串,
 * @returns {boolean}
 */
exports.isEmpty = (obj) => obj === undefined || obj === null
  || (typeof obj === 'object' && Object.keys(obj).length === 0)
  || (typeof obj === 'string' && obj.trim().length === 0)
  || (Array.isArray(obj) && obj.length === 0)

exports.isNull = (obj) => obj === null

exports.isUndefined = (obj) => typeof obj === 'undefined'

exports.isObject = (obj) => typeof obj === 'object'
  && obj !== null
  && !Array.isArray(obj)

exports.isString = (obj) => typeof obj === 'string'

exports.isFunction = (obj) => typeof obj === 'function'

/**
 * 判断对象类型
 * @param o
 * @returns {string} null, undefined, object, array,
 *      string, number, boolen,
 *      function, regexp, map, set, symbol, blob,
 */
exports.type = (o) => Object.prototype.toString.call(o)
  .match(/\[object (.*?)\]/)[1]
  .toLowerCase()

/**
 * 转换数字为 2位字符串
 * @param {number} n
 * @returns {string} '01'
 */
function formatNumber(n) {
  n = n.toString()
  return n[1] ? n : '0' + n
}

// 显示当天 年月日
exports.dateYMD = () => {
  let date = new Date()
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  // const hour = date.getHours()
  // const minute = date.getMinutes()
  // const second = date.getSeconds()
  return [year, month, day].map(formatNumber).join('-') //+ ' ' + [hour, minute, second].map(formatNumber).join(':')
}

/*
 *拓展Date方法。得到格式化的日期形式
 *date.format('yyyy-MM-dd')，date.format('yyyy/MM/dd'),date.format('yyyy.MM.dd')
 *date.format('dd.MM.yy'), date.format('yyyy.dd.MM'), date.format('yyyy-MM-dd HH:mm')
 *使用方法 如下：
 *                       var date = new Date();
 *                       var todayFormat = date.format('yyyy-MM-dd'); //结果为2015-2-3
 *Parameters:
 *format - {string} 目标格式 类似('yyyy-MM-dd')
 *Returns - {string} 格式化后的日期 2015-2-3
 *
 */
Date.prototype.format = function(format) {
  var o = {
    'M+': this.getMonth() + 1, //month
    'd+': this.getDate(), //day
    'h+': this.getHours(), //hour
    'm+': this.getMinutes(), //minute
    's+': this.getSeconds(), //second
    'q+': Math.floor((this.getMonth() + 3) / 3), //quarter
    S: this.getMilliseconds() //millisecond
  }
  if (/(y+)/.test(format))
    format = format.replace(RegExp.$1, (this.getFullYear() + '').substr(4 - RegExp.$1.length))
  Object.keys(o).forEach(k => {
    if (new RegExp(`(${k})`).test(format))
      format = format.replace(
        RegExp.$1,
        RegExp.$1.length == 1 ? o[k] : ('00' + o[k]).substr(('' + o[k]).length)
      )
  })
  return format
}

exports.toHump = (str, sign = '_') => {
  const re = new RegExp(`\\${sign}(\\w)`, 'g')
  return str.replace(re, (match, letter) => letter.toUpperCase())
}

exports.toLine = (str, sign = '_') => {
  return str.replace(/([A-Z])/g, `${sign}$1`).toLowerCase()
}

// ms-> Xd X:XX:XX 
exports.timeFmt = (time) => {
  let s = Math.floor(time / 1000)
  let m = Math.floor(s / 60)
  let h = Math.floor(s / (60 * 60))
  let d = Math.floor(s / (24 * 60 * 60))
  m = m - h * 60
  h = h % 24
  s = s % 60

  let res = d > 0 ? `${d}d ` : ''
  res += h > 0 ? `${h}:` : ''
  res += m > 0 ? `${exports.numFmt2B(m)}:${exports.numFmt2B(s)}` : `${exports.numFmt2B(s)}s`

  return res
}
// 延时ms
exports.wait = ms => new Promise(resolve => setTimeout(resolve, ms))

exports.lexerTxtFmt = (txt) => {
  const list = [',', '，', '。', '‘', '’', '“', '”', '\'', '"', ':', '：', '\u3000']
  list.forEach(char => {
    const re = new RegExp(` *${char} *`, 'g')
    txt = txt.replace(re, char)
  })
  txt = txt.replace(/\s*\.\s*/g, '.')
  return txt
}

// 对象属性是字符串去首尾空格
exports.objTrim = (obj) => Object.keys(obj)
  .reduce((acc, key) => {
    acc[key] = typeof obj[key] === 'string' ? obj[key].trim() : obj[key]
    return acc
  }, {})

// 时间转成 秒 '7d', '5h'
exports.timeToS = str => {
  if (typeof str === 'string') {
    let res = str.match(/(\d+)([smhdMY]*)/)
    if (!res) return null
    let [s, num, unit] = res
    const v = { s: 1, m: 60, h: 3600, d: 3600 * 24, M: 3600 * 24 * 30, Y: 3600 * 24 * 365 }
    return +num * v[unit ? unit : 's']
  }
  return str
}

// 把obj里是对象的分析成 {'objName.prop':val},只解2层
exports.$setObj = (obj) => Object.keys(obj).reduce((acc, objName) => {
  const tmp = !exports.isObject(obj[objName]) ? { [objName]: obj[objName] }
    : Object.keys(obj[objName])
      // .filter(i => obj[objName][i])
      .reduce((acc, key) => {
        // if (exports.isString(obj[objName][key]) && !obj[objName][key].trim()) return acc
        acc[`${objName}.${key}`] = obj[objName][key]
        return acc
      }, {})
  return { ...acc, ...tmp }
}, {})

exports.txtTrim = txt => txt.replace(/[\s\u200b-\u200f\u2029-\u202f]/g, '')

// 转换时间戳 ms -> 秒, 默认当前时间戳
exports.timestamp = (time = +new Date()) => (+time / 1000).toFixed(0)

/**
 * 转换对象 属性名称
 * @param obj
 * @param props 'name nickName,sex gender'
 * @param all : true 属性值为 null ''能转换; undefined不转换, false时 没值(不包括0)都不转换
 * @returns {{}}
 */
exports.objPropRename = (obj = {}, props = '', all = true) => {
  let arr = props.split(',')
  const res = {}
  arr.forEach(i => {
    let [, key, newKey] = i.match(/(\w+)\s*(\w*)/) || []
    if (key && !newKey) newKey = key
    if (key && newKey && obj[key] !== undefined && (all || obj[key] || obj[key] === 0)) res[newKey] = obj[key]
  })
  return res
}

/**
 * 生成日期字符串
 * 昨天-1、前天-2、明天+1
 * @param {number} AddDayCount
 * @returns {string} 'yyyy-MM-dd'
 */
exports.GetDateStr = (AddDayCount = 0) => {
  const dd = new Date();
  dd.setDate(dd.getDate() + AddDayCount) //获取AddDayCount天后的日期
  return dd.format('yyyy-MM-dd')
}

/**
 * 生成日期字符串 '20210811'
 * @param {Date|string} date 默认当天
 * @returns {string}
 * @constructor
 */
exports.DateYMDStr = (date = new Date()) => {
  if (typeof date === 'string') date = new Date(date)
  const y = date.getFullYear()
  const m = date.getMonth() + 1 //获取当前月份的日期
  const d = date.getDate()
  return y + exports.numFmt2B(m) + exports.numFmt2B(d)
}

/**
 * 递归创建目录 同步方法
 * @param dirname 目录
 */
exports.mkdirsSync = dirname => {
  if (fs.existsSync(dirname)) {
    return true
  } else {
    if (exports.mkdirsSync(path.dirname(dirname))) {
      fs.mkdirSync(dirname)
      return true
    }
  }
}

/**
 * 自动创建路径，windows Excel打开不会乱码
 * @param {string} csvTxt
 * @param  {...any} paths 最后一个参数含文件名
 * @returns {string}
 */
exports.writeCsvFile = (csvTxt, ...paths) => {
  const pathFile = path.resolve(...paths)
  if (exports.mkdirsSync(path.dirname(pathFile)))
    fs.writeFileSync(`${pathFile}`, '\ufeff' + csvTxt)
  return pathFile
}

/**
 * 转驼峰式 默认'_'
 * @param str
 * @param sp
 */
exports.camelcase = (str, sp = '_') => str.split(sp)
  .reduce((acc, word) => acc + word[0].toUpperCase() + word.slice(1))
