/**
 * 命令行式
 * 翟享20211023
 */
const { AliFile } = require('./app/file-upload')
const { command } = require('./lib/command')

const argv = command()
  .opt('f', 'fileName', 'string', 'add upload file')
  .opt('o', 'out', 'string', 'save file name')
  .opt('d', 'dir', 'string', 'save file dir')
  .opt('t', 'refresh-token', 'string', 'set refresh_token')
  .opt('i', 'driver-id', 'string', 'set driver_id') // setRaw

let arg = argv.parse()
if (!arg) return

console.time("start")

const ali = new AliFile(arg)
ali.start().catch(err => {
  ali.task.stop().then(() => process.exit(0))
})


