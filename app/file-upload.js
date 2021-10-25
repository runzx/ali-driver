const { MultipartUpload } = require("../lib/upload")

class AliFile {
  task

  constructor(opt = {}) {
    this.opt = opt
  }

  async start() {
    const { out, fileName, dir, refreshToken: refresh_token,
      driveId: drive_id, parentFileId: parent_file_id,
      overWrite, clearTask, listTask } = this.opt

    const t = this.task = new MultipartUpload({
      drive_id, refresh_token, parent_file_id,
      intervalTime: 60 * 3,
      overWrite
    })
    if (listTask) await t.listTask(listTask)
    if (clearTask) await t.clearTask(clearTask)

    const tasks = await t.start()

    if (fileName) {
      await t.initUpload(fileName, out, dir)
    } else {
      if (tasks === 0) return t.quitTask()
    }

    process.on('SIGINT', function () {
      console.log('Got a SIGINT. exit with save config file')
      t.quitTask()
    })
  }
}


module.exports = { AliFile }