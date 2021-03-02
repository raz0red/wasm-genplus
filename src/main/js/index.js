import wasm from './genplus.js';
import './genplus.wasm';

import { Unzip } from "./zip"
import { DisplayLoop, VisibilityChangeMonitor } from './display'
import { ScriptAudioProcessor } from './audio'

const ROM_PATH = './roms/sonic2.bin';
(() => {
    const CONTROLS = {
        INPUT_MODE: 0x0800,
        INPUT_X: 0x0400,
        INPUT_Y: 0x0200,
        INPUT_Z: 0x0100,
        INPUT_START: 0x0080,
        INPUT_A: 0x0040,
        INPUT_C: 0x0020,
        INPUT_B: 0x0010,
        INPUT_RIGHT: 0x0008,
        INPUT_LEFT: 0x0004,
        INPUT_DOWN: 0x0002,
        INPUT_UP: 0x0001
    }
    const CANVAS_WIDTH = 320;
    const CANVAS_HEIGHT_NTSC = 224;
    const CANVAS_HEIGHT_PAL = 240;
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
    let audioProcessor = null;

    // display
    let displayLoop = null;
    let visibilityMonitor = null;

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
                input[0] |= (buttons[10].pressed ? CONTROLS.INPUT_MODE : CONTROLS.INPUT_START);
            }
            if (buttons[14].pressed) {
                input[0] |= CONTROLS.INPUT_LEFT;
            }
            if (buttons[15].pressed) {
                input[0] |= CONTROLS.INPUT_RIGHT;
            }
            if (buttons[12].pressed) {
                input[0] |= CONTROLS.INPUT_UP;
            }
            if (buttons[13].pressed) {
                input[0] |= CONTROLS.INPUT_DOWN;
            }
            if (buttons[2].pressed) {
                input[0] |= CONTROLS.INPUT_A;
            }
            if (buttons[0].pressed) {
                input[0] |= CONTROLS.INPUT_B;
            }
            if (buttons[2].pressed) {
                input[0] |= CONTROLS.INPUT_A;
            }
            if (buttons[1].pressed) {
                input[0] |= CONTROLS.INPUT_C;
            }
            if (buttons[4].pressed) {
                input[0] |= CONTROLS.INPUT_X;
            }
            if (buttons[3].pressed) {
                input[0] |= CONTROLS.INPUT_Y;
            }
            if (buttons[5].pressed) {
                input[0] |= CONTROLS.INPUT_Z;
            }
        }
    }

    const start = (module) => {
        // Prepare canvas
        canvas = document.getElementById('screen');

        window.setCanvasSize = (w, h) => {
            console.log(`width: ${w}, height: ${h}`);
            canvas.setAttribute('width', w);
            canvas.setAttribute('height', h);
        };

        // init emuulator
        gens._init_genplus();

        const pal = gens._is_pal();
        canvas.setAttribute('width', CANVAS_WIDTH);
        canvas.setAttribute('height', pal ? CANVAS_HEIGHT_PAL : CANVAS_HEIGHT_NTSC);
        canvasContext = canvas.getContext('2d');
        canvasContext.clearRect(0, 0, canvas.width, canvas.height);
        canvasImageData = canvasContext.createImageData(canvas.width, canvas.height);

        // Create loop and audio processor
        audioProcessor = new ScriptAudioProcessor();
        displayLoop = new DisplayLoop(pal ? 50 : 60);

        visibilityMonitor = new VisibilityChangeMonitor((p) => {
            displayLoop.pause(p);
            audioProcessor.pause(p);
        });

        // reset the emulator
        gens._reset();

        // vram view
        vram = new Uint8ClampedArray(gens.HEAPU8.buffer, gens._get_frame_buffer_ref(), canvas.width * canvas.height * 4);
        // audio view
        const SAMPLING_PER_FPS = (audioProcessor.getFrequency() / displayLoop.getFrequency()) + 100;
        audioChannels[0] = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_l_ref(), SAMPLING_PER_FPS);
        audioChannels[1] = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_r_ref(), SAMPLING_PER_FPS);
        // input
        input = new Uint16Array(gens.HEAPU16.buffer, gens._get_input_buffer_ref(), GAMEPAD_API_INDEX);
        // audio
        audioProcessor.start();
        // game loop
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
        });
        //displayLoop.setDebug(true);
    };

    const fetchData = (url) => {
        return new Promise((resolve, reject) => {
            fetch(url)
                .then(response => response.blob())
                .then(blob => resolve(blob))
                .catch(() => {
                    const purl = `http://192.168.1.179/?y=${url}`;
                    fetch(purl)
                        .then(response => response.blob())
                        .then(blob => resolve(blob))
                        .catch(error => reject(error));
                });
        });
    }

    wasm().then((module) => {
        gens = module;
        // memory allocate
        gens._init();
        // load rom
        fetchData(ROM_PATH)
            .then(blob => Unzip.unzip(blob, [".md", ".bin", ".gen", ".smd"]))
            .then(blob => new Response(blob).arrayBuffer())
            .then(bytes => {
                // create buffer from wasm
                romdata = new Uint8Array(gens.HEAPU8.buffer, gens._get_rom_buffer_ref(bytes.byteLength), bytes.byteLength);
                romdata.set(new Uint8Array(bytes));
                // start
                start(module);
            })
            .catch((error) => console.error(error));
    });
})();
