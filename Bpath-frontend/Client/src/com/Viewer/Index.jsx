import React from 'react'
import { vec2 } from 'gl-matrix'
import { getFileTypeByURL, vipsFnPromise, jpgBuffer2ImageAsync } from '../../core'
import { StateCover } from '../StateCover/Index'
const screenSize = global.nodeRequire('electron').screen.getPrimaryDisplay().size

function splitKofTile(KofTile) {
  return KofTile.split('.').map(Number)
}

export default class Viewer extends React.Component {
  static tileSize = 512
  static maxTileCache = 500

  state = {
    inited: false,
    loaded: false,
    error: false
  }

  _inited = false
  _animateId = null
  _changed = false
  _moveActive = false
  _selActive = false

  _infos = null
  _thumbnail = null
  _thumbnailLevel = null

  _degree = 0
  _zoom = 1
  // left&top记录的是百分比,而不是像素值
  _left = 0
  _top = 0
  _currentState = null

  _tile = {} // k 以 level.x.y 命名，每块大小为tileSize*tileSize
  _tileKeyList = [] // tile键顺序列表
  _changedTile = []
  _gettingTile = [] // 正在获取中的tile，避免同时获取

  _focus_history=[]
  _focus0=null;

  _sel_history = [];
  _selection = [];
  _curSelection = null;
  _lastSelectTimestamp = -Infinity;

  scaleLimit = 10;
  windowscale = 1;

  // minibox related
  initScale = 1;
  offsetX = 0;
  offsetY = 0;
  lastX = 0;
  lastY = 0;
  isMouseInMinibox = false;

  setScaleLimit = (lim) => {
    this.scaleLimit = lim;
    this._changed = true;
  }

  getCurrentScale = () => {
    // let windowscale = 1;
    if(this._infos) {
      let { width, height } = this.refs.canvas
      if (this._degree % 180 !== 0) [width, height] = [height, width]
      if(this._infos.width / this._infos.height < width / height) {
        // 25.4 / 96 -> css px/mm
        // ... * devicePixelRatio -> physical pixel/mm
        // 1000 * height / ... -> display height in um
        // mpp-y * infos.height -> imaging height in um (from data of layer 0)
        this.windowscale = 1000 * height / (25.4 / 96 * devicePixelRatio) / (this._infos['openslide.mpp-y'] * this._infos.height)
      } else {
        this.windowscale = 1000 * width / (25.4 / 96 * devicePixelRatio) / (this._infos['openslide.mpp-x'] * this._infos.width)
      }
    }
   
    // return windowscale * this._zoom;
    return this._zoom
  }

  _ensureScaleLimit = () => {
    // let windowscale = 1;
    if(this._infos) {
      let { width, height } = this.refs.canvas
      if (this._degree % 180 !== 0) [width, height] = [height, width]
      if(this._infos.width / this._infos.height < width / height) {
        // 25.4 / 96 -> css px/mm
        // ... * devicePixelRatio -> physical pixel/mm
        // 1000 * height / ... -> display height in um
        // mpp-y * infos.height -> imaging height in um (from data of layer 0)
        this.windowscale = 1000 * height / (25.4 / 96 * devicePixelRatio) / (this._infos['openslide.mpp-y'] * this._infos.height)
      } else {
        this.windowscale = 1000 * width / (25.4 / 96 * devicePixelRatio) / (this._infos['openslide.mpp-x'] * this._infos.width)
      }
    }
    // if(this._zoom * windowscale > this.scaleLimit) {
    //   this._zoom = this.scaleLimit / windowscale;
    // }
    if (this._zoom > this.scaleLimit / 10) {
      this._zoom = this.scaleLimit / 10;
      this._changed = true;
      this._animate();
    }
  }

  componentDidMount() {
    window.viewer = this
    this._resize()
    this._init(this.props.tilePath)
    this._initListener()
    this.props.registerResolutionLimitCallback(this.setScaleLimit);
    setTimeout(this._ensureScaleLimit, 10);
  }



  componentDidUpdate(pp, ps) {
    if (pp.layoutWidth !== this.props.layoutWidth || pp.layoutHeight !== this.props.layoutHeight) this._resize()
    if (pp.tilePath !== this.props.tilePath) {
      this._destroy()
      this.resetPosition()
      this.setState({ inited: false, loaded: false, error: false })
      this._degree = 0
      this.refs.canvas.getContext('2d').resetTransform()
      this._init(this.props.tilePath)
    }
  }

  componentWillUnmount() {
    this.props.unregisterResolutionLimitCallback(this.setScaleLimit);
    delete window.viewer
    this._destroyListener()
    this._destroy()
  }

