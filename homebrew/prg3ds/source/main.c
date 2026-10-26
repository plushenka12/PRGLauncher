// PRG 3DS: reads the console's play history (PTM PlayHistory.dat, read only)
// and the names of installed games, and sends them to PRGLauncher on the PC
// over the home network. The launcher turns the history into sessions.
//
// Upload: POST /n3ds/v1/upload, header X-PRG-Code: <pairing code>, body
// {"version":1,"source":"ptm"|"file","titles":[{"id":"0004000000055D00","name":"..."}],"history":"<base64>"}
#include <3ds.h>
#include <arpa/inet.h>
#include <errno.h>
#include <malloc.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#define CONFIG_DIR "sdmc:/3ds/PRG3DS"
#define CONFIG_PATH CONFIG_DIR "/config.txt"
#define HISTORY_MAX 0xD5DE8
#define PTM_SAVE_ID 0x00010022
#define SOC_ALIGN 0x1000
#define SOC_BUFFERSIZE 0x100000
#define DEFAULT_PORT 47833

typedef struct {
    char host[40];
    int port;
    char code[8];
} Config;

// The part of an SMDH we need: the header and the 16 localized titles.
typedef struct {
    u32 magic;
    u16 version;
    u16 reserved;
    struct {
        u16 shortDescription[0x40];
        u16 longDescription[0x80];
        u16 publisher[0x40];
    } titles[16];
} SmdhTitles;

static Config config;

// ── Config on the SD card ─────────────────────────────────────────────────
static void loadConfig(void) {
    memset(&config, 0, sizeof(config));
    config.port = DEFAULT_PORT;
    FILE* file = fopen(CONFIG_PATH, "r");
    if (!file) return;
    char line[96];
    while (fgets(line, sizeof(line), file)) {
        line[strcspn(line, "\r\n")] = 0;
        if (!strncmp(line, "host=", 5)) snprintf(config.host, sizeof(config.host), "%s", line + 5);
        else if (!strncmp(line, "port=", 5)) config.port = atoi(line + 5);
        else if (!strncmp(line, "code=", 5)) snprintf(config.code, sizeof(config.code), "%s", line + 5);
    }
    fclose(file);
    if (config.port <= 0 || config.port > 65535) config.port = DEFAULT_PORT;
}

static bool saveConfig(void) {
    mkdir("sdmc:/3ds", 0777);
    mkdir(CONFIG_DIR, 0777);
    FILE* file = fopen(CONFIG_PATH, "w");
    if (!file) return false;
    fprintf(file, "host=%s\nport=%d\ncode=%s\n", config.host, config.port, config.code);
    fclose(file);
    return true;
}

static bool configReady(void) {
    struct in_addr address;
    return inet_aton(config.host, &address) && strlen(config.code) == 6;
}

static bool askText(const char* hint, char* out, size_t size, int maxLength, bool dots) {
    SwkbdState keyboard;
    char buffer[64];
    swkbdInit(&keyboard, SWKBD_TYPE_NUMPAD, 2, maxLength);
    swkbdSetHintText(&keyboard, hint);
    swkbdSetInitialText(&keyboard, out);
    if (dots) swkbdSetNumpadKeys(&keyboard, L'.', 0);
    if (swkbdInputText(&keyboard, buffer, sizeof(buffer)) != SWKBD_BUTTON_CONFIRM) return false;
    snprintf(out, size, "%s", buffer);
    return true;
}

static void editConfig(void) {
    char port[8];
    askText("PC address from PRGLauncher, e.g. 192.168.1.20", config.host, sizeof(config.host), 15, true);
    snprintf(port, sizeof(port), "%d", config.port);
    if (askText("Port", port, sizeof(port), 5, false)) config.port = atoi(port);
    askText("6-digit pairing code", config.code, sizeof(config.code), 6, false);
    if (config.port <= 0 || config.port > 65535) config.port = DEFAULT_PORT;
    printf(saveConfig() ? "Settings saved.\n" : "Could not save settings to the SD card.\n");
}

// ── Play history (read only) ──────────────────────────────────────────────
// PTM keeps its own save open, so the file cannot be opened directly
// (FS 0xC92044E7). The service hands the same entries out instead
// (3dbrew "PTM Services": GetPlayHistory 0x08070082, Start 0x08080000,
// Length 0x08090000). The result is sent in the file's layout, marked as
// coming from the service, because the order of the returned entries is not
// documented; the launcher works it out from the timestamps.
#define HISTORY_ENTRY 12
#define HISTORY_CHUNK 0x800

