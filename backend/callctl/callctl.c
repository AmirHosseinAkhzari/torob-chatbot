/*
 * callctl: one outgoing SIP call that the backend drives line by line (pjsua library).
 *
 *   callctl <config-file> <sip:destination>
 *
 * Config file (one "key value" per line): server, user, password.
 * Commands on stdin:   PLAY <wav path>   play a clip into the call once (replaces the one playing)
 *                      STOP              stop the clip
 *                      HANGUP            hang up and exit
 * Events on stdout:    STATE <CALLING|EARLY|CONNECTING|CONFIRMED>
 *                      MEDIA             audio is flowing (clips can be played)
 *                      DTMF <digit>      a key pressed by the other side (RFC 2833 or SIP INFO)
 *                      PLAYEND           the clip finished
 *                      DISCONNECTED <code> <reason>
 *                      ERROR <text>
 * Only G.711 + telephone-event are offered: with every codec the INVITE passes 1500 bytes and is lost.
 */
#include <pjsua-lib/pjsua.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static pjsua_call_id g_call = PJSUA_INVALID_ID;
static pjsua_player_id g_player = PJSUA_INVALID_ID;
static pj_bool_t g_media = PJ_FALSE;
static pj_bool_t g_done = PJ_FALSE;
static pj_mutex_t *g_out_lock;

static void emit(const char *fmt, ...) {
    va_list ap;
    if (g_out_lock) pj_mutex_lock(g_out_lock);
    va_start(ap, fmt);
    vfprintf(stdout, fmt, ap);
    va_end(ap);
    fputc('\n', stdout);
    fflush(stdout);
    if (g_out_lock) pj_mutex_unlock(g_out_lock);
}

static void on_call_state(pjsua_call_id call_id, pjsip_event *e) {
    pjsua_call_info ci;
    PJ_UNUSED_ARG(e);
    pjsua_call_get_info(call_id, &ci);
    if (ci.state == PJSIP_INV_STATE_DISCONNECTED) {
        emit("DISCONNECTED %d %.*s", ci.last_status, (int)ci.last_status_text.slen, ci.last_status_text.ptr);
        g_done = PJ_TRUE;
    } else {
        emit("STATE %.*s", (int)ci.state_text.slen, ci.state_text.ptr);
    }
}

static void on_call_media_state(pjsua_call_id call_id) {
    pjsua_call_info ci;
    pjsua_call_get_info(call_id, &ci);
    if (ci.media_status == PJSUA_CALL_MEDIA_ACTIVE && !g_media) {
        g_media = PJ_TRUE;
        emit("MEDIA");
    }
}

static void on_dtmf_digit2(pjsua_call_id call_id, const pjsua_dtmf_info *info) {
    PJ_UNUSED_ARG(call_id);
    emit("DTMF %c", (char)info->digit);
}

static void on_player_eof(pjmedia_port *port, void *user_data) {
    PJ_UNUSED_ARG(port);
    PJ_UNUSED_ARG(user_data);
    emit("PLAYEND");
}

static void stop_player(void) {
    if (g_player != PJSUA_INVALID_ID) {
        pjsua_player_destroy(g_player);
        g_player = PJSUA_INVALID_ID;
    }
}

static void play(const char *path) {
    pj_str_t file = pj_str((char *)path);
    pjmedia_port *port = NULL;
    pjsua_conf_port_id call_slot;
    pj_status_t st;

    stop_player();
    if (g_call == PJSUA_INVALID_ID || !g_media) { emit("ERROR no media yet"); return; }
    st = pjsua_player_create(&file, PJMEDIA_FILE_NO_LOOP, &g_player);
    if (st != PJ_SUCCESS) { emit("ERROR cannot open %s", path); g_player = PJSUA_INVALID_ID; return; }
    if (pjsua_player_get_port(g_player, &port) == PJ_SUCCESS)
        pjmedia_wav_player_set_eof_cb2(port, NULL, &on_player_eof);
    call_slot = pjsua_call_get_conf_port(g_call);
    pjsua_conf_connect(pjsua_player_get_conf_port(g_player), call_slot);
}

static int read_config(const char *path, char *server, char *user, char *pass) {
    char line[512], key[64], val[400];
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    server[0] = user[0] = pass[0] = 0;
    while (fgets(line, sizeof line, f)) {
        if (sscanf(line, "%63s %399[^\r\n]", key, val) != 2) continue;
        if (!strcmp(key, "server")) strcpy(server, val);
        else if (!strcmp(key, "user")) strcpy(user, val);
        else if (!strcmp(key, "password")) strcpy(pass, val);
    }
    fclose(f);
    return (server[0] && user[0] && pass[0]) ? 0 : -1;
}

