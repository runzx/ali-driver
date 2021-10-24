const { MultipartUpload } = require("../lib/upload")

class AliFile {
  task

  constructor(opt = {}) {
    this.opt = opt
  }

  async start() {
    const t = this.task = new MultipartUpload({ overWrite: true, intervalTime: 60 * 3 })
    const tasks = await t.start()
    const { out, fileName, dir } = this.opt
    if (fileName) {
      await t.initUpload(fileName, out, dir)
    } else {
      if (tasks === 0) return process.exit(0)
    }

    process.on('SIGINT', function () {
      console.log('Got a SIGINT. exit with save config file')
      console.timeEnd("start")
      t.stop().then(() => process.exit(0))
    })
  }
}


module.exports = { AliFile }