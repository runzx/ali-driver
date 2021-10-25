#!/usr/bin/env node
/**
 * 命令行式
 * 翟享20211023
 */
const { AliFile } = require('./app/file-upload')
const { command } = require('./lib/command')
const package = require("./package.json")

const argv = command(package.version)
  .opt('f', 'fileName', 'string', 'add upload file|folder')
  .opt('n', 'name', 'string', 'save file name("path/name")')
  .opt('d', 'download', 'string', 'download file dir|folder')
  .opt('o', 'out', 'string', 'download to folder')
  .opt('i', 'drive-id', 'string', 'set drive_id') // driveId
  .opt('t', 'refresh-token', 'string', 'set refresh_token')
  .opt('p', 'parent', 'string', 'set parent_file_id')
  .opt('w', 'over-write', 'boolean', 'set overWrite')
  .opt('c', 'clear-task', 'array', 'remove type task')
  .opt('s', 'list-task', 'array', 'list type task')
  .opt('l', 'ls', 'string', 'ls ali dir')

let arg = argv.parse()

console.time("start")

const ali = new AliFile(arg)
ali.start().catch(err => {
  console.log('AliFile err:', err)
  ali.task.stop().then(() => process.exit(0))
})
