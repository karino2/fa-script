const { app, BrowserWindow, screen, ipcMain } = require('electron')
const path = require('node:path')
const fg = require('fast-glob')
const fs = require("fs/promises")
const {encode} = require('html-entities')
const util = require('node:util')
const exec = util.promisify(require('node:child_process').exec)

const createWindow = () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: width,
    height: height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
   })

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let g_rootDir = ""
let g_outputRoot = __dirname
let g_target = "" // rpath
let g_begin = 0
let g_end = 0
let g_lines = [] // 現在のファイルの行にsplitしたもの

/** @type {RegExp} */
let g_begPat = undefined
/** @type {RegExp} */
let g_endPat = undefined
let g_endPatStr = ""

let g_eol = "\n"

let g_tmp_input="tmp_input.txt"
let g_tmp_output="tmp_output.txt"
let g_tmp_script="tmp_script.sh"

/**
 * 
 * @param {string} content 
 */
const guessEOL = (content) => {
  const firstLF = content.indexOf("\n")

  // デフォルトはlf。前の結果をリセット
  g_eol = "\n"

  // 改行無し、デフォルトのまま
  if(firstLF == -1) {
    return
  }
  // 最初がlfならcrが来る事は無し
  if (firstLF == 0) {
    return
  }
  if (content.charAt(firstLF-1) == "\r") {
    g_eol = "\r\n"
  }
}

const readLinesFullPath = async (fpath) => {
  const content = await fs.readFile(fpath, {encoding: "utf-8"})
  guessEOL(content)
  return content.split(g_eol)
}

const readLines = async (rpath) => {
  const fpath = path.join(g_rootDir, rpath)
  return await readLinesFullPath(fpath)
}

const readTmpFileLines = async(rpath) => {
  return await readLinesFullPath(path.join(g_outputRoot, rpath))
}

const writeTmpFile = async (rpath, text, mode=0o666) => {
  const fpath = path.join(g_outputRoot, rpath)
  await fs.writeFile(fpath, text, {mode: mode})
}

const writeFile = async (rpath, text) => {
  const fpath = path.join(g_rootDir, rpath)
  await fs.writeFile(fpath, text)
}


const runScript = async (rpath) => {
  const fpath = path.join(g_outputRoot, rpath)
  await exec(fpath)
}

/**
 * @typedef {[number, string]} IndexLine
 * 
 * @typedef {Object} MatchRes
 * @property {string} rpath
 * @property {IndexLine[]} matches
 */

/**
 * @param {string} rpath
 * @param {RegExp} regPat
 * @returns {MatchRes}
 *  */
const listMatches = async (rpath, regPat)=> {
  const lines = await readLines(rpath)
  const res = []
  for(const [index, line] of lines.entries()) {
    if(line.match(regPat)) {
      res.push([index, line])
    }
  }
  return {rpath: rpath, matches: res}
}

/**
 * 
 * @param {MatchRes} oneMatch
 * @param {number} selectedIndex - add is-active flag for this li item. -1 if no selection
 * @param {string[]} res
 */
const buildOneMatchLIs = (oneMatch, selectedIndex, res) => {
  const rpath = oneMatch.rpath
  let curIndex = 0
  for(const [index, line] of oneMatch.matches) {
    const eline = encode(line)
    if (curIndex == selectedIndex) {
      res.push(`<li rpath="${rpath}" class=" is-active" index="${index}">${eline}</li>`)
    } else {
      res.push(`<li rpath="${rpath}" index="${index}">${eline}</li>`)
    }
    curIndex++
  }
}

/**
 * 
 * @param {MatchRes} oneMatch
 * @param {number} selectedIndex - add is-active flag for this li item. -1 if no selection
 * @param {string[]} res
 */
const buildOneMatchHtml = (oneMatch, selectedIndex, res) => {
  const rpath = oneMatch.rpath
  res.push("<details open>")
  res.push(`<summary>${rpath}</summary><ul rpath=${rpath}>`)
  buildOneMatchLIs(oneMatch, selectedIndex, res)
  res.push("</ul></details>")
}

/**
 * 
 * @param {MatchRes[]} matchRes 
 * @returns {string}
 */
const buildMatchListHtml = (matchRes) => {
  const res = []
  let selected = 0
  for(m of matchRes) {
    buildOneMatchHtml(m, selected, res)
    selected = -1
  }
  return res.join("\n")
}

