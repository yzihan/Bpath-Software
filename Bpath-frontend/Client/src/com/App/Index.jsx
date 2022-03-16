import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supportFileType, getFileTypeByURL } from '../../core'
import Init from '../Init/Index'
import Main from '../Main/Index'
// import webgazer from 'webgazer';
import './Index.css';
// import '@tensorflow/tfjs-backend-webgl';
// import '@tensorflow/tfjs-backend-cpu';
const remote = global.nodeRequire('electron').remote

const Gazer = ({setGazerStatus}) => {
  // const [calibrationSkipable, setCalibrationSkipable] = useState(null);
  // const [calibrationPosition, setCalibrationPosition] = useState(null);

  // let [calibrationEnabled] = useState({ gazerReady: false, value: false });
  // let [gazerReady, setGazerReady] = useState(false);

  const videoObj = useRef();

  useEffect(() => {
    window.applyKalmanFilter = true;
    window.saveDataAcrossSessions = false;

    const old_gum = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    const rec_stat = {
      chunks: [],
      stop: ()=>{},
      rec: null,
    };

    if(!navigator.mediaDevices) {
      navigator.mediaDevices = {};
    }
    navigator.mediaDevices.getUserMedia = function(constraint) {
      return new Promise((resolve, reject) => {
        old_gum.call(this, constraint).then((stream) => {
          let recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (e) => {
            rec_stat.chunks.push(e.data);
          }
          const stopProm = new Promise((resolve, reject) => {
            recorder.onstop = function(e) {
              console.log("data available after MediaRecorder.stop() called.");
              resolve(e);
            }
            recorder.onerror = (ev) => {
              let e = ev.error;
              console.warn(e);
              switch(e.name) {
                case 'InvalidStateError':
                  alert("You can't record the video right " +
                                   "now. Try again later.");
                  break;
                case 'SecurityError':
                  alert("Recording the specified source " +
                                   "is not allowed due to security " +
                                   "restrictions.");
                  break;
                default:
                  alert("A problem occurred while trying " +
                                   "to record the video: " + e.name);
                  break;
              }
              reject(e);
            }
          })
          rec_stat.stop = () => {
            console.log('Stopping MediaRecorder');
            rec_stat.rec.stop();
            return stopProm
          }
          rec_stat.rec = recorder;
          recorder.start();
          resolve(stream)
        }, reject);
      })
    }

    const startUp = (async () => {
      if(remote.dialog.showMessageBox(remote.getCurrentWindow(), {
        type: 'info',
        title: 'Camera permission',
        message: 'We are asking permission for accessing web cams to record your gaze target.\nDo you want to enable it?',
        buttons: ['Enable recording', 'Keep recording disabled'],
        defaultId: 0,
        cancelId: 1
      }) === 0) {
        console.log('Starting recording...');

        const gazerStat = {
          base_time: null,
          history: [], mouse_clicks: [],
          recorder_chunks: rec_stat.chunks,
          stop_recorder: () => { return rec_stat.stop() },
          recorder: () => { return rec_stat.rec },
        };

        try {
          let stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user" } });
          var video = videoObj.current;
          video.srcObject = stream;
          video.onloadedmetadata = function(e) {
            video.play();
            gazerStat.base_time = new Date().valueOf();
          };
        } catch(e) {
          console.log(e);
          alert('Error: ' + e);
        }

        setGazerStatus(gazerStat);

        await new Promise((resolve) => {
          setTimeout(resolve, 10000);
        });

        videoObj.current.style.opacity = 0;

      } else {
        console.log('Eye recording disabled.');
      }
      return () => {}
    })();

    return () => {
      startUp.then((v) => {
        v();
      })
    }
  }, [setGazerStatus]);

  return (<>
    <video ref={videoObj} width="320" height="240" style={{position: 'fixed', left: 0, top: 50, opacity: 1, transition: '3s', pointerEvents: 'none'}} muted autoPlay></video>
  </>);
}

export default class App extends React.Component {
  state = {
    gazerStatus: null,
    tilePath: null
  }

  _fileInput = tilePath => {
    if (!supportFileType.includes(getFileTypeByURL(tilePath))) {
      if (
        remote.dialog.showMessageBox(remote.getCurrentWindow(), {
          type: 'warning',
          title: 'Unsupported File Type',
          message: 'This file type may not be supported, are you sure continue to open?',
          buttons: ['yes', 'no'],
          defaultId: 0,
          cancelId: 1
        }) === 1
      ) return
    }
    this.setState({ tilePath })
  }

  setGazerStatus = s => this.setState({ gazerStatus: s });

  render() {
    return (
      <>
        {this.state.tilePath ? <Main inputFn={this._fileInput} tilePath={this.state.tilePath} gazerStatus={this.state.gazerStatus} /> : <Init inputFn={this._fileInput} />}
        <Gazer setGazerStatus={this.setGazerStatus} />
      </>
    );
  }
}
