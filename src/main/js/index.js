import wasm from './genplus.js';
import './genplus.wasm';

(() => {
  const ROM_PATH = './roms/sonic2.bin';
  const CANVAS_WIDTH = 320;
  const CANVAS_HEIGHT = 224; // TODO: Garbage in last 2 lines (Sonic 2)
  const SOUND_FREQUENCY = 48000;
  const SAMPLING_PER_FPS = (48000 / 60) + 100;
  const GAMEPAD_API_INDEX = 32;
  const DEBUG = false;

  // emulator
  let gens;
  let romdata;
  let vram;
  let input;
  let initialized = false;
  let vsync = true;

  // canvas member
  let canvas;
  let canvasContext;
  let canvasImageData;

  // fps control
  const FPS = 60;

  // audio member
  const SOUNDBUFSIZE = 8192 << 1;
  const mixbuffer = [new Array(SOUNDBUFSIZE), new Array(SOUNDBUFSIZE)];
  let audio_l;
  let audio_r;
  let audioCtx = null;
  let audioNode = null;
  let mixhead = 0;
  let mixtail = 0;

  // timing
  let forceAdjustTimestamp = false;
  let hidden, visibilityChange;

  // for iOS
  let isSafari = false;

  const keyscan = () => {
    input.fill(0);
    let gamepads = navigator.getGamepads();
    if (gamepads.length == 0) return;
    let gamepad = gamepads[0];
    if (gamepad == null) return;
    if (isSafari) {
      // for iOS Microsoft XBOX ONE
      // UP - DOWN
      input[7] = gamepad.axes[5] * -1;
      // LEFT - RIGHT
      input[6] = gamepad.axes[4];
    } else if (gamepad.id.match(/Microsoft/)) {
      // for Microsoft XBOX ONE
      // axes 0 - 7
      gamepad.axes.forEach((value, index) => {
        input[index] = value;
      });
    } else {
      // UP - DOWN
      input[7] = gamepad.axes[1];
      // LEFT - RIGHT
      input[6] = gamepad.axes[0];
    }
    // GamePadAPI   MEGADRIVE
    // input[8 + 2] INPUT_A;
    // input[8 + 3] INPUT_B;
    // input[8 + 1] INPUT_C;
    // input[8 + 7] INPUT_START;
    // input[8 + 0] INPUT_X;
    // input[8 + 4] INPUT_Y;
    // input[8 + 5] INPUT_Z;
    // input[8 + 6] INPUT_MODE;
    gamepad.buttons.forEach((button, index) => {
      input[index + 8] = button.value;
    });
  };

  const storeSound = (l, r, length) => {
    //console.log(length);
    for (let i = 0; i < length; i++) {
      mixbuffer[0][mixhead] = l[i];
      mixbuffer[1][mixhead++] = r[i];
      if (mixhead == SOUNDBUFSIZE)
        mixhead = 0;
    }
  }

  const sync = (callback, afterTimeout) => {
    if (vsync) {
      requestAnimationFrame(callback);
    } else {
      if (!afterTimeout) {
        setTimeout(callback, 0);
      } else {
        callback();
      }
    }
  }

  const loop = () => {
    // update keys
    keyscan();

    // update
    gens._tick();

    // draw
    canvasImageData.data.set(vram);
    canvasContext.putImageData(canvasImageData, 0, 0);

    // sound
    let samples = gens._sound();
    storeSound(audio_l, audio_r, samples);
  };

  const startLoop = () => {
    let start = Date.now();
    let fc = 0;
    let frequency = FPS;
    let debugFrequency = frequency * 10;
    let frameTicks = (1000.0 / frequency);
    let adjustTolerance = (frameTicks * frequency * 2); // 2 secs
    let avgWait = 0;

    console.log("Frame ticks: " + frameTicks);
    console.log("Frequency: " + frequency);

    const f = () => {
      loop();
      nextTimestamp += frameTicks;

      let now = Date.now();
      if (((nextTimestamp + adjustTolerance) < now) || forceAdjustTimestamp) {
        forceAdjustTimestamp = false;
        nextTimestamp = now; fc = 0; start = now; avgWait = 0;
        console.log("adjusted next timestamp.");
      }

      let wait = (nextTimestamp - now);
      avgWait += wait;
      if (wait > 0) {
        setTimeout(() => sync(f, true), wait);
      } else {
        sync(f, false);
      }

      fc++;
      if ((fc % debugFrequency) == 0) {
        let elapsed = Date.now() - start;
        if (DEBUG) {
          console.log("v:%s, vsync: %d",
            (1000.0 / (elapsed / fc)).toFixed(2),
            vsync ? 1 : 0,
            (vsync ? "" : ("wait: " + ((avgWait / fc) * frequency).toFixed(2) + ", ")));
        }
        start = Date.now(); fc = 0; avgWait = 0;
      }
    }
    let nextTimestamp = Date.now() + frameTicks;
    setTimeout(() => sync(f, true), nextTimestamp);
  }

  const start = () => {
    if (!initialized) return;

    // Prepare canvas
    canvas = document.getElementById('screen');
    canvas.setAttribute('width', CANVAS_WIDTH);
    canvas.setAttribute('height', CANVAS_HEIGHT);
    canvasContext = canvas.getContext('2d');
    canvasImageData = canvasContext.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
    canvasContext.clearRect(0, 0, canvas.width, canvas.height);

    // emulator start
    gens._start();
    // vram view
    vram = new Uint8ClampedArray(gens.HEAPU8.buffer, gens._get_frame_buffer_ref(), CANVAS_WIDTH * CANVAS_HEIGHT * 4);
    // audio view
    audio_l = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_l_ref(), SAMPLING_PER_FPS);
    audio_r = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_r_ref(), SAMPLING_PER_FPS);
    // input
    input = new Float32Array(gens.HEAPF32.buffer, gens._get_input_buffer_ref(), GAMEPAD_API_INDEX);
    // iOS
    let ua = navigator.userAgent
    if (ua.match(/Safari/) && !ua.match(/Chrome/) && !ua.match(/Edge/)) {
      isSafari = true;
    }

    // game loop
    startLoop()
  };

  const startAudio = () => {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      audioCtx = window.AudioContext ?
        new window.AudioContext({ sampleRate: SOUND_FREQUENCY }) :
        new window.webkitAudioContext();
      audioNode = audioCtx.createScriptProcessor(512, 0, 2);
      audioNode.onaudioprocess = (e) => {
        let ldst = e.outputBuffer.getChannelData(0);
        let rdst = e.outputBuffer.getChannelData(1);
        let done = 0; let len = ldst.length;
        while ((mixtail != mixhead) && (done < len)) {
          ldst[done] = mixbuffer[0][mixtail];
          rdst[done++] = mixbuffer[1][mixtail++];
          if (mixtail == SOUNDBUFSIZE)
            mixtail = 0;
        }
        while (done < len) {
          ldst[done] = 0;
          rdst[done++] = 0;
        }
      }
      audioNode.connect(audioCtx.destination);
    }
  }

  // Visibility
  const handleVisibilityChange = () => {
    if (document[hidden]) {
      forceAdjustTimestamp = true;
    }
  }
  if (typeof document.hidden !== "undefined") { // Opera 12.10 and Firefox 18 and later support
    hidden = "hidden";
    visibilityChange = "visibilitychange";
  } else if (typeof document.msHidden !== "undefined") {
    hidden = "msHidden";
    visibilityChange = "msvisibilitychange";
  } else if (typeof document.webkitHidden !== "undefined") {
    hidden = "webkitHidden";
    visibilityChange = "webkitvisibilitychange";
  }
  document.addEventListener(visibilityChange, handleVisibilityChange, false);

  // Audio resume
  const resumeFunc = () => { if (audioCtx.state !== 'running') audioCtx.resume(); }
  const docElement = document.documentElement;
  docElement.addEventListener("keydown", resumeFunc);
  docElement.addEventListener("click", resumeFunc);
  docElement.addEventListener("drop", resumeFunc);
  docElement.addEventListener("dragdrop", resumeFunc);

  wasm().then((module) => {
    gens = module;
    // memory allocate
    gens._init();
    // load rom
    fetch(ROM_PATH).then(response => response.arrayBuffer())
      .then(bytes => {
        // create buffer from wasm
        romdata = new Uint8Array(gens.HEAPU8.buffer, gens._get_rom_buffer_ref(bytes.byteLength), bytes.byteLength);
        romdata.set(new Uint8Array(bytes));
        initialized = true;

        // start
        startAudio();
        start();
      });
  });
})();
