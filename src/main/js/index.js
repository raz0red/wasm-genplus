import wasm from './genplus.js';
import './genplus.wasm';

class DisplayLoop {
    constructor(freq = 60, vsync = true) {
        this.frequency = freq;
        this.forceAdjustTimestamp = false;
        this.vsync = vsync;
        this.debug = false;

        this.monitorVisibilityChanges();
    }

    setDebug(debug) { this.debug = debug; }

    getFrequency() { return this.frequency; }

    sync(cb, afterTimeout) {
        if (this.vsync) {
            requestAnimationFrame(cb);
        } else {
            if (!afterTimeout) {
                setTimeout(cb, 0);
            } else {
                callback();
            }
        }
    }

    start(cb) {
        const { frequency } = this;
        const frameTicks = (1000.0 / frequency);
        const adjustTolerance = (frameTicks * frequency * 2); // 2 secs
        const debugFrequency = frequency * 10;

        console.log("Frame ticks: " + frameTicks);
        console.log("Frequency: " + frequency);

        let start = Date.now();
        let fc = 0;
        let avgWait = 0;

        const f = () => {
            cb();
            nextTimestamp += frameTicks;

            let now = Date.now();
            if (((nextTimestamp + adjustTolerance) < now) || this.forceAdjustTimestamp) {
                this.forceAdjustTimestamp = false;
                nextTimestamp = now; fc = 0; start = now; avgWait = 0;
                console.log("adjusted next timestamp.");
            }

            let wait = (nextTimestamp - now);
            avgWait += wait;
            if (wait > 0) {
                setTimeout(() => this.sync(f, true), wait);
            } else {
                this.sync(f, false);
            }

            fc++;
            if ((fc % debugFrequency) == 0) {
                let elapsed = Date.now() - start;
                if (this.debug) {
                    console.log("v:%s, vsync: %d",
                        (1000.0 / (elapsed / fc)).toFixed(2),
                        this.vsync ? 1 : 0,
                        (this.vsync ? "" : ("wait: " + ((avgWait / fc) * frequency).toFixed(2) + ", ")));
                }
                start = Date.now(); fc = 0; avgWait = 0;
            }
        }
        let nextTimestamp = Date.now() + frameTicks;
        setTimeout(() => this.sync(f, true), nextTimestamp);
    }

    monitorVisibilityChanges() {
        this.hidden = null;
        this.visibilityChange = null;

        const handleVisibilityChange = () => {
            if (document[this.hidden]) {
                this.forceAdjustTimestamp = true;
            }
        }
        if (typeof document.hidden !== "undefined") { // Opera 12.10 and Firefox 18 and later support
            this.hidden = "hidden";
            this.visibilityChange = "visibilitychange";
        } else if (typeof document.msHidden !== "undefined") {
            this.hidden = "msHidden";
            this.visibilityChange = "msvisibilitychange";
        } else if (typeof document.webkitHidden !== "undefined") {
            this.hidden = "webkitHidden";
            this.visibilityChange = "webkitvisibilitychange";
        }
        document.addEventListener(this.visibilityChange, handleVisibilityChange, false);
    }
}

class ScriptAudioProcessor {
    constructor(
        channelCount = 2,
        frequency = 48000,
        bufferSize = 16384,
        scriptBufferSize = 512) {
        this.frequency = frequency;
        this.bufferSize = bufferSize;
        this.scriptBufferSize = scriptBufferSize;
        this.channelCount = channelCount;

        this.audioCtx = null;
        this.audioNode = null;
        this.mixhead = 0;
        this.mixtail = 0;

        this.tmpBuffers = new Array(channelCount);
        this.mixbuffer = new Array(channelCount);
        for (let i = 0; i < channelCount; i++) {
            this.mixbuffer[i] = new Array(bufferSize);
        }
    }

    getFrequency() { return this.frequency; }

    start() {
        if (!this.audioCtx && (window.AudioContext || window.webkitAudioContext)) {
            this.audioCtx = window.AudioContext ?
                new window.AudioContext({ sampleRate: this.frequency }) :
                new window.webkitAudioContext();
            this.audioNode = this.audioCtx.createScriptProcessor(
                this.scriptBufferSize, 0, this.channelCount);
            this.audioNode.onaudioprocess = (e) => {
                for (let i = 0; i < this.channelCount; i++) {
                    this.tmpBuffers[i] = e.outputBuffer.getChannelData(i);
                }
                let done = 0;
                let len = this.tmpBuffers[0].length;
                while ((this.mixtail != this.mixhead) && (done < len)) {
                    for (let i = 0; i < this.channelCount; i++) {
                        this.tmpBuffers[i][done] = this.mixbuffer[i][this.mixtail];
                    }
                    done++;
                    this.mixtail++;
                    if (this.mixtail == this.bufferSize) {
                        this.mixtail = 0;
                    }
                }
                while (done < len) {
                    for (let i = 0; i < this.channelCount; i++) {
                        this.tmpBuffers[i] = 0;
                    }
                    done++;
                }
            }
            this.audioNode.connect(this.audioCtx.destination);

            // Audio resume
            const resumeFunc = () => {
                this.audioCtx.resume();
                if (this.audioCtx.state !== 'running') {
                    this.audioCtx.resume();
                }
            }
            const docElement = document.documentElement;
            docElement.addEventListener("keydown", resumeFunc);
            docElement.addEventListener("click", resumeFunc);
            docElement.addEventListener("drop", resumeFunc);
            docElement.addEventListener("dragdrop", resumeFunc);
        }
    }