static Result ptmGetWord(Handle handle, u32 command, u32* value) {
    u32* cmd = getThreadCommandBuffer();
    cmd[0] = IPC_MakeHeader(command, 0, 0);
    Result rc = svcSendSyncRequest(handle);
    if (R_FAILED(rc)) return rc;
    *value = cmd[2];
    return (Result)cmd[1];
}

static Result ptmGetPlayHistory(Handle handle, u32 offset, u32 count, void* out) {
    u32* cmd = getThreadCommandBuffer();
    cmd[0] = IPC_MakeHeader(0x807, 2, 2);
    cmd[1] = offset;
    cmd[2] = count;
    cmd[3] = IPC_Desc_Buffer(count * HISTORY_ENTRY, IPC_BUFFER_W);
    cmd[4] = (u32)out;
    Result rc = svcSendSyncRequest(handle);
    return R_FAILED(rc) ? rc : (Result)cmd[1];
}

static u8* readHistoryFromService(u32* size) {
    static const char* names[] = { "ptm:play", "ptm:sysm" };
    Handle handle = 0;
    Result rc = -1;
    for (size_t i = 0; i < sizeof(names) / sizeof(names[0]) && R_FAILED(rc); i++) rc = srvGetServiceHandle(&handle, names[i]);
    if (R_FAILED(rc)) { printf("No access to the PTM service (%08lX).\n", rc); return NULL; }
    u32 start = 0, length = 0;
    rc = ptmGetWord(handle, 0x808, &start);
    if (R_SUCCEEDED(rc)) rc = ptmGetWord(handle, 0x809, &length);
    if (R_FAILED(rc) || length > (HISTORY_MAX - 8) / HISTORY_ENTRY) { printf("PTM did not give the history size (%08lX).\n", rc); svcCloseHandle(handle); return NULL; }
    printf("PTM history: %lu entries, start %lu.\n", length, start);
    u8* data = malloc(8 + length * HISTORY_ENTRY);
    if (!data) { svcCloseHandle(handle); printf("Out of memory.\n"); return NULL; }
    memcpy(data, &start, 4);
    memcpy(data + 4, &length, 4);
    for (u32 offset = 0; offset < length && R_SUCCEEDED(rc); offset += HISTORY_CHUNK) {
        u32 count = length - offset < HISTORY_CHUNK ? length - offset : HISTORY_CHUNK;
        rc = ptmGetPlayHistory(handle, offset, count, data + 8 + offset * HISTORY_ENTRY);
    }
    svcCloseHandle(handle);
    if (R_FAILED(rc)) { printf("PTM refused the history (%08lX).\n", rc); free(data); return NULL; }
    *size = 8 + length * HISTORY_ENTRY;
    return data;
}

static u8* readHistoryFile(u32* size) {
    FS_Archive archive;
    u32 path[2] = { MEDIATYPE_NAND, PTM_SAVE_ID };
    Result rc = FSUSER_OpenArchive(&archive, ARCHIVE_SYSTEM_SAVEDATA, (FS_Path){ PATH_BINARY, sizeof(path), path });
    if (R_FAILED(rc)) { printf("Cannot open the PTM save (%08lX).\n", rc); return NULL; }
    Handle file;
    rc = FSUSER_OpenFile(&file, archive, fsMakePath(PATH_ASCII, "/PlayHistory.dat"), FS_OPEN_READ, 0);
    if (R_FAILED(rc)) { printf("Cannot open PlayHistory.dat (%08lX).\n", rc); FSUSER_CloseArchive(archive); return NULL; }
    u64 fileSize = 0;
    FSFILE_GetSize(file, &fileSize);
    u8* data = NULL;
    if (fileSize >= 8 && fileSize <= HISTORY_MAX) data = malloc((size_t)fileSize);
    u32 read = 0;
    if (data) rc = FSFILE_Read(file, &read, 0, data, (u32)fileSize);
    FSFILE_Close(file);
    FSUSER_CloseArchive(archive);
    if (!data || R_FAILED(rc) || read != fileSize) { printf("Cannot read PlayHistory.dat.\n"); free(data); return NULL; }
    *size = read;
    return data;
}

// ── Game names from the installed titles ──────────────────────────────────
static bool isGameTitle(u64 titleId) {
    u32 high = (u32)(titleId >> 32);
    return high == 0x00040000 || high == 0x00040002;
}

