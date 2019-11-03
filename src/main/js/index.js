import wasm from './genplus.js';
import './genplus.wasm';
import BufferQueueNode from 'web-audio-buffer-queue'

const ROM_PATH = './roms/sonic2.bin';
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;
const SOUND_FREQUENCY = 44100;
const SAMPLING_PER_FPS = 736;

// emulator
let gens;
let romdata;
let vram;

// canvas member
let canvas;
let canvasContext;
let canvasImageData;

// fps control
const FPS = 60;
const INTERVAL = 1000 / FPS;
let now;
let then;
let delta;

// audio member
let audioContext;
let bufferQueueNode;
let audio_l;
let audio_r;

// canvas setting
(function() {
    canvas = document.getElementById('screen');
    canvas.setAttribute('width', CANVAS_WIDTH);
    canvas.setAttribute('height', CANVAS_HEIGHT);
    let pixelRatio = window.devicePixelRatio ? window.devicePixelRatio : 1;
    if(pixelRatio > 1 && window.screen.width < CANVAS_WIDTH) {
        canvas.style.width = CANVAS_WIDTH + "px";
        canvas.style.heigth = CANVAS_HEIGHT + "px";
    }
    canvasContext = canvas.getContext('2d');
    canvasImageData = canvasContext.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
    // hit any key for audio context
    canvasContext.font = "24px monospace";
    canvasContext.fillStyle = "#fff";
    canvasContext.fillText("HIT ANY KEY", 250, 250);
})();

wasm().then(function(module) {
    gens = module;
    // memory allocate
    gens._init();
    console.log(gens);
    // load rom
    fetch(ROM_PATH).then(response => response.arrayBuffer())
    .then(bytes => {
        // create buffer from wasm
        romdata = new Uint8Array(gens.HEAPU8.buffer, gens._get_rom_buffer_ref(), bytes.byteLength);
        romdata.set(new Uint8Array(bytes));
        canvas.addEventListener('click', start, false);
    });
});

const start = function() {
    canvas.removeEventListener('click', start, false);
    canvasContext.clearRect(0, 0, canvas.width, canvas.height);
    // emulator start
    gens._start();
    // vram view
    vram = new Uint8ClampedArray(gens.HEAPU8.buffer, gens._get_frame_buffer_ref(), CANVAS_WIDTH * CANVAS_HEIGHT * 4);
    // audio view
    audio_l = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_l_ref(), SAMPLING_PER_FPS);
    audio_r = new Float32Array(gens.HEAPF32.buffer, gens._get_web_audio_r_ref(), SAMPLING_PER_FPS);
    // audio init
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SOUND_FREQUENCY
    });
    bufferQueueNode = new BufferQueueNode({
        audioContext: audioContext,
        objectMode: true,
        channels: 2,
        bufferSize: 512
    });
    bufferQueueNode.connect(audioContext.destination);
    // game loop
    then = Date.now();
    loop();
};

const loop = function() {
    requestAnimationFrame(loop);
    now = Date.now();
    delta = now - then;
    if (delta > INTERVAL) {
        // update
        gens._loop();
        then = now - (delta % INTERVAL);
        // sound
        gens._sound();
        let audioBuffer = audioContext.createBuffer(2, SAMPLING_PER_FPS, SOUND_FREQUENCY);
        audioBuffer.getChannelData(0).set(audio_l);
        audioBuffer.getChannelData(1).set(audio_r);
        bufferQueueNode.write(audioBuffer);
        // draw
        canvasImageData.data.set(vram);
        canvasContext.putImageData(canvasImageData, 0, 0);
    }
}
