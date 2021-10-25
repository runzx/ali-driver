const { MultipartUpload } = require("../lib/upload")

class AliFile {
  task

  constructor(opt = {}) {
    this.opt = opt
  }

  async start() {
    const { name, fileName, download, refreshToken: refresh_token,
      driveId: drive_id, parent: parent_file_id,
      overWrite, clearTask, listTask, ls } = this.opt

    const t = this.task = new MultipartUpload({
      drive_id, refresh_token, parent_file_id,
      intervalTime: 60 * 3,
      overWrite
    })
    if (listTask) return await t.listTask(listTask)
    if (clearTask) return await t.clearTask(clearTask)
    if (ls !== undefined) return await t.lsDir(ls)

    const tasks = await t.start()

    if (fileName) {
      await t.initUpload(fileName, name)
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