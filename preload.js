const {ipcRenderer} = require('electron')


window.addEventListener('DOMContentLoaded', () => {
  const $ = document
  const GE = (id) => { return document.getElementById(id) }
  const CE = (name) => { return document.createElement(name) }

  /** @type {HTMLInputElement} */
  const rootDir = GE("root-dir")
  /** @type {HTMLInputElement} */
  const globPat = GE("glob-pat")
  /** @type {HTMLInputElement} */
  const searchPat = GE("search-pat")
  /** @type {HTMLInputElement} */
  const endSearchPat = GE("end-search-pat")

  /** @type {HTMLButtonElement} */
  const searchButton = GE("submit-search")

  /** @type {HTMLDivElement} */
  const searchResult = GE("search-result")

  /** @type {HTMLButtonElement} */
  const applyButton = GE("apply")
  /** @type {HTMLButtonElement} */
  const submitResultButton = GE("submit-result")
  /** @type {HTMLButtonElement} */
  const skipButton = GE("skip")


  /** @type {HTMLTextAreaElement} */
  const scriptArea = GE("script")

  /** @type {HTMLTextAreaElement} */
  const beforeArea = GE("before")
  /** @type {HTMLTextAreaElement} */
  const afterArea = GE("after")

  const clearSelection = () => {
    for(const liTag of searchResult.getElementsByTagName('LI'))
    {
        liTag.className = liTag.className.replace(" is-active", "")
    }
  }

  /** @param {HTMLLIEelemnt} li */
  const findSelectedIndex = (li) => {
    // I don't know why, but the result of findIndex is 1, 3, 5, ... for this time.
    return Math.floor([...li.parentElement.childNodes].findIndex( (item) => item === li )/2)
  }

  const selectLICss = (liTarget) => {
    liTarget.className += " is-active"
  }

  const selectLIAfterClear = (liTarget) => {
    selectLICss(liTarget)
    const rpath = liTarget.getAttribute("rpath")
    const index = liTarget.getAttribute("index")
    ipcRenderer.send('search-result-selected', rpath, index, endSearchPat.value)
  }

  const selectAndApply = (liTarget) => {
    selectLICss(liTarget)
    const rpath = liTarget.getAttribute("rpath")
    const index = liTarget.getAttribute("index")
    ipcRenderer.send('search-result-selected-and-apply', rpath, index, endSearchPat.value, scriptArea.value)
  }


  searchResult.addEventListener('click', (e) => {
    if(e.target.tagName == "LI") {

      /** @type {HTMLLIElement} */
      const liTarget = e.target
      clearSelection()
      selectLIAfterClear(liTarget)
    }
  
  })

  searchButton.addEventListener('click', ()=> {
    ipcRenderer.send('start-search', rootDir.value, globPat.value, searchPat.value, endSearchPat.value)    
  })

  submitResultButton.addEventListener('click', ()=> {
    if (beforeArea.value != "" && afterArea.value != "")
      ipcRenderer.send('submit-result')
  })

  ipcRenderer.on('on-search-result', (event, innerHtml)=> {
    searchResult.innerHTML = innerHtml;
  })

  ipcRenderer.on("show-before", (event, rawText) =>{
    beforeArea.value = rawText
    afterArea.value = ""
  })

  const sendApplyScript = () => {
    if (scriptArea.value != "")
      ipcRenderer.send('apply-script', scriptArea.value)
  }

  applyButton.addEventListener('click', () => {
    sendApplyScript()
  })


  const gotoNextFile = (rpath) => {
    const uls = searchResult.getElementsByTagName("UL")
    const i = findULIndex(uls, rpath)
    if (i == -1 || uls.length-1 == i) {
      beforeArea.value = ""
      afterArea.value = ""
      return
    }
    const ul = uls[i+1]
    const lis = ul.getElementsByTagName("LI")
    selectAndApply(lis[0])
  }

  const gotoNextEntry = ()=> {
    const actives = searchResult.getElementsByClassName("is-active")
    // no selection, nexxt is undefined. do nothing.
    if(actives.length == 0)
      return ""

    const li = actives[0]
    li.className = li.className.replace(" is-active", "")
    // nextSiblingはtext
    if(li.nextSibling && li.nextSibling.nextSibling) {
      selectAndApply(li.nextSibling.nextSibling)
      return ""
    }
    // このファイルは続き無し。rpathを返して次のファイルに行ってもらう。
    return li.getAttribute("rpath")
  }


  skipButton.addEventListener('click', ()=> {
    const rpath = gotoNextEntry()
    if(rpath == "")
      return
    gotoNextFile(rpath)
  })

  ipcRenderer.on("show-after", (event, rawText) =>{
    afterArea.value = rawText
  })

  /**
   * 
   * @param {HTMLCollectionOf<Element>} uls 
   * @param {string} rpath 
   * @returns {number} - 見つからなければ-1
   */
  const findULIndex = (uls, rpath) => {
    for(let i = 0; i < uls.length; i++) {
      const ul = uls[i]
      if(ul.getAttribute("rpath") == rpath) {
        return i
      }
    }
    return -1
  }

  ipcRenderer.on("update-one-search-result", (event, rpath, rawText)=> {
    const uls = searchResult.getElementsByTagName("UL")
    const i = findULIndex(uls, rpath)
    if (i == -1) {
      console.log("never comes here.")
    }
    uls[i].innerHTML = rawText
  })


  ipcRenderer.on("goto-next-file", (_, rpath)=> {
    gotoNextFile(rpath)
  })
})