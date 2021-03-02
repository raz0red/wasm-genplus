export class ScriptAudioProcessor {
    constructor(
        channelCount = 2,
        frequency = 48000,
        bufferSize = 16384,
        scriptBufferSize = 512) {
        this.frequency = frequency;
        this.bufferSize = bufferSize;
        this.scriptBufferSize = scriptBufferSize;
        this.channelCount = channelCount;
        this.paused = true;

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

    pause(p) {
        if (p == this.paused)
            return;
        if (!p) {
            this.audioCtx.resume();
        } else {
            this.audioCtx.suspend();
        }
        this.paused = p;
    }

    start() {
        if (!this.audioCtx && (window.AudioContext || window.webkitAudioContext)) {
            this.audioCtx = window.AudioContext ?
                new window.AudioContext({ sampleRate: this.frequency }) :
                new window.webkitAudioContext();
            if (this.audioCtx.sampleRate) {
                this.frequency = this.audioCtx.sampleRate;
            }
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
            this.paused = false;

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
