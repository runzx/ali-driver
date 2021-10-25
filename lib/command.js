/**
 * 简易 command 参数
 * 翟享 20211012
 * node command.js -a https://www.bosstg.cn/demo.jpg --out demo.jpg
 * - 单字符 参数 --多字符参数
 *  -V --version; -h --help 默认
 * type: 'boolean','string','number','array'
 *  boolean 类型后不带参数；为true,
 *  string number: '-x yyy zzz' 只取一个，yyy,自动转换
 *  array 空格，','，'|'分隔: '-a xx yy zz'/'-a xx,yy,zz'/'-a xx|yy|zz' -> a:['xx', 'yy', 'zz']
 *  --user-agent 自动转驼峰式 userAgent
 */
const path = require('path')


class PreArgv {
  version
  params = {
    version: { name: 'V', longName: 'version', info: 'version info', type: '' },
    help: { name: 'h', longName: 'help', info: 'help info', type: 'param' }
  }
  short = { V: 'version', h: 'help' }
  value = {}

  constructor({ version, params, short } = {}) {
    version && (this.version = version)
    params && (this.params = params)
    short && (this.short = short)
  }

  static command(version = '0.0.1') {
    return new PreArgv({ version, })
  }

  opt(...arg) {
    return this.option(...arg)
  }

  option(...arg) {
    let [name, longName, type = 'boolean', info = ''] = arg
    if (!longName) throw new Error('no name or lognName param')
    longName = this.camelcase(longName)
    if (type !== 'string' && type !== 'array' && type !== 'number') type = 'boolean'
    this.params[longName] = { name, longName, type, info }
    this.short[name] = longName
    this.value[longName] = undefined
    return this
  }

  parse(opt = process.argv) {
    const [, exe, ...arg] = process.argv
    this.execName = path.basename(exe)
    if (arg.length === 0) return
    // ['-v','-io','out.log']
    let idx = 0, k
    while (k = arg[idx]) {
      if (k.startsWith('-')) {
        let longName = this.name(k)
        if (!longName) return console.log('undefined param: ' + k)
        if (longName === 'version' || longName === 'help') {
          return this.help(longName, arg[idx + 1])
        }
        const type = this.params[longName].type
        if (type === 'boolean') {
          this.value[longName] = true
        } else if (type === 'string' || type === 'number') {
          if (arg[idx + 1] && !arg[idx + 1].startsWith('-')) {
            idx++
            if (type === 'number' && Number.isNaN(+arg[idx])) {
              return console.log(`param: '${k}' value is not number: '${arg[idx]}'`)
            }
            this.value[longName] = type === 'string' ? arg[idx] : +arg[idx]
          } else this.value[longName] = null
        } else if (this.params[longName].type === 'array') {
          const [arr, len] = this.getArr(arg, idx + 1)
          this.value[longName] = arr
          idx += len
        }
      }
      idx++
    }
    return this.value
  }

  help(longName, h) {
    if (longName === 'version') return console.log('version: ', this.version)

    console.log(`Usage: node ${this.execName} [options...]`)

    const log = (val) => {
      console.log(
        `  ${val.name ? '-' + val.name : '  '}, --${val.longName} ${!val.type || val.type === 'boolean' ? '' : '<' + val.type + '>'}  ${val.info}`)
    }

    if (h && (this.short[h] || this.params[h])) {
      let val = this.params[h] || this.params[this.short[h]]
      return log(val)
    }
    Object.entries(this.params).forEach(([key, val]) => {
      log(val)
    })
  }

  getArr(arg, idx) {
    let res = []
    while (arg[idx] && !arg[idx].startsWith('-')) {
      res.push(arg[idx++])
    }
    if (res.length === 1) {
      let [val] = res
      if (val.includes(',')) return [val.split(','), 1]
      if (val.includes('|')) return [val.split('|'), 1]
      return [[val], 1]
    }
    return [res, res.length]
  }

  name(name) {
    let param = name.replace(/^-/, '')
    if (name.startsWith('--')) {
      param = this.camelcase(name.replace(/^--/, ''))
      if (!this.params[param]) return
      return param
    }
    return this.short[param]
  }

  camelcase(str, sp = '-') {
    return str.split(sp).reduce((acc, word) => acc + word[0].toUpperCase() + word.slice(1))
  }
}

module.exports = PreArgv