static bool readTitleName(u64 titleId, FS_MediaType media, char* out, size_t size) {
    static const u32 filePath[5] = { 0x0, 0x0, 0x2, 0x6E6F6369, 0x0 };  // ExeFS "icon"
    u32 archivePath[4] = { (u32)titleId, (u32)(titleId >> 32), media, 0x0 };
    Handle file;
    if (R_FAILED(FSUSER_OpenFileDirectly(&file, ARCHIVE_SAVEDATA_AND_CONTENT, (FS_Path){ PATH_BINARY, sizeof(archivePath), archivePath },
                                         (FS_Path){ PATH_BINARY, sizeof(filePath), filePath }, FS_OPEN_READ, 0))) return false;
    SmdhTitles* smdh = malloc(sizeof(SmdhTitles));
    u32 read = 0;
    Result rc = smdh ? FSFILE_Read(file, &read, 0, smdh, sizeof(SmdhTitles)) : -1;
    FSFILE_Close(file);
    bool ok = false;
    if (smdh && R_SUCCEEDED(rc) && read == sizeof(SmdhTitles) && smdh->magic == 0x48444D53) {
        // English first, then the other languages.
        static const int order[] = { 1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 };
        for (size_t i = 0; i < sizeof(order) / sizeof(order[0]) && !ok; i++) {
            const u16* name = smdh->titles[order[i]].shortDescription;
            if (!name[0]) continue;
            ssize_t length = utf16_to_utf8((u8*)out, name, size - 1);
            if (length > 0) { out[length < (ssize_t)size ? length : (ssize_t)size - 1] = 0; ok = true; }
        }
    }
    free(smdh);
    return ok;
}

// Appends text to a growing buffer.
typedef struct { char* data; size_t length, capacity; } Text;

static bool textAppend(Text* text, const char* value, size_t length) {
    if (text->length + length + 1 > text->capacity) {
        size_t capacity = text->capacity ? text->capacity : 4096;
        while (text->length + length + 1 > capacity) capacity *= 2;
        char* grown = realloc(text->data, capacity);
        if (!grown) return false;
        text->data = grown;
        text->capacity = capacity;
    }
    memcpy(text->data + text->length, value, length);
    text->length += length;
    text->data[text->length] = 0;
    return true;
}

static bool textAdd(Text* text, const char* value) { return textAppend(text, value, strlen(value)); }

static bool textAddJsonString(Text* text, const char* value) {
    if (!textAdd(text, "\"")) return false;
    for (const unsigned char* c = (const unsigned char*)value; *c; c++) {
        char escaped[8];
        if (*c == '"' || *c == '\\') { escaped[0] = '\\'; escaped[1] = (char)*c; escaped[2] = 0; }
        else if (*c < 0x20) snprintf(escaped, sizeof(escaped), "\\u%04x", *c);
        else { escaped[0] = (char)*c; escaped[1] = 0; }
        if (!textAdd(text, escaped)) return false;
    }
    return textAdd(text, "\"");
}

static int addTitles(Text* body, FS_MediaType media, bool* first) {
    u32 count = 0;
    if (R_FAILED(AM_GetTitleCount(media, &count)) || !count) return 0;
    u64* ids = calloc(count, sizeof(u64));
    if (!ids) return 0;
    u32 read = 0;
    int added = 0;
    if (R_SUCCEEDED(AM_GetTitleList(&read, media, count, ids))) {
        for (u32 i = 0; i < read; i++) {
            char name[256];
            if (!isGameTitle(ids[i]) || !readTitleName(ids[i], media, name, sizeof(name))) continue;
            char id[17];
            snprintf(id, sizeof(id), "%016llX", ids[i]);
            textAdd(body, *first ? "{\"id\":\"" : ",{\"id\":\"");
            textAdd(body, id);
            textAdd(body, "\",\"name\":");
            textAddJsonString(body, name);
            textAdd(body, "}");
            *first = false;
            added++;
        }
    }
    free(ids);
    return added;
}

static bool textAddBase64(Text* text, const u8* data, u32 size) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    char quad[5] = { 0 };
    for (u32 i = 0; i < size; i += 3) {
        u32 value = data[i] << 16 | (i + 1 < size ? data[i + 1] << 8 : 0) | (i + 2 < size ? data[i + 2] : 0);
        quad[0] = alphabet[(value >> 18) & 63];
        quad[1] = alphabet[(value >> 12) & 63];
        quad[2] = i + 1 < size ? alphabet[(value >> 6) & 63] : '=';
        quad[3] = i + 2 < size ? alphabet[value & 63] : '=';
        if (!textAppend(text, quad, 4)) return false;
    }
    return true;
}

