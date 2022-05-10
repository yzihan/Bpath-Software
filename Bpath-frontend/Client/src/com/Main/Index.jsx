import React, { createRef } from 'react'
import { Tooltip, Button } from '@material-ui/core'
import { Inbox, Refresh, RotateLeft, RotateRight, Collections,SaveAlt } from '@material-ui/icons'
import { selectFile, getFileTypeByURL, blob2BufferAsync } from '../../core'
import Viewer from '../Viewer/Index'
import './Index.css'
const remote = global.nodeRequire('electron').remote
const fs = global.nodeRequire('fs')

const getUsableWidth = () => {
  return Math.max(window.innerWidth * 0.5, window.innerWidth - 500);
  // min-width: 50vw;
  // width: calc( 100vw - 500px);
}

const getUsableHeight = () => {
  return window.innerHeight - 50;
}

export default class Main extends React.Component {
  constructor(props) {
    super(props)
    this.viewer = createRef();
  }
  componentDidMount() {
    window.addEventListener('resize', this._resize)
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this._resize)
  }

  state = {
    layoutWidth: getUsableWidth(),
    layoutHeight: getUsableHeight(),
    lowPower: false,
    highPower: false,
    currentState: [],
  }

  _resize = () => this.setState({
    layoutWidth: getUsableWidth(),
    layoutHeight: getUsableHeight()
  })

  _selectFile = () => selectFile(this.props.inputFn)

  _reset = () => this.viewer.current.resetPosition()

  _counterclockwise = () => this.viewer.current.rotate(false)

  _clockwise = () => this.viewer.current.rotate(true)

  _savefocushistory = () => this.viewer.current.savejson()

  _save = async () => {
    let path = remote.dialog.showSaveDialog(remote.getCurrentWindow(), {
      filters: [
        { name: 'JPG Image', extensions: ['jpg', 'jpeg'] },
        { name: 'PNG Image', extensions: ['png'] },
        { name: 'WEBP Image', extensions: ['webp'] },
        { name: 'Images', extensions: ['jpg', 'png', 'webp'] }
      ]
    })
    if (!path) return
    let type = getFileTypeByURL(path)
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(type)) return remote.dialog.showErrorBox('Save Image Type Error!', 'Please choose jpg/png/webp image type to save.')
    let blob = await this.viewer.current.getImageBlobAsync(type)
    fs.writeFile(path, await blob2BufferAsync(blob), e => { if (e) remote.dialog.showErrorBox('Save Image Error!', 'Please choose other image type to save.') })
  }

  toggleLowPower = (e) => {
    e.preventDefault();
    const newState = {
      lowPower: !this.state.lowPower,
      highPower: this.state.highPower,
    }
    if(e.target.tagName === 'INPUT') {
      newState.lowPower = e.target.checked;
    }
    if(newState.highPower && !newState.lowPower) {
      newState.highPower = false;
    }
    setImmediate(() => {
      this.setState(newState);
    })
  }

  toggleHighPower = (e) => {
    e.preventDefault();
    const newState = {
      lowPower: this.state.lowPower,
      highPower: !this.state.highPower,
    }
    if(e.target.tagName === 'INPUT') {
      newState.highPower = e.target.checked;
    }
    if(newState.highPower && !newState.lowPower) {
      newState.lowPower = true;
    }
    setImmediate(() => {
      this.setState(newState);
    })
  }

  doNothing = (e) => {
    console.log(e.target.checked)
  }

  resolutionCallbacks = [];
  lastResolutionLimit = -1;
  registerResolutionLimitCallback = (cbk) => {
    this.resolutionCallbacks.push(cbk);
  }
  unregisterResolutionLimitCallback = (cbk) => {
    const i = this.resolutionCallbacks.indexOf(cbk);
    if(i >= 0) {
      this.resolutionCallbacks.splice(i, 1);
    }
  }
  ensureResolutionLimit = () => {
    let limit = 400;
    if(!this.state.highPower) {
      limit = 100;
    }
    if(!this.state.lowPower) {
      limit = 10;
    }
    for(let cbk of this.resolutionCallbacks) {
      cbk(limit);
    }
  }

  updateCurrentState = (state) => {
    this.setState({
      currentState: [state.sx, state.sy, state.sw, state.sh, state.dx, state.dy, state.dw, state.dh, state.cvsLeft, state.cvsTop],
    });
    console.log(this.state.currentState);
  }

  render() {
    this.ensureResolutionLimit();
    return (
      <div className='Main'>
        <div className='Main-bar'>
          <div>
            <Tooltip title='Open new image'>
              <Button className='Main-btn' style={{ width: '150px', color: '#40a9ff' }} onClick={this._selectFile}>
                <Inbox className='Main-btn-icon-with-text' />open...
              </Button>
            </Tooltip>
          </div>

          <div>
            <Tooltip title='Reset position and zoom'><Button className='Main-btn' onClick={this._reset}><Refresh /></Button></Tooltip>
            <Tooltip title='Rotate 90° counterclockwise'><Button className='Main-btn' onClick={this._counterclockwise}><RotateLeft /></Button></Tooltip>
            <Tooltip title='Rotate 90° clockwise'><Button className='Main-btn' onClick={this._clockwise}><RotateRight /></Button></Tooltip>
            <Tooltip title='Save focus history'><Button className='Main-btn' onClick={this._savefocushistory}><SaveAlt /></Button></Tooltip>
          </div>

          <div className='Main-bar-end'>
            <Tooltip title='Save the current display image to...'><Button className='Main-btn' onClick={this._save}><Collections /></Button></Tooltip>
          </div>
        </div>

        <Viewer ref={this.viewer} {...this.state} gazerStatus={this.props.gazerStatus} tilePath={this.props.tilePath}
          registerResolutionLimitCallback={this.registerResolutionLimitCallback}
          unregisterResolutionLimitCallback={this.unregisterResolutionLimitCallback}
          updateCurrentState={this.updateCurrentState}
          />
        <div className='Sidebar'>
          <p className='Caption'>任务提示</p>
          <div className='Card'>
            <h2>任务1</h2>
            <ol>
              <li>请在低倍镜下对左侧病理学切片扫描，低倍镜下该切片最多被放大10倍。</li>
              <li>在观察完成后，请用鼠标圈出三个大致区域（如有），并使得该区域可能较多的有丝分裂。</li>
            </ol>
            <h2>任务2</h2>
            <ol>
              <li>在任务1完成后，请切换至高倍镜，此时左侧切片扫描可放大至40倍。</li>
              <li>请在任务1中圈出的每个区域中继续查看，并汇报该区域内连续10个高倍镜下最多的有丝分裂的位置和数量。</li>
            </ol>
            <h2>任务3</h2>
            <ol>
              <li>任务2中汇报的有丝分裂计数是否为本切片扫描的最高计数？该数值是否可用于后续的分级？</li>
              <li>如您认为有必要继续观察该切片，请打开高倍镜，并继续检查。</li>
              <li>如您选择继续检查，同样的，请再检查结束之前圈选最高的连续10个高倍镜区域，并汇报该区域有丝分裂的数量。</li>
            </ol>
          </div>
          <p className='Caption'>放大倍率限制</p>
          <div className='Card'>
            <div className='switch' onClick={this.toggleLowPower}>
              <label htmlFor='low-power-lim'>低倍镜（最多放大100倍=物镜10倍）</label>
              <input type="checkbox" id="low-power-lim" checked={this.state.lowPower} readOnly onChange={this.toggleLowPower}></input>
            </div>
            <div className='switch' onClick={this.toggleHighPower}>
              <label htmlFor='high-power-lim'>高倍镜（最多放大400倍=物镜40倍）</label>
              <input type="checkbox" id="high-power-lim" checked={this.state.highPower} readOnly onChange={this.toggleHighPower}></input>
            </div>
          </div>
          <div style={{marginTop: '30px', marginLeft: '200px'}}>
            {this.state.currentState.map((item, index) => (<div key={index} style={{color: 'black', fontWeight: 'bold', fontSize: '11px'}}>{item.toFixed(6)}</div>))}
          </div>
        </div>
      </div>
    )
  }
}