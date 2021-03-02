#include <emscripten/emscripten.h>
#include "shared.h"
#include "fileio.h"
#include "md_ntsc.h"
#include "sms_ntsc.h"

#define SOUND_FREQUENCY 48000
#define SOUND_SAMPLES_SIZE 2048

#define VIDEO_WIDTH  320 //640
#define VIDEO_HEIGHT 240 //480

#define GAMEPAD_API_INDEX 32

uint32_t *frame_buffer;
int16_t *sound_frame;
uint16_t *input_buffer;

float_t *web_audio_l;
float_t *web_audio_r;

struct _zbank_memory_map zbank_memory_map[256];

void EMSCRIPTEN_KEEPALIVE init(void)
{
    // vram & sampling malloc
    rom_buffer = malloc(sizeof(uint8_t) * MAXROMSIZE);
    frame_buffer = malloc(sizeof(uint32_t) * VIDEO_WIDTH * VIDEO_HEIGHT);
    sound_frame = malloc(sizeof(int16_t) * SOUND_SAMPLES_SIZE);
    web_audio_l = malloc(sizeof(float_t) * SOUND_SAMPLES_SIZE);
    web_audio_r = malloc(sizeof(float_t) * SOUND_SAMPLES_SIZE);
    input_buffer = malloc(sizeof(uint16_t) * GAMEPAD_API_INDEX);
}


void EMSCRIPTEN_KEEPALIVE init_genplus(void)
{
    // system init
    error_init();
    set_config_defaults();

    // video ram init
    memset(&bitmap, 0, sizeof(bitmap));
    bitmap.width      = VIDEO_WIDTH;
    bitmap.height     = VIDEO_HEIGHT;
    bitmap.pitch      = VIDEO_WIDTH * 4;
    bitmap.data       = (uint8_t *)frame_buffer;
    bitmap.viewport.changed = 0;

    // load rom
    load_rom("dummy.bin");

    // emulator init
    audio_init(SOUND_FREQUENCY, vdp_pal ? 50 : 60);
    system_init();
}

void EMSCRIPTEN_KEEPALIVE reset(void)
{
    system_reset();
}

int EMSCRIPTEN_KEEPALIVE is_pal(void)
{
    return vdp_pal > 0;
}

float_t convert_sample_i2f(int16_t i) {
    float_t f;
    if(i < 0) {
        f = ((float) i) / (float) 32768;
    } else {
        f = ((float) i) / (float) 32767;
    }
    if( f > 1 ) f = 1;
    if( f < -1 ) f = -1;
    return f;
}


static int lastWidth = 0;
static int lastHeight = 0;

EM_JS(void, SetCanvasSize, (int w, int h), {
    window.setCanvasSize(w, h);
});

void EMSCRIPTEN_KEEPALIVE tick(void) {
    system_frame_gen(0);
    if ((bitmap.viewport.w != lastWidth) || (bitmap.viewport.h != lastHeight)) {
        lastWidth = bitmap.viewport.w;
        lastHeight = bitmap.viewport.h;
        SetCanvasSize(lastWidth, lastHeight);
    }
}

int EMSCRIPTEN_KEEPALIVE sound(void) {
    int size = audio_update(sound_frame);
    int p = 0;
    for(int i = 0; i < size * 2; i += 2) {
        web_audio_l[p] = convert_sample_i2f(sound_frame[i]);
        web_audio_r[p] = convert_sample_i2f(sound_frame[i + 1]);
        p++;
    }
    return p;
}

int EMSCRIPTEN_KEEPALIVE wasm_input_update(void) {
    input.pad[0] = input_buffer[0];
    return 1;
}

uint8_t* EMSCRIPTEN_KEEPALIVE get_rom_buffer_ref(uint32_t size) {
    rom_size = size;
    return rom_buffer;
}

uint32_t* EMSCRIPTEN_KEEPALIVE get_frame_buffer_ref(void) {
    return frame_buffer;
}

float_t* EMSCRIPTEN_KEEPALIVE get_web_audio_l_ref(void) {
    return web_audio_l;
}

float_t* EMSCRIPTEN_KEEPALIVE get_web_audio_r_ref(void) {
    return web_audio_r;
}

uint16_t* EMSCRIPTEN_KEEPALIVE get_input_buffer_ref(void) {
    return input_buffer;
}