const selectSearchResult = async(event, rpath, indexStr, endpat) => {
  const lines = await readLines(rpath)
  const index = Number(indexStr)
  const from = index
  const endPos = findEndPos(lines, index, endpat)

  g_begin = index
  g_end = endPos
  g_target = rpath
  g_lines = lines
  g_endPatStr = endpat

  let result = ""
  if(endPos != from) {
    result = lines.slice(from, endPos).join(g_eol)
  }

  event.sender.send("show-before", result)
}

ipcMain.on("start-search", async(event, rootDir, globPat, searchPat, endPat)=> {
  g_rootDir = rootDir
  // globPatはカンマ区切りでやってくる。
  const gpat = globPat.split(",").map( item=> item.trim() )

  const entries = await fg(gpat, {cwd: rootDir, dot: false} )
  g_begPat = new RegExp(searchPat)

  // Array.filterをasyncで使う方法が分からなかったので以下の記事を参考にしている（本当にこんな方法しか無いの？）
  // [javascript - How to use Array.prototype.filter with async? - Stack Overflow](https://stackoverflow.com/questions/47095019/how-to-use-array-prototype-filter-with-async)
  const matchIndices = await Promise.all(entries.map( async rpath => listMatches(rpath, g_begPat)))

  // matchesは [行数, 行の文字列]
  const matchRes = matchIndices.filter((_, i) => matchIndices[i].matches.length != 0)

  const html = buildMatchListHtml(matchRes)
  // console.log(html)
  event.sender.send("on-search-result", html)

  if (matchRes.length != 0)
  {
    const firstMatch = matchRes[0]
    await selectSearchResult(event, firstMatch.rpath, firstMatch.matches[0][0], endPat)
  }
})

const findEndPos = (lines, from, endpat) => {
  if (endpat == "") {
    g_endPat = undefined
    return Math.min(from+10, lines.length)
  }
  g_endPat = new RegExp(endpat)
  for(let i = from+1; i < lines.length; i++) {
    if(lines[i].match(g_endPat))
      return i+1
  }
  // not found, return the same pos.
  return from;
}

ipcMain.on("search-result-selected", async(event, rpath, index, endpat) => {
  await selectSearchResult(event, rpath, index, endpat)
})

ipcMain.on("search-result-selected-and-apply", async(event, rpath, index, endpat, script) => {
  await selectSearchResult(event, rpath, index, endpat)
  await applyScript(event, script)
})

const saveInput = async ()=> {
  const target = g_lines.slice(g_begin, g_end).join(g_eol)
  await writeTmpFile(g_tmp_input, target)
}

const runCurrentScript = async(event)=> {
  try {
    await runScript(g_tmp_script)
  
    const res = await readTmpFileLines(g_tmp_output)
    event.sender.send('show-after', res.join(g_eol))
  }catch(err) {
    event.sender.send('show-after', err)
  }

}

const applyScript = async(event, script) => {
  if(script == "")
    return

  await saveInput()
  const wholeScript = `#!/bin/sh
export INPUT=${g_tmp_input}
export OUTPUT=${g_tmp_output}
${script}
`
  await writeTmpFile(g_tmp_script, wholeScript, 0o755)
  await runCurrentScript(event)
}

ipcMain.on("apply-script", async(event, script) => {
  applyScript(event, script)
})

/**
 * fromより次のmatchのあるmatchesのインデックスを返す。無ければ-1を返す。fromと同じ値も成功とみなす。
 * 
 * @param {MatchRes} m 
 * @param {number} from 
 * @returns {number}
 */
const findNextMatchIndex = (m, from) => {
  for(const [index, one] of m.matches.entries()) {
    if(one[0] >= from)
      return index
  }
  return -1
}


ipcMain.on("submit-result", async(event) => {
  const newLines = await readTmpFileLines(g_tmp_output)
  const nextBegin = g_end - (g_end-g_begin)+newLines.length
  g_lines.splice(g_begin, g_end-g_begin, ...newLines)

  await writeFile(g_target, g_lines.join(g_eol))

  const newMatch = await listMatches(g_target, g_begPat)
  const nextIndex = findNextMatchIndex(newMatch, nextBegin)

  const builder = []
  buildOneMatchLIs(newMatch, nextIndex, builder)
  event.sender.send('update-one-search-result', g_target, builder.join("\n"))

  if(nextIndex != -1) {
    const one = newMatch.matches[nextIndex]
    await selectSearchResult(event, g_target, one[0], g_endPatStr)
    // apply script
    await saveInput()
    await runCurrentScript(event)    
  } else {
    event.sender.send("goto-next-file", g_target)
  }
})