// ── Upload ────────────────────────────────────────────────────────────────
static bool sendAll(int sock, const char* data, size_t length) {
    while (length) {
        ssize_t sent = send(sock, data, length > 0x4000 ? 0x4000 : length, 0);
        if (sent <= 0) return false;
        data += sent;
        length -= (size_t)sent;
    }
    return true;
}

static void upload(void) {
    if (!configReady()) { printf("Set the PC address and code first (X).\n"); return; }
    if (gethostid() == 0) { printf("Wi-Fi is not connected.\n"); return; }
    printf("Reading play history...\n");
    u32 historySize = 0;
    bool fromService = true;
    u8* history = readHistoryFromService(&historySize);
    if (!history) { fromService = false; history = readHistoryFile(&historySize); }
    if (!history) return;

    Text body = { 0 };
    bool first = true;
    textAdd(&body, fromService ? "{\"version\":1,\"source\":\"ptm\",\"titles\":[" : "{\"version\":1,\"source\":\"file\",\"titles\":[");
    int titles = addTitles(&body, MEDIATYPE_SD, &first);
    titles += addTitles(&body, MEDIATYPE_NAND, &first);
    titles += addTitles(&body, MEDIATYPE_GAME_CARD, &first);
    textAdd(&body, "],\"history\":\"");
    bool built = textAddBase64(&body, history, historySize) && textAdd(&body, "\"}");
    free(history);
    if (!built) { printf("Out of memory.\n"); free(body.data); return; }
    printf("%d games found, %lu bytes of history.\n", titles, historySize);

    printf("Sending to %s:%d...\n", config.host, config.port);
    int sock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
    struct sockaddr_in server = { 0 };
    server.sin_family = AF_INET;
    server.sin_port = htons(config.port);
    inet_aton(config.host, &server.sin_addr);
    if (sock < 0 || connect(sock, (struct sockaddr*)&server, sizeof(server)) < 0) {
        printf("Cannot reach the PC (%d). Is receiving on in PRGLauncher?\n", errno);
        if (sock >= 0) close(sock);
        free(body.data);
        return;
    }
    char header[256];
    int headerLength = snprintf(header, sizeof(header),
        "POST /n3ds/v1/upload HTTP/1.1\r\nHost: %s:%d\r\nContent-Type: application/json\r\nX-PRG-Code: %s\r\nContent-Length: %u\r\nConnection: close\r\n\r\n",
        config.host, config.port, config.code, (unsigned)body.length);
    bool sent = sendAll(sock, header, headerLength) && sendAll(sock, body.data, body.length);
    free(body.data);

    char response[1024];
    size_t received = 0;
    ssize_t chunk;
    while (sent && received < sizeof(response) - 1 && (chunk = recv(sock, response + received, sizeof(response) - 1 - received, 0)) > 0) received += (size_t)chunk;
    response[received] = 0;
    close(sock);
    if (!sent || !received) { printf("No answer from the PC.\n"); return; }

    const char* json = strstr(response, "\r\n\r\n");
    json = json ? json + 4 : "";
    if (strstr(response, " 200 ")) printf("Done: %s\n", json);
    else if (strstr(response, " 403 ")) printf("Wrong pairing code. Check it in PRGLauncher (X to edit).\n");
    else if (strstr(response, " 429 ")) printf("Too many wrong codes. Wait 10 minutes.\n");
    else printf("The PC refused it: %s\n", json);
}

static void showMenu(void) {
    printf("\nA: send play time to PRGLauncher\nX: settings\nSTART: exit\n");
    if (configReady()) printf("PC %s:%d\n", config.host, config.port);
    else printf("Not set up yet - press X.\n");
}

int main(void) {
    gfxInitDefault();
    consoleInit(GFX_TOP, NULL);
    amInit();
    printf("PRG 3DS - play time for PRGLauncher\n");
    printf("Reads the activity log, changes nothing.\n");

    u32* socBuffer = memalign(SOC_ALIGN, SOC_BUFFERSIZE);
    bool network = socBuffer && R_SUCCEEDED(socInit(socBuffer, SOC_BUFFERSIZE));
    if (!network) printf("Network init failed.\n");

    loadConfig();
    showMenu();

    while (aptMainLoop()) {
        hidScanInput();
        u32 down = hidKeysDown();
        if (down & KEY_START) break;
        if (down & KEY_X) { editConfig(); showMenu(); }
        if (down & KEY_A) {
            if (network) upload();
            else printf("Network is not available.\n");
            showMenu();
        }
        gfxFlushBuffers();
        gfxSwapBuffers();
        gspWaitForVBlank();
    }

    if (network) socExit();
    free(socBuffer);
    amExit();
    gfxExit();
    return 0;
}
