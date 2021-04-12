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

void EMSCRIPTEN_KEEPALIVE init()
{
    EM_ASM_({window.FS = FS;});

    // vram & sampling malloc
    rom_buffer = malloc(sizeof(uint8_t) * MAXROMSIZE);
    frame_buffer = malloc(sizeof(uint32_t) * VIDEO_WIDTH * VIDEO_HEIGHT);
    sound_frame = malloc(sizeof(int16_t) * SOUND_SAMPLES_SIZE);
    web_audio_l = malloc(sizeof(float_t) * SOUND_SAMPLES_SIZE);
    web_audio_r = malloc(sizeof(float_t) * SOUND_SAMPLES_SIZE);
    input_buffer = malloc(sizeof(uint16_t) * GAMEPAD_API_INDEX);
}


void EMSCRIPTEN_KEEPALIVE init_genplus(int systemType)
{
    // system init
    error_init();
    set_config_defaults();
    config.system = systemType;

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

    // EM_ASM_({
    //     console.log('sram.on: ' + $0);
    // }, sram.on);
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
    if (config.system == SYSTEM_MD) {
        system_frame_gen(0);
    } else {
        system_frame_sms(0);
    }
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
    input.pad[4] = input_buffer[1];
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

#define CHUNKSIZE   (0x10000)
#define SRAM_FILE "/tmp/game.srm"

EMSCRIPTEN_KEEPALIVE int save_sram(void) {
    EM_ASM_({console.log('save_sram');});

    char* filename = SRAM_FILE;
    unsigned long filesize, done = 0;
    unsigned char* buffer;

    /* only save if SRAM is enabled */
    if (!sram.on) {
        return 0;
    }

    /* max. supported SRAM size */
    filesize = 0x10000;

    /* only save modified SRAM size */
    do {
        if (sram.sram[filesize - 1] != 0xff)
            break;
    } while (--filesize > 0);

    /* only save if SRAM has been modified */
    if ((filesize == 0) || (crc32(0, &sram.sram[0], 0x10000) == sram.crc)) {
        return 0;
    }

    /* allocate buffer */
    buffer = (unsigned char*)malloc(filesize);
    if (!buffer) {
        return 0;
    }

    /* copy SRAM data */
    memcpy(buffer, sram.sram, filesize);

    /* update CRC */
    sram.crc = crc32(0, sram.sram, 0x10000);

    /* Open file */
    FILE* fp = fopen(filename, "wb");
    if (!fp) {
        free(buffer);
        return 0;
    }

    /* Write from buffer (2k blocks) */
    while (filesize > CHUNKSIZE) {
        fwrite(buffer + done, CHUNKSIZE, 1, fp);
        done += CHUNKSIZE;
        filesize -= CHUNKSIZE;
    }

    /* Write remaining bytes */
    fwrite(buffer + done, filesize, 1, fp);
    done += filesize;

    /* Close file */
    fclose(fp);
    free(buffer);

    EM_ASM_({console.log('saved.');});

    return 1;
}

EMSCRIPTEN_KEEPALIVE int load_sram() {
    EM_ASM_({console.log('load_sram');});

    char* filename = SRAM_FILE;
    unsigned long filesize, done = 0;
    unsigned char* buffer;

    if (!sram.on) {
        return 0;
    }

    /* Open file */
    FILE* fp = fopen(filename, "rb");
    if (!fp) {
        return 0;
    }

    /* Get file size */
    fseek(fp, 0, SEEK_END);
    filesize = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    /* allocate buffer */
    buffer = (unsigned char*)malloc(filesize);
    if (!buffer) {
        fclose(fp);
        return 0;
    }

    /* Read into buffer (2k blocks) */
    while (filesize > CHUNKSIZE) {
        fread(buffer + done, CHUNKSIZE, 1, fp);
        done += CHUNKSIZE;
        filesize -= CHUNKSIZE;
    }

    /* Read remaining bytes */
    fread(buffer + done, filesize, 1, fp);
    done += filesize;

    /* Close file */
    fclose(fp);

    /* load SRAM (max. 64 KB)*/
    if (done < 0x10000) {
        memcpy(sram.sram, buffer, done);
        memset(sram.sram + done, 0xFF, 0x10000 - done);
    } else {
        memcpy(sram.sram, buffer, 0x10000);
    }

    /* update CRC */
    sram.crc = crc32(0, sram.sram, 0x10000);

    free(buffer);

    EM_ASM_({console.log('loaded.');});

    return 1;
}