  savejson(){

    let filename = 'focus_history.json'
    let data;

    if(this.props.gazerStatus) {
      const {base_time, history, mouse_clicks, recorder_chunks, stop_recorder, recorder} = this.props.gazerStatus;

      data = JSON.stringify({
        // infos: this._infos, // information from tile_path. Since the image is what we provided, info is redundent.
        tile_path: this._tilePath,
        focus0: this._focus0,
        focus_history: this._focus_history,
        selection_history: this._sel_history,
        gazer_status: {
          base_time, history, mouse_clicks
        },
      })

      stop_recorder().then(() => {
        let blob = new Blob(recorder_chunks, { 'type' : recorder().mimeType });
        let e = document.createEvent('MouseEvents')
  
        let a = document.createElement('a')
  
        a.download = filename + '.webm'
  
        a.href = window.URL.createObjectURL(blob)
  
        // a.dataset.downloadurl = ['text/json', a.download, a.href].join(':')
  
        e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
  
        a.dispatchEvent(e)
      })
    } else {
      data = JSON.stringify({
        // infos: this._infos, // information from tile_path. Since the image is what we provided, info is redundent.
        tile_path: this._tilePath,
        focus0: this._focus0,
        focus_history: this._focus_history,
        selection_history: this._sel_history,
        gazer_status: null,
      })
    }


    let blob = new Blob([data], {type: 'text/json'}),

        e = document.createEvent('MouseEvents'),

        a = document.createElement('a')

    a.download = filename

    a.href = window.URL.createObjectURL(blob)

    a.dataset.downloadurl = ['text/json', a.download, a.href].join(':')

    e.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)