int main(int argc, char **argv) {
    char server[400], user[400], pass[400], id[900], reg[900], line[1024];
    pjsua_config cfg;
    pjsua_logging_config log_cfg;
    pjsua_media_config media_cfg;
    pjsua_transport_config tcfg;
    pjsua_acc_config acfg;
    pjsua_acc_id acc_id;
    pj_pool_t *pool;
    pj_str_t dst;

    setvbuf(stdout, NULL, _IOLBF, 0);
    pj_log_set_level(0); /* stdout carries events only */
    if (argc != 3 || read_config(argv[1], server, user, pass) != 0) {
        fprintf(stderr, "usage: callctl <config> <sip:dest>\n");
        return 2;
    }
    if (pjsua_create() != PJ_SUCCESS) { emit("ERROR pjsua_create"); return 1; }
    pool = pjsua_pool_create("callctl", 512, 512);
    pj_mutex_create_simple(pool, "out", &g_out_lock);

    pjsua_config_default(&cfg);
    cfg.cb.on_call_state = &on_call_state;
    cfg.cb.on_call_media_state = &on_call_media_state;
    cfg.cb.on_dtmf_digit2 = &on_dtmf_digit2;
    cfg.max_calls = 1;
    pjsua_logging_config_default(&log_cfg);
    log_cfg.console_level = 0;
    log_cfg.level = 0;
    if (getenv("CALLCTL_LOG")) {   /* debugging: full SIP log to this file */
        log_cfg.level = 5;
        log_cfg.msg_logging = PJ_TRUE;
        log_cfg.log_filename = pj_str(getenv("CALLCTL_LOG"));
    }
    pjsua_media_config_default(&media_cfg);
    media_cfg.clock_rate = 8000;
    media_cfg.snd_clock_rate = 8000;
    media_cfg.no_vad = PJ_TRUE;
    media_cfg.ec_tail_len = 0;
    if (pjsua_init(&cfg, &log_cfg, &media_cfg) != PJ_SUCCESS) { emit("ERROR pjsua_init"); return 1; }

    pjsua_transport_config_default(&tcfg);
    tcfg.port = 0;
    if (pjsua_transport_create(PJSIP_TRANSPORT_UDP, &tcfg, NULL) != PJ_SUCCESS) { emit("ERROR transport"); return 1; }
    if (pjsua_start() != PJ_SUCCESS) { emit("ERROR pjsua_start"); return 1; }
    pjsua_set_null_snd_dev();

    {   /* keep the INVITE small: PCMU, PCMA and telephone-event only */
        const char *off[] = {"speex", "iLBC", "GSM", "G722", "L16", "opus", "G7221", "AMR"};
        for (unsigned i = 0; i < sizeof off / sizeof off[0]; i++) {
            pj_str_t c = pj_str((char *)off[i]);
            pjsua_codec_set_priority(&c, 0);
        }
    }

    snprintf(id, sizeof id, "sip:%s@%s", user, server);
    snprintf(reg, sizeof reg, "sip:%s:5060", server);
    pjsua_acc_config_default(&acfg);
    acfg.id = pj_str(id);
    acfg.reg_uri = pj_str(reg);
    acfg.cred_count = 1;
    acfg.cred_info[0].realm = pj_str("*");
    acfg.cred_info[0].scheme = pj_str("digest");
    acfg.cred_info[0].username = pj_str(user);
    acfg.cred_info[0].data_type = PJSIP_CRED_DATA_PLAIN_PASSWD;
    acfg.cred_info[0].data = pj_str(pass);
    if (pjsua_acc_add(&acfg, PJ_TRUE, &acc_id) != PJ_SUCCESS) { emit("ERROR account"); return 1; }

    dst = pj_str(argv[2]);
    {   /* audio only: Asiatech answers 400 to an offer that also has a text (T.140) or video stream */
        pjsua_call_setting opt;
        pjsua_call_setting_default(&opt);
        opt.aud_cnt = 1;
        opt.vid_cnt = 0;
        opt.txt_cnt = 0;
        if (pjsua_call_make_call(acc_id, &dst, &opt, NULL, NULL, &g_call) != PJ_SUCCESS) {
            emit("DISCONNECTED 0 could not start the call");
            pjsua_destroy();
            return 1;
        }
    }
    if (0) {
        emit("DISCONNECTED 0 could not start the call");
        pjsua_destroy();
        return 1;
    }

    while (!g_done && fgets(line, sizeof line, stdin)) {
        line[strcspn(line, "\r\n")] = 0;
        if (!strncmp(line, "PLAY ", 5)) play(line + 5);
        else if (!strcmp(line, "STOP")) stop_player();
        else if (!strcmp(line, "HANGUP")) break;
    }
    stop_player();
    pjsua_call_hangup_all();
    pj_thread_sleep(300);
    pjsua_destroy();
    return 0;
}
