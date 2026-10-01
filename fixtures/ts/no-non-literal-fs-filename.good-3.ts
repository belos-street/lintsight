// valid-3：未导出 helper 的路径参数——来源在调用侧，helper 内部不点名（T1.19 #1 反哺）
import fs from 'node:fs'

function readMdFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
}

function listPosts(inputDir: string) {
  return () => fs.readdir(inputDir, () => {})
}