    storeSound(channels, length) {
        for (let i = 0; i < length; i++) {
            for (let j = 0; j < channels.length; j++) {
                this.mixbuffer[j][this.mixhead] = channels[j][i];
            }
            this.mixhead++;
            if (this.mixhead == this.bufferSize)
                this.mixhead = 0;
        }
    }
}

(() => {
    const INPUT_MODE = 0x0800;
    const INPUT_X = 0x0400;
    const INPUT_Y = 0x0200;
    const INPUT_Z = 0x0100;
    const INPUT_START = 0x0080;
    const INPUT_A = 0x0040;
    const INPUT_C = 0x0020;
    const INPUT_B = 0x0010;
    const INPUT_RIGHT = 0x0008;
    const INPUT_LEFT = 0x0004;
    const INPUT_DOWN = 0x0002;
    const INPUT_UP = 0x0001;

    const ROM_PATH = './roms/sonic.bin';
    const CANVAS_WIDTH = 320;
    const CANVAS_HEIGHT = 224; // TODO: Garbage in last 2 lines (Sonic 2)
    const GAMEPAD_API_INDEX = 32;

    // emulator
    let gens;
    let romdata;
    let vram;
    let input;

    // canvas member
    let canvas;
    let canvasContext;
    let canvasImageData;

    // audio member
    const audioChannels = new Array(2);
    const audioProcessor = new ScriptAudioProcessor();

    // display
    const displayLoop = new DisplayLoop();

    const keyscan = () => {
        input[0] = 0;
        const pads = navigator.getGamepads ?
            navigator.getGamepads() : (navigator.webkitGetGamepads ?
                navigator.webkitGetGamepads : []);
        if (pads.length == 0) return;
        let pad = pads[0];
        if (pad == null) return;

        let buttons = pad.buttons;
        if (buttons && buttons.length >= 16) {
            if ((buttons[6].pressed || buttons[7].pressed) &&
                (buttons[10].pressed || buttons[11].pressed)) {
                input[0] |= (buttons[10].pressed ? INPUT_MODE : INPUT_START);
            }
            if (buttons[14].pressed) {
                input[0] |= INPUT_LEFT;
            }
            if (buttons[15].pressed) {
                input[0] |= INPUT_RIGHT;
            }
            if (buttons[12].pressed) {
                input[0] |= INPUT_UP;
            }
            if (buttons[13].pressed) {
                input[0] |= INPUT_DOWN;
            }
            if (buttons[2].pressed) {
                input[0] |= INPUT_A;
            }
            if (buttons[0].pressed) {
                input[0] |= INPUT_B;
            }
            if (buttons[2].pressed) {
                input[0] |= INPUT_A;
            }
            if (buttons[1].pressed) {
                input[0] |= INPUT_C;
            }
            if (buttons[4].pressed) {
                input[0] |= INPUT_X;
            }
            if (buttons[3].pressed) {
                input[0] |= INPUT_Y;
            }
            if (buttons[5].pressed) {
                input[0] |= INPUT_Z;
            }
        }
    }

    const start = () => {
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
        const SAMPLING_PER_FPS = (audioProcessor.getFrequency() / displayLoop.getFrequency()) + 100;
        audioChannels[0] = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_l_ref(), SAMPLING_PER_FPS);
        audioChannels[1] = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_r_ref(), SAMPLING_PER_FPS);
        // input
        input = new Uint16Array(gens.HEAPU16.buffer, gens._get_input_buffer_ref(), GAMEPAD_API_INDEX);

        // game loop
        audioProcessor.start();

        displayLoop.setDebug(true);
        displayLoop.start(() => {
            // update
            gens._tick();

            // update keys
            keyscan();

            // draw
            canvasImageData.data.set(vram);
            canvasContext.putImageData(canvasImageData, 0, 0);

            // sound
            let samples = gens._sound();
            audioProcessor.storeSound(audioChannels, samples);
            //storeSound(audio_l, audio_r, samples);
        });
    };

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

                // start
                start();
            });
    });
})();
