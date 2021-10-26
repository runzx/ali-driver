# ali driver tools in nodejs

1. 分片上传，(整个目录上传)
2. 断点继存下载，(整个目录下载)
3. 查看网盘目录
4. 查看、删除 日志

## setup

1. `npm install ali-driver`

## command

1. `npx ali-driver -f xx` upload file xx

2. `npx ali-driver -t yy` set refresh_token

3. `npx ali-driver -h` help
4. `npx ali-driver -l 2,4` list task log in status
5. `npx ali-driver -c 2,4` remove task|log in status
6. `npx ali-driver -d tmp/xx.jpg -o download/yy` download file to dir
7. `npx ali-driver -w` set overWrite
8. `npx ali-driver -e 10` set intrevalTime (S)
9. `npx ali-driver -m 6` set max tasks

## 
1. gitHub `https://github.com/runzx/ali-driver`
2. qq: 843476168