    a.dispatchEvent(e)

  }

  async _init(tilePath) {
    if (!tilePath || this._inited) return
    // console.time('init')

    this._tilePath = tilePath;

    this._inited = true
    this.setState({ inited: true })
    try {
      let canvas = this.refs.canvas
      let type = getFileTypeByURL(tilePath)
      if (type === 'png' || type === 'jpg' || type === 'jpeg') {
        let img = new window.Image()
        await new Promise(resolve => {
          img.onload = async () => {
            this._thumbnail = img
            this._thumbnailLevel = 'thumbnail_only'
            this._infos = {
              width: this._thumbnail.width,
              height: this._thumbnail.height,
              k: (canvas.width / canvas.height) / (this._thumbnail.width / this._thumbnail.height) > 1 ? 'height' : 'width'
            }
            resolve()
          }
          img.src = tilePath
        })
      } else {
        // this._infos = JSON.parse(JSON.stringify(await vipsFn.getInfos(tilePath)))
        this._infos = await vipsFnPromise('getInfos', [tilePath])
        if(!('openslide.mpp-x' in this._infos)) {
          alert('Warning!!! ' + this._infos['filename'] + ' has no built-in resolution information. Assuming 0.025um/px, i.e. 400x');
          this._infos['openslide.mpp-x'] = 0.025;
          this._infos['openslide.mpp-y'] = 0.025;
        }
        this._infos.k = (canvas.width / canvas.height) / (this._infos.width / this._infos.height) > 1 ? 'height' : 'width'
        let k = (screenSize.width / screenSize.height) / (this._infos.width / this._infos.height) > 1 ? 'height' : 'width'
        let downSample = this._infos[k] / screenSize[k]
        let maxLevel = +this._infos['openslide.level-count'] - 1
        if (+this._infos[`openslide.level[${maxLevel}].downsample`] < downSample / 3) {
          // this._thumbnail = await jpgBuffer2BitmapAsync(await vipsFn.getThumbnail(tilePath, this._infos['slide-associated-images'].split(', ').includes('thumbnail') ? {associated: 'thumbnail'} : {level: maxLevel}))
          this._thumbnail = await jpgBuffer2ImageAsync(await vipsFnPromise('getThumbnail', [tilePath, this._infos['slide-associated-images'].split(', ').includes('thumbnail') ? { associated: 'thumbnail' } : { level: maxLevel }]))
          this._thumbnailLevel = 'thumbnail'
        } else {
          this._thumbnailLevel = this._getLevel(downSample, 1.5)
          // this._thumbnail = await jpgBuffer2BitmapAsync(await vipsFn.getImage(tilePath, {level: this._thumbnailLevel}))
          this._thumbnail = await jpgBuffer2ImageAsync(await vipsFnPromise('getImage', [tilePath, { level: this._thumbnailLevel }]))
        }
      }
      this._renderThumbnail();
      this._renderOverview();
      console.log(this.props);
      if(this.props.gazerStatus) {
        this.props.gazerStatus.history.length = 0;  // clear history, so only desired history are logged
        this.props.gazerStatus.mouse_clicks.length = 0;  // clear history, so only desired history are logged
      }
      this._focus_history.length = 0;  // clear history, so only desired history are logged
      this.setState({ loaded: true })
    } catch (e) {
      console.error(e)
      this.setState({ error: e.message })
    }
    // console.timeEnd('init')
  }

  _getLevel(downSample, scale = 1) {
    if (this._thumbnailLevel === 'thumbnail_only') return 'thumbnail_only'
    if (downSample <= 1) return 0
    let k = this._infos.k
    let maxLevel = +this._infos['openslide.level-count'] - 1
    if (this._thumbnailLevel === 'thumbnail' && (this._infos[k] / this._thumbnail[k] < downSample / scale || +this._infos[`openslide.level[${maxLevel}].downsample`] < downSample / scale / 7)) return 'thumbnail'
    for (let i = +this._infos['openslide.level-count'] - 1; i > -1; i--) if (+this._infos[`openslide.level[${i}].downsample`] < downSample / scale) return i
  }

  _translateMiniboxChange() {
    let sx = (this.refs.minibox.offsetLeft + 1) * 4 * this.initScale;
    let sy = (this.refs.minibox.offsetTop + 1) * 4 * this.initScale;

    let canvas = this.refs.canvas;
    let { width, height } = canvas
    let k = this._infos.k
    let downSample = this._thumbnail[k] / canvas[k] / this._zoom

    this._left = ((this._thumbnail.width - width * downSample) / 2 - sx) / this._thumbnail[k];
    this._top = ((this._thumbnail.height - height * downSample) / 2 - sy) / this._thumbnail[k];
    this._changed = true;
  }

  _setOverviewCanvasSize() {
    let canvas = this.refs.canvas;
    let { width, height } = canvas
    let k = this._infos.k
    let downSample = this._thumbnail[k] / canvas[k] / this._zoom
    let w = this._thumbnail.width / downSample > width ? width * downSample : this._thumbnail.width
    let h = this._thumbnail.height / downSample > height ? height * downSample : this._thumbnail.height
    let sx = Math.max((this._thumbnail.width - width * downSample) / 2 - this._left * this._thumbnail[k], 0)
    let sy = Math.max((this._thumbnail.height - height * downSample) / 2 - this._top * this._thumbnail[k], 0)
    let dw = w / downSample
    let dh = h / downSample
    let dx = (width - dw) / 2 + this._thumbnail[k] / downSample * this._left + (sx - (this._thumbnail.width - w) / 2) / downSample
    let dy = (height - dh) / 2 + this._thumbnail[k] / downSample * this._top + (sy - (this._thumbnail.height - h) / 2) / downSample
    let sw = Math.min((width - dx) * downSample, w, this._thumbnail.width - sx)
    let sh = Math.min((height - dy) * downSample, h, this._thumbnail.height - sy)
    dw = sw / downSample
    dh = sh / downSample
    
    this.refs.overview.width = dw / 4
    this.refs.overview.height = dh / 4
    this.initScale = downSample
  }

  _renderMiniBox(sx, sy, sw, sh) {
    let minibox = this.refs.minibox;
    minibox.style.left = (sx / this.initScale / 4 - 1) + 'px';
    minibox.style.top = (sy / this.initScale / 4 - 1) + 'px';
    minibox.style.width = sw / this.initScale / 4 + 'px';
    minibox.style.height = sh / this.initScale /  4 + 'px';
  }

  _renderOverview() {
    this._setOverviewCanvasSize()

    let canvas = this.refs.overview
    let ctx = canvas.getContext('2d')

    let { width, height } = canvas
    if (this._degree % 180 !== 0) [width, height] = [height, width]
    ctx.clearRect(0, 0, width, height)
    
    let k = this._infos.k
    let downSample = this._thumbnail[k] / canvas[k] / this._zoom
    let w = this._thumbnail.width / downSample > width ? width * downSample : this._thumbnail.width
    let h = this._thumbnail.height / downSample > height ? height * downSample : this._thumbnail.height

    let sx = Math.max((this._thumbnail.width - width * downSample) / 2 - this._left * this._thumbnail[k], 0)
    let sy = Math.max((this._thumbnail.height - height * downSample) / 2 - this._top * this._thumbnail[k], 0)
    let dw = w / downSample
    let dh = h / downSample
    let dx = (width - dw) / 2 + this._thumbnail[k] / downSample * this._left + (sx - (this._thumbnail.width - w) / 2) / downSample
    let dy = (height - dh) / 2 + this._thumbnail[k] / downSample * this._top + (sy - (this._thumbnail.height - h) / 2) / downSample
    let sw = Math.min((width - dx) * downSample, w, this._thumbnail.width - sx)
    let sh = Math.min((height - dy) * downSample, h, this._thumbnail.height - sy)
    dw = sw / downSample
    dh = sh / downSample

    ctx.drawImage(this._thumbnail, sx, sy, sw, sh, dx, dy, dw, dh);
    this._renderMiniBox(sx, sy, sw, sh);
  }

  _renderThumbnail() {
    if (!this._thumbnail) return
    // console.time('renderThumbnail')

    let canvas = this.refs.canvas
    let ctx = canvas.getContext('2d')

    let { width, height } = canvas
    if (this._degree % 180 !== 0) [width, height] = [height, width]
    ctx.clearRect(0, 0, width, height)

    // let k = (width / height) / (this._thumbnail.width / this._thumbnail.height) > 1 ? 'height' : 'width'
    let k = this._infos.k
    let downSample = this._thumbnail[k] / canvas[k] / this._zoom
    let w = this._thumbnail.width / downSample > width ? width * downSample : this._thumbnail.width
    let h = this._thumbnail.height / downSample > height ? height * downSample : this._thumbnail.height
    // console.log('width,height', width, height)

    let sx = Math.max((this._thumbnail.width - width * downSample) / 2 - this._left * this._thumbnail[k], 0)
    let sy = Math.max((this._thumbnail.height - height * downSample) / 2 - this._top * this._thumbnail[k], 0)
    let dw = w / downSample
    let dh = h / downSample
    let dx = (width - dw) / 2 + this._thumbnail[k] / downSample * this._left + (sx - (this._thumbnail.width - w) / 2) / downSample
    let dy = (height - dh) / 2 + this._thumbnail[k] / downSample * this._top + (sy - (this._thumbnail.height - h) / 2) / downSample
    let sw = Math.min((width - dx) * downSample, w, this._thumbnail.width - sx)
    let sh = Math.min((height - dy) * downSample, h, this._thumbnail.height - sy)
    dw = sw / downSample
    dh = sh / downSample

    // https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasRenderingContext2D/drawImage
    ctx.drawImage(this._thumbnail, sx, sy, sw, sh, dx, dy, dw, dh);
    // console.log(`dx: ${dx}, dy: ${dy}, dw: ${dw}, dh: ${dh}\nsx: ${sx}, sy: ${sy}, sw: ${sw}, sh: ${sh}`);
    this._renderMiniBox(sx, sy, sw, sh);

    //console.log(sx, sy, '\n', sw, sh, '\n', dx, dy, '\n', dw, dh)
    // console.timeEnd('renderThumbnail')
    let focus_x=sx+sw/2
    let focus_y=sy+sh/2
    let focus_zoom=this._zoom
    let tmp_date=new Date();
    let elem = this.refs.canvas;
    let cvsTop = 0;
    let cvsLeft = 0;
    let cvsWidth = elem.offsetWidth;
    let cvsHeight = elem.offsetHeight;
    while(elem) {
    	cvsTop += elem.offsetTop;
    	cvsLeft += elem.offsetLeft;
    	elem = elem.offsetParent;
    }

    let dict={
      'X': focus_x,
      'Y': focus_y,
      'ZoomRate': focus_zoom,
      // 'Time': focus_time,
      'sx': sx,
      'sy': sy,
      'sw': sw,
      'sh': sh,
      'ts': tmp_date.valueOf(),
      'dx': dx,
      'dy': dy,
      'dw': dw,
      'dh': dh,
      // y_display = (y_gaze - canvas_top) / canvas_width * display_width
      // x_display = (x_gaze - canvas_left) / canvas_height * display_height
      'canvas_left': cvsLeft,
      'canvas_top': cvsTop,
      'canvas_width': cvsWidth,
      'canvas_height': cvsHeight,
      'window_h': window.innerHeight, // the gazer reference coordinate space
      'window_w': window.innerWidth,
    }
    this._focus_history.push(dict)
    if(!this._focus0) {
        this._focus0 = { ...dict };
    }

    let globalDownSample = this._infos[k] / canvas[k] / this._zoom
    this._currentState = {
      globalDownSample,
      level: this._getLevel(globalDownSample),
      sx: sx / this._thumbnail.width,
      sy: sy / this._thumbnail.height,
      sw: sw / this._thumbnail.width,
      sh: sh / this._thumbnail.height,
      dx,
      dy,
      dw,
      dh,
      cvsLeft,
      cvsTop,
    }
    // console.log(sx / this._thumbnail.width * this._infos.width / globalDownSample - sx / downSample)
  }

  _searchAndRenderTile() {
    if (!this._currentState) return
    let { level, sx, sy, sw, sh } = this._currentState
    if (level >= this._thumbnailLevel) return
    let tileSize = Viewer.tileSize
    let width = this._infos[`openslide.level[${level}].width`]
    let height = this._infos[`openslide.level[${level}].height`]

    let x0 = sx * width
    let x1 = x0 + sw * width
    let y0 = sy * height
    let y1 = y0 + sh * height
    x0 = ~~(x0 / tileSize) * tileSize
    x1 = x1 % tileSize ? ~~(x1 / tileSize) * tileSize : x1 - tileSize
    y0 = ~~(y0 / tileSize) * tileSize
    y1 = y1 % tileSize ? ~~(y1 / tileSize) * tileSize : y1 - tileSize
    // console.log(x0, x1, y0, y1, sx + sw, sy + sh)

    let needRenderTile = []
    let needGetTile = []
    for (let x = x0; x <= x1; x += tileSize) {
      for (let y = y0; y <= y1; y += tileSize) {
        let k = `${level}.${x}.${y}`
        if (this._tile[k]) {
          needRenderTile.push(k)
          let index = this._tileKeyList.indexOf(k)
          if (index !== -1) {
            this._tileKeyList.splice(index, 1)
            this._tileKeyList.push(k)
          }
        } else {
          let { full, keys } = this._searchLowerTile(k)
          keys.forEach(i => needRenderTile.includes(i) ? undefined : needRenderTile.push(i))
          if (!full) {
            needGetTile.push(k)
            let higherTile = this._searchHigherTile(k)
            if (higherTile) higherTile.forEach(i => needRenderTile.includes(i) ? undefined : needRenderTile.unshift(i)) // 因先forEach后unshift，所以插入的顺序会相反
          }
        }
      }
    }
    needRenderTile.forEach(k => this._renderTile(k, false))
    needGetTile.forEach(k => this._getTile(k, this._tile))
    // console.log(needRenderROI, needGetROI)
  }

  _searchLowerTile(KofTile) {
    let [tileLevel, left, top] = splitKofTile(KofTile)
    if (tileLevel === 0) return { full: false, keys: [] }
    let tileSize = Viewer.tileSize
    let level = tileLevel - 1

    let x0 = left / this._infos[`openslide.level[${tileLevel}].width`] * this._infos[`openslide.level[${level}].width`]
    let x1 = (left + tileSize) / this._infos[`openslide.level[${tileLevel}].width`] * this._infos[`openslide.level[${level}].width`]
    let y0 = top / this._infos[`openslide.level[${tileLevel}].height`] * this._infos[`openslide.level[${level}].height`]
    let y1 = (top + tileSize) / this._infos[`openslide.level[${tileLevel}].height`] * this._infos[`openslide.level[${level}].height`]
    x0 = ~~(x0 / tileSize) * tileSize
    x1 = x1 % tileSize ? ~~(x1 / tileSize) * tileSize : x1 - tileSize
    y0 = ~~(y0 / tileSize) * tileSize
    y1 = y1 % tileSize ? ~~(y1 / tileSize) * tileSize : y1 - tileSize

    let tileList = []
    for (let x = x0; x <= x1; x += tileSize) for (let y = y0; y <= y1; y += tileSize) tileList.push(`${level}.${x}.${y}`)
    let keys = tileList.filter(k => this._tile[k])
    return { full: tileList.length === keys.length, keys }
  }

  _searchHigherTile(KofTile) {
    let [tileLevel, left, top] = splitKofTile(KofTile)
    if (tileLevel === +this._infos['openslide.level-count'] - 1 || tileLevel >= +this._thumbnailLevel - 1) return
    let tileSize = Viewer.tileSize
    let level = tileLevel + 1

    let x0 = left / this._infos[`openslide.level[${tileLevel}].width`] * this._infos[`openslide.level[${level}].width`]
    let x1 = (left + tileSize) / this._infos[`openslide.level[${tileLevel}].width`] * this._infos[`openslide.level[${level}].width`]
    let y0 = top / this._infos[`openslide.level[${tileLevel}].height`] * this._infos[`openslide.level[${level}].height`]
    let y1 = (top + tileSize) / this._infos[`openslide.level[${tileLevel}].height`] * this._infos[`openslide.level[${level}].height`]
    x0 = ~~(x0 / tileSize) * tileSize
    x1 = x1 % tileSize ? ~~(x1 / tileSize) * tileSize : x1 - tileSize
    y0 = ~~(y0 / tileSize) * tileSize
    y1 = y1 % tileSize ? ~~(y1 / tileSize) * tileSize : y1 - tileSize

    let tileList = []
    for (let x = x0; x <= x1; x += tileSize) for (let y = y0; y <= y1; y += tileSize) tileList.push(`${level}.${x}.${y}`)
    let result = []
    tileList.forEach(k => {
      if (this._tile[k]) {
        result.push(k)
      } else {
        let tmp = this._searchHigherTile(k)
        if (tmp) result.push(...tmp)
      }
    })
    return result
  }

  async _getTile(KofTile, _tile) {
    if (this._gettingTile.includes(KofTile)) return
    this._gettingTile.push(KofTile)
    let tileSize = Viewer.tileSize
    let [level, left, top] = splitKofTile(KofTile)
    // let ROI = await jpgBuffer2BitmapAsync(await vipsFn.getImage(this.props.tilePath, {level, left, top, width: ROISize, height: ROISize}))
    let tile = await jpgBuffer2ImageAsync(await vipsFnPromise('getImage', [this.props.tilePath, { level, left, top, width: tileSize, height: tileSize }]))
    if (_tile !== this._tile) {
      URL.revokeObjectURL(tile.src)
      return
    }
    _tile[KofTile] = tile
    this._tileKeyList.push(KofTile)
    this._changedTile.push(KofTile)
    this._gettingTile.splice(this._gettingTile.indexOf(KofTile), 1)
    if (this._tileKeyList.length > Viewer.maxTileCache) {
      let k = this._tileKeyList.splice(0, 1)[0]
      URL.revokeObjectURL(_tile[k].src)
      delete _tile[k]
      // console.info('销毁ROI,k:', k)
    }
  }

  _renderTile(KofTile, needCheck = true) {
    let tile = this._tile[KofTile]
    if (!tile) return
    let { globalDownSample, level, sx, sy, sw, sh, dx, dy } = this._currentState
    let [tileLevel, x, y] = splitKofTile(KofTile)
    let width = this._infos[`openslide.level[${tileLevel}].width`]
    let height = this._infos[`openslide.level[${tileLevel}].height`]
    if (needCheck && (tileLevel !== level || x / width >= sx + sw || y / height >= sy + sh || (x + tile.width) / width <= sx || (y + tile.height) / height <= sy)) return
    this.refs.canvas.getContext('2d').drawImage(
      tile,
      dx + (x / width - sx) * this._infos.width / globalDownSample,
      dy + (y / height - sy) * this._infos.height / globalDownSample,
      tile.width / width * this._infos.width / globalDownSample,
      tile.height / height * this._infos.height / globalDownSample
    )
  }

  _destroy() {
    this._inited = false
    this._currentState = null
    this._infos = null

    for (let k in this._tile) URL.revokeObjectURL(this._tile[k].src)
    this._tile = {}
    this._tileKeyList = []

    if (!this._thumbnail) return
    URL.revokeObjectURL(this._thumbnail.src)
    this._thumbnail = null
    this._thumbnailLevel = null
  }

  _initListener() {
    this.refs.mainDOM.addEventListener('wheel', this._wheel)
    this.refs.canvas.addEventListener('mousedown', this._mouseDown)
    window.addEventListener('mousemove', this._mouseMove)
    window.addEventListener('mouseup', this._mouseUp)
    this.refs.confirm_button.addEventListener('click', this._click_confirm)
    // this.refs.typea_button.addEventListener('click', this._click_typea)
    // this.refs.typeb_button.addEventListener('click', this._click_typeb)
    // this.refs.typec_button.addEventListener('click', this._click_typec)
    this.refs.cancel_button.addEventListener('click', this._click_cancel)
    // minibox
    this.refs.minibox.addEventListener('mousedown', this._miniboxMouseDown)
    this._animate()
  }

  _destroyListener() {
    this.refs.mainDOM.removeEventListener('wheel', this._wheel)
    this.refs.canvas.removeEventListener('mousedown', this._mouseDown)
    window.removeEventListener('mousemove', this._mouseMove)
    window.removeEventListener('mouseup', this._mouseUp)
    this.refs.confirm_button.removeEventListener('click', this._click_confirm)
    // this.refs.typea_button.removeEventListener('click', this._click_typea)
    // this.refs.typeb_button.removeEventListener('click', this._click_typeb)
    // this.refs.typec_button.removeEventListener('click', this._click_typec)
    this.refs.cancel_button.removeEventListener('click', this._click_cancel)
    // minibox
    this.refs.minibox.removeEventListener('mousedown', this._miniboxMouseDown)
    window.cancelAnimationFrame(this._animateId)
  }

  _click_type(type = 'confirm') {
    if(this._curSelection) {
      this._curSelection.type = type;
      this._sel_history.push({'ts': new Date().valueOf(), 'sel': this._curSelection});
      this._selection.push(this._curSelection);
      this._curSelection = null;
      this._renderSelections();
      this._renderCurrentSelection();
    }
  }
  _click_confirm = this._click_type.bind(this, 'confirmed')
  _click_typea = this._click_type.bind(this, 'typea')
  _click_typeb = this._click_type.bind(this, 'typeb')
  _click_typec = this._click_type.bind(this, 'typec')
  _click_cancel = () => {
    if(this._curSelection) {
      this._curSelection = null;
      this._renderCurrentSelection();
    }
  }

  _wheel = e => {
    e.preventDefault()
    e.stopPropagation()
    if (!this.state.loaded) return

    let diff = this._zoom * 0.1
    e.deltaY > 0 ? this._zoom -= diff : this._zoom += diff
    this._changed = true
  }

  _cvtCoord_Screen2ImageRel = (x, y) => {
    const {cvsLeft, cvsTop} = this._currentState;
    return this._cvtCoord_Canvas2ImageRel(x - cvsLeft, y - cvsTop);
  }

  _cvtCoord_ImageRel2Screen = (x, y) => {
    const [tx, ty] = this._cvtCoord_ImageRel2Canvas(x, y);
    const {cvsLeft, cvsTop} = this._currentState;
    return [tx + cvsLeft, ty + cvsTop];
  }

  _cvtCoord_Canvas2ImageRel = (x, y) => {
    const {sx, sy, sw, sh, dx, dy, dw, dh} = this._currentState;

    // limit pos
    x = Math.min(Math.max(x, dx), dx + dw);
    y = Math.min(Math.max(y, dy), dy + dh);

    return [
      (x - dx) / dw * sw + sx,
      (y - dy) / dh * sh + sy,
    ]
  }

  _cvtCoord_ImageRel2Canvas = (x, y) => {
    const {sx, sy, sw, sh, dx, dy, dw, dh} = this._currentState;
    return [
      (x - sx) / sw * dw + dx,
      (y - sy) / sh * dh + dy,
    ]
  }

  __renderSelection = (obj) => {
    let {x1, y1, x2, y2, type} = obj;
    const ctx = this.refs.canvas.getContext('2d');
    if(type === 'confirmed') {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#8080ff';
    } else if(type === 'typea') {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ff0000';
    } else if(type === 'typeb') {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00ff00';
    } else if(type === 'typec') {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffff00';
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000000';
    }
    [x1, y1] = this._cvtCoord_ImageRel2Canvas(x1, y1);
    [x2, y2] = this._cvtCoord_ImageRel2Canvas(x2, y2);
    x1 *= devicePixelRatio;
    y1 *= devicePixelRatio;
    x2 *= devicePixelRatio;
    y2 *= devicePixelRatio;
    if(x1 > x2) {
      [x1, x2] = [x2, x1];
    }
    if(y1 > y2) {
      [y1, y2] = [y2, y1];
    }
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  _renderSelections = () => {
    for(let sel of this._selection) {
      this.__renderSelection(sel);
    }
  }
  _renderCurrentSelection = () => {
    if(this._curSelection) {
      let {x1, y1, x2, y2} = this._curSelection;
      [x1, y1] = this._cvtCoord_ImageRel2Screen(x1, y1);
      [x2, y2] = this._cvtCoord_ImageRel2Screen(x2, y2);
      if(x1 > x2) {
        [x1, x2] = [x2, x1];
      }
      if(y1 > y2) {
        [y1, y2] = [y2, y1];
      }
      this.refs.currentsel.style.display = 'block';
      this.refs.currentsel.style.left = (x1 - 2) + 'px';
      this.refs.currentsel.style.top = (y1 - 2) + 'px';
      this.refs.currentsel.style.width = (x2 - x1) + 'px';
      this.refs.currentsel.style.height = (y2 - y1) + 'px';
      this.refs.dropmenu.style.display = 'block';
      this.refs.dropmenu.style.left = x2 + 'px';
      this.refs.dropmenu.style.top = y2 + 'px';
    } else {
      this.refs.currentsel.style.display = 'none';
      this.refs.dropmenu.style.display = 'none';
    }
  }

  _mouseDown = e => {
    e.preventDefault()
    e.stopPropagation()
    if (!this.state.loaded) return

    if (e.button === 0 || e.button === 1) {
      this._moveActive = true
    }
    if (e.button === 2) {
      if (!this.state.loaded) return
      this._selActive = true;
      this._lastSelectTimestamp = new Date()

      const [tx, ty] = this._cvtCoord_Screen2ImageRel(e.clientX, e.clientY);
      this._curSelection = {
        x1: tx,
        y1: ty,
        x2: tx,
        y2: ty,
        type: 'none',
      };
      this._renderCurrentSelection();
    }
  }

  _mouseMove = e => {
    if (!this.state.loaded) return

    if (this._moveActive) {
      e.preventDefault()
      e.stopPropagation()

      let vec = vec2.rotate([], [e.movementX, e.movementY], [0, 0], -this._degree * Math.PI / 180)
      this._left += vec[0] * this._currentState.globalDownSample / this._infos[this._infos.k]
      this._top += vec[1] * this._currentState.globalDownSample / this._infos[this._infos.k]
      this._changed = true
      // console.log('!!!', e.movementX / canvas.width, e.movementY / canvas.height)
    }

    if (this._selActive) {
      e.preventDefault()
      e.stopPropagation()

      const [tx, ty] = this._cvtCoord_Screen2ImageRel(e.clientX, e.clientY);
      this._curSelection.x2 = tx;
      this._curSelection.y2 = ty;
      this._renderCurrentSelection();
    }
  }

  _mouseUp = e => {
    e.preventDefault()
    // e.stopPropagation()
    if (this.isMouseInMinibox) this._miniboxMouseUp(e);

    if (e.button === 0 || e.button === 1) this._moveActive = false
    if (e.button === 2) {
      this._selActive = false

      const [tx, ty] = this._cvtCoord_Screen2ImageRel(e.clientX, e.clientY);
      this._curSelection.x2 = tx;
      this._curSelection.y2 = ty;
      if((this._curSelection.x1 === this._curSelection.x2) && (this._curSelection.y1 === this._curSelection.y2)) {
        this._curSelection.x1 -= 0.01;
        this._curSelection.y1 -= 0.01;
        this._curSelection.x2 += 0.01;
        this._curSelection.y2 += 0.01;
      }
      this._renderCurrentSelection();
    }
  }

  _miniboxMouseDown = e => {
    if (this._moveActive) return;

    e.preventDefault();
    e.stopPropagation();

    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.isMouseInMinibox = true;
    this.refs.minibox.onmouseup = this._miniboxMouseUp;
    this.refs.minibox.onmousemove = this._miniboxMouseMove;
  }

  _miniboxMouseMove = e => {
    if (this._moveActive) return;

    e.preventDefault();
    e.stopPropagation();

    if (!this.isMouseInMinibox) return;

    this.offsetX = this.lastX - e.clientX;
    this.offsetY = this.lastY - e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    
    let newLeft = 0, newTop = 0;
    newLeft = Math.max((this.refs.minibox.offsetLeft - this.offsetX), 0) + 'px';
    newTop = Math.max((this.refs.minibox.offsetTop - this.offsetY), 0) + 'px';
    newLeft = Math.min((this.refs.overview.width - this.refs.minibox.offsetWidth), (this.refs.minibox.offsetLeft - this.offsetX)) + 'px';
    newTop = Math.min((this.refs.overview.height - this.refs.minibox.offsetHeight), (this.refs.minibox.offsetTop - this.offsetY)) + 'px';

    this.refs.minibox.style.left = newLeft;
    this.refs.minibox.style.top = newTop;
    this._translateMiniboxChange();
  }

  _miniboxMouseUp = e => {
    if (!this.isMouseInMinibox) return;

    e.preventDefault();
    // e.stopPropagation();

    this.isMouseInMinibox = false;
    this.refs.minibox.onmouseup = null;
    this.refs.minibox.onmousemove = null;
  }

  _animate = () => {
    if (this._changed) {
      this._ensureScaleLimit();

      this._renderThumbnail()
      this._searchAndRenderTile()
      this._changed = false
      this._changedTile.length = 0

      this._renderSelections();
      this._renderCurrentSelection();
    } else if (this._changedTile.length) {
      this._changedTile.forEach(i => this._renderTile(i))
      this._changedTile.length = 0

      this._renderSelections();
      this._renderCurrentSelection();
    }
    this._animateId = window.requestAnimationFrame(this._animate)
    const curScale = this.getCurrentScale();
    if(curScale >= 10) {
      this.refs.scalingval.innerText = curScale.toFixed(1) + 'x';
    } else if(curScale >= 1) {
      this.refs.scalingval.innerText = curScale.toFixed(2) + 'x';
    } else {
      this.refs.scalingval.innerText = curScale.toFixed(3) + 'x';
    }
    this.updateScaleBottom();
  }

  _resize() {
    let canvas = this.refs.canvas
    let pixelRatio = window.devicePixelRatio
    canvas.width = this.props.layoutWidth * pixelRatio
    canvas.height = this.props.layoutHeight * pixelRatio
    this._degree = 0
    // canvas.getContext('2d').imageSmoothingEnabled = false
    this._changed = true
  }

  resetPosition() {
    this._zoom = 1
    this._left = 0
    this._top = 0
    this._changed = true
    this._ensureScaleLimit()
  }

  rotate(isClockwise = true) {
    let degree = isClockwise ? 90 : -90
    this._degree += degree
    let canvas = this.refs.canvas
    let ctx = canvas.getContext('2d')
    ctx.rotate(degree * Math.PI / 180)

    let { width, height } = canvas
    if (this._degree % 180 !== 0) [width, height] = [height, width]
    isClockwise ? ctx.translate(0, -height) : ctx.translate(-width, 0)
    this._changed = true
  }

  getImageBlobAsync(type) {
    if (type === 'jpg') type = 'jpeg'
    return new Promise(res => this.refs.canvas.toBlob(res, `image/${type}`))
  }

  updateScaleBottom = () => {
    this.refs.scalingvalbottom.innerText = this.refs.scalingval.innerText;
    const cssPixel = 150;
    const physicalMM = cssPixel / (25.4 / 96) / this._zoom / this.windowscale;
    if (physicalMM <= 0.5) {
      this.refs.scale.innerText = (1000 * physicalMM).toFixed(2) + 'um';
    } else {
      this.refs.scale.innerText = physicalMM.toFixed(2) + 'mm';
    }
  }

  render() {
    return (
      <div ref='mainDOM' style={{ position: 'relative', width: this.props.layoutWidth, height: this.props.layoutHeight }} >
        <canvas ref='canvas' />
        <div style={{position: 'fixed', right: '500px', top: '50px'}}>
          <canvas ref='overview' />
          <div ref='minibox' style={{position: 'absolute', width: 0, height: 0, left: 0, top: 0, border: '1px solid black', cursor: 'move'}}></div>
        </div>
        <div ref='currentsel' style={{ position: 'fixed', width: 100, height: 100, left: 0, top: 50, display: 'none', border: '2px solid blue', pointerEvents: 'none'}} />
        <div ref='dropmenu' style={{ position: 'fixed', left: 0, top: 0, border: '1px solid #666666', background: '#ffffff88'}}>
          <button ref='confirm_button'>Confirm</button>
          {/* <button ref='typea_button'>Type-A</button>
          <button ref='typeb_button'>Type-B</button>
          <button ref='typec_button'>Type-C</button> */}
          <button ref='cancel_button'>Cancel</button>
        </div>
        <div ref='scalingval' style={{ position: 'fixed', width: '100vw', display: 'block', fontSize: 50, height: 50, left: 0, top: 50, pointerEvents: 'none'}}>0.0x</div>
        <div ref='scalingvalbottom' style={{ position: 'fixed', width: 150, fontSize: 15, height: 20, left: 10, bottom: 50}}>0.0x</div>
        <div ref='scale' style={{position: 'fixed', width: 150, height: 20, fontSize: 15, left: 10, bottom: 20, border: '1px solid black', textAlign: 'center'}}>0.00mm</div>
        <StateCover {...this.state} />
      </div>
    )
  }
}
