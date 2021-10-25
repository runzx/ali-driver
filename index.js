#!/usr/bin/env node
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
  .opt('i', 'drive-id', 'string', 'set drive_id') // driveId
  .opt('p', 'parent-file-id', 'string', 'set parent_file_id')
  .opt('w', 'over-write', 'boolean', 'set overWrite')
  .opt('c', 'clear-task', 'array', 'remove type task')
  .opt('l', 'list-task', 'array', 'list type task')

let arg = argv.parse()

console.time("start")

const ali = new AliFile(arg)
ali.start().catch(err => {
  console.log('AliFile err:', err)
  ali.task.stop().then(() => process.exit(0))
})