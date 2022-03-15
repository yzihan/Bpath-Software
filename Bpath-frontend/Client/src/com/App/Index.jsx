import React, { useCallback, useEffect, useState } from 'react'
import { supportFileType, getFileTypeByURL } from '../../core'
import Init from '../Init/Index'
import Main from '../Main/Index'
import webgazer from 'webgazer';
import './Index.css';
// import '@tensorflow/tfjs-backend-webgl';
// import '@tensorflow/tfjs-backend-cpu';
const remote = global.nodeRequire('electron').remote

const Gazer = ({setGazerStatus}) => {
  const [calibrationSkipable, setCalibrationSkipable] = useState(null);
  const [calibrationPosition, setCalibrationPosition] = useState(null);

  let [calibrationEnabled] = useState({ gazerReady: false, value: false });
  let [gazerReady, setGazerReady] = useState(false);

  useEffect(() => {
    window.applyKalmanFilter = true;
    window.saveDataAcrossSessions = false;
    window.webgazer = webgazer;

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
      webgazer.params.showVideoPreview = true;

      if(remote.dialog.showMessageBox(remote.getCurrentWindow(), {
        type: 'info',
        title: 'Eye tracking',
        message: 'We are asking permission for accessing web cams to track your gaze target.\nThis function need to download model from storage.googleapis.com, and may slow down your computer. Do you want to enable it?',
        buttons: ['Enable eye tracking', 'Keep eye tracking disabled'],
        defaultId: 0,
        cancelId: 1
      }) === 0) {
        setCalibrationSkipable(webgazer.getRegression()[0].getData().length >= 30);
        setCalibrationPosition([]);

        console.log('Starting eye tracking...');

        const gazerStat = {
          base_time: null,
          history: [],
          mouse_clicks: [],
          recorder_chunks: rec_stat.chunks,
          stop_recorder: () => { return rec_stat.stop() },
          recorder: () => { return rec_stat.rec },
        };
        const mouse_callback = (e) => {
          if(calibrationEnabled.value) {
            webgazer.recordScreenPosition(e.clientX, e.clientY, webgazer.params.getEventTypes()[0]);
          }
          gazerStat.mouse_clicks.push({ x: e.clientX, y: e.clientY });
        }
        gazerStat.base_time = new Date().valueOf();
        let last_time = { value: 0, counter: 5 };
        try {
          await webgazer.setRegression('ridge')
            .showVideo(true)
            .showFaceOverlay(true)
            .showFaceFeedbackBox(true)
            .showPredictionPoints(true)
            .setGazeListener(function(data, elapsedTime) {
              if(!calibrationEnabled.gazerReady) {
                console.log('gazer prediction timeout', elapsedTime - last_time.value);
                if(elapsedTime - last_time.value < 500) {
                  last_time.counter -= 1;
                  if(last_time.counter <= 0) {
                    setGazerReady(true);
                    calibrationEnabled.gazerReady = true;
                    calibrationEnabled.value = true;
                    console.log('gazer seems to be stable, enabling calibration');
                  }
                } else {
                  last_time.counter = 5;
                }
                last_time.value = elapsedTime;
              }
              if (data == null) {
                  return;
              }

              gazerStat.history.push({ x: data.x, y: data.y, elapsedTime });
            })
            .begin(() => {
              console.log('webgazer failed!');
            });
        } catch(e) {
          console.log('Init webgazer error', e);
        }
        setGazerStatus(gazerStat);
        // setCalibrationSkipable(webgazer.getRegression()[0].getData().length >= 30);

        setCalibrationSkipable(false);
        webgazer.clearData();

        const points = [];
        for(let i = 10; i <= 90; i += 16) {
          for(let j = 10; j <= 90; j += 16) {
            points.push({ x: i, y: j });
          }
        }
        for (let i = points.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [points[i], points[j]] = [points[j], points[i]];
        }

        setCalibrationPosition(points);

        webgazer.removeMouseEventListeners();
        document.addEventListener('click', mouse_callback);
        return () => {
          document.removeEventListener('click', mouse_callback);
        }
      } else {
        console.log('Eye tracking disabled.');
      }
    })();

    return () => {
      startUp.then((v) => {
        webgazer.end();
        v();
      })
    }
  }, [setGazerStatus, calibrationEnabled, setGazerReady]);

  const stopCalibration = useCallback(() => {
    webgazer
      .showVideo(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .showPredictionPoints(false);
    calibrationEnabled.value = false;
    setCalibrationPosition(null);
  }, [setCalibrationPosition, calibrationEnabled]);

  const nextCalibration = useCallback(() => {
    calibrationPosition.shift();
    if(calibrationPosition.length === 0) {
      stopCalibration();
    } else {
      setCalibrationPosition([ ...calibrationPosition ]);
    }
  }, [calibrationPosition, setCalibrationPosition, stopCalibration]);

  if(Array.isArray(calibrationPosition)) {
    return (
      <>
        <div className="gazer">
          <h2>Calibrate eye tracker</h2>
          {/* <span>Please calibrate eye tracking module before next step.</span> */}
          <span>Click the buttons while looking at the cursor until this overlay disappears.</span>
          {
            calibrationSkipable
              ? <span>You may <button className="skip-button" onClick={stopCalibration}>skip calibration</button> if you haven't move wildly since last experiment</span>
              : undefined
          }
          {
            !gazerReady
              ? <span>Gazer initializing...please wait</span>
              : undefined
          }
        </div>
        {
          gazerReady && (calibrationPosition.length > 0)
            ? <button className="gazer-calib-button" style={{left: calibrationPosition[0].x+'%', top: calibrationPosition[0].y+'%'}} onClick={nextCalibration}>Here</button>
            : undefined
        }
      </>
    );
  } else {
    return <></>;
  }
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
