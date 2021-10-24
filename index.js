#!/usr/bin/env node
/**
 * 命令行式
 * 翟享20211023
 */
const { AliFile } = require('./app/file-upload')
const { command } = require('./lib/command')
const package = require("./package.json")

const argv = command(package.version)
  .opt('f', 'fileName', 'string', 'add upload file')
  .opt('o', 'out', 'string', 'save file name')
  .opt('d', 'dir', 'string', 'save file dir')
  .opt('t', 'refresh-token', 'string', 'set refresh_token')
  .opt('i', 'drive-id', 'string', 'set drive_id') // setRaw
  .opt('p', 'parent-file-id', 'string', 'set parent_file_id') // setRaw
  .opt('w', 'over-write', 'boolean', 'set overWrite') // setRaw

let arg = argv.parse()
if (!arg) return

console.time("start")

const ali = new AliFile(arg)
ali.start().catch(err => {
  ali.task.stop().then(() => process.exit(0))
})


