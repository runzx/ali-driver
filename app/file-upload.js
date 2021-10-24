const { MultipartUpload } = require("../lib/upload")

class AliFile {
  task

  constructor(opt = {}) {
    this.opt = opt
  }

  async start() {
    const { out, fileName, dir, refreshToken: refresh_token,
      driveId: drive_id, parentFileId: parent_file_id,
      overWrite } = this.opt

    const t = this.task = new MultipartUpload({
      drive_id, refresh_token, parent_file_id,
      intervalTime: 60 * 3,
      overWrite
    })
    const tasks = await t.start()

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