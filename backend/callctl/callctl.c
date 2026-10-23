/*
 * callctl: one outgoing SIP call that the backend drives line by line (pjsua library).
 *
 *   callctl <config-file> <sip:destination>
 *
 * Config file (one "key value" per line): server, user, password, and optionally
 *   transport udp|tcp|tls (default udp), port (default 5060, 5061 for tls), ca <CA bundle for tls>,
 *   stun <host:port> (public address for the audio), srtp off|optional|mandatory (default off).
 * Over tcp/tls everything goes through the server as outbound proxy (like call.sh: --proxy <server>;lr),
 * and with tls, SRTP needs the TLS signalling (--srtp-secure 1).
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
#include <strings.h>
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

static char g_server[400];

/* "*.example.com" matches "a.example.com" (one label), never "example.com" or "a.b.example.com". */
static pj_bool_t wildcard_match(const pj_str_t *pattern, const char *host) {
    const char *dot = strchr(host, '.');
    if (pattern->slen < 3 || pattern->ptr[0] != '*' || pattern->ptr[1] != '.' || !dot || dot == host) return PJ_FALSE;
    return (pj_ssize_t)strlen(dot + 1) == pattern->slen - 2 && !strncasecmp(dot + 1, pattern->ptr + 2, pattern->slen - 2);
}

/* pjsip rejects wildcard certificates for SIP (RFC 5922), and Navaphone uses *.navaphone.com. So pjsip does not
 * drop the connection itself; here the certificate must chain to a trusted CA, and its name must match the
 * server exactly or by one wildcard label. Anything else closes the connection before a request is sent. */
static void on_transport_state(pjsip_transport *tp, pjsip_transport_state state, const pjsip_transport_state_info *info) {
    const pjsip_tls_state_info *ti;
    const pj_ssl_sock_info *si;
    const pj_ssl_cert_info *cert;
    pj_bool_t name_ok = PJ_FALSE;
    pj_uint32_t other;

    if (state != PJSIP_TP_STATE_CONNECTED || !(tp->flag & PJSIP_TRANSPORT_SECURE) || !info || !info->ext_info) return;
    ti = (const pjsip_tls_state_info *)info->ext_info;
    si = ti->ssl_sock_info;
    if (!si || si->verify_status == PJ_SSL_CERT_ESUCCESS) return;
    cert = si->remote_cert_info;
    other = si->verify_status & ~(pj_uint32_t)PJ_SSL_CERT_EIDENTITY_NOT_MATCH;
    if (!other && cert) {
        for (unsigned i = 0; i < cert->subj_alt_name.cnt && !name_ok; i++)
            if (cert->subj_alt_name.entry[i].type == PJ_SSL_CERT_NAME_DNS)
                name_ok = wildcard_match(&cert->subj_alt_name.entry[i].name, g_server);
        if (!name_ok && !cert->subj_alt_name.cnt) name_ok = wildcard_match(&cert->subject.cn, g_server);
    }
    if (name_ok) return;
    emit("DISCONNECTED 0 TLS certificate not trusted (status 0x%x)", (unsigned)si->verify_status);
    g_done = PJ_TRUE;
    pjsip_transport_shutdown(tp);
}

typedef struct {
    char server[400], user[400], pass[400], transport[8], ca[600], stun[200], srtp[16];
    int port;
} config_t;

static int read_config(const char *path, config_t *c) {
    char line[1024], key[64], val[800];
    FILE *f = fopen(path, "r");
    if (!f) return -1;
    memset(c, 0, sizeof *c);
    strcpy(c->transport, "udp");
    strcpy(c->srtp, "off");
    while (fgets(line, sizeof line, f)) {
        if (sscanf(line, "%63s %799[^\r\n]", key, val) != 2) continue;
        if (!strcmp(key, "server")) snprintf(c->server, sizeof c->server, "%s", val);
        else if (!strcmp(key, "user")) snprintf(c->user, sizeof c->user, "%s", val);
        else if (!strcmp(key, "password")) snprintf(c->pass, sizeof c->pass, "%s", val);
        else if (!strcmp(key, "transport")) snprintf(c->transport, sizeof c->transport, "%s", val);
        else if (!strcmp(key, "port")) c->port = atoi(val);
        else if (!strcmp(key, "ca")) snprintf(c->ca, sizeof c->ca, "%s", val);
        else if (!strcmp(key, "stun")) snprintf(c->stun, sizeof c->stun, "%s", val);
        else if (!strcmp(key, "srtp")) snprintf(c->srtp, sizeof c->srtp, "%s", val);
    }
    fclose(f);
    if (!c->port) c->port = strcmp(c->transport, "tls") ? 5060 : 5061;
    return (c->server[0] && c->user[0] && c->pass[0]) ? 0 : -1;
}

int main(int argc, char **argv) {
    config_t c;
    char id[900], reg[900], proxy[960], line[1024], uri_tail[32];
    const char *logfile = getenv("CALLCTL_LOG");
    pjsip_transport_type_e tp;
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
    if (argc != 3 || read_config(argv[1], &c) != 0) {
        fprintf(stderr, "usage: callctl <config> <sip:dest>\n");
        return 2;
    }
    snprintf(g_server, sizeof g_server, "%s", c.server);
    if (pjsua_create() != PJ_SUCCESS) { emit("ERROR pjsua_create"); return 1; }
    pool = pjsua_pool_create("callctl", 512, 512);
    pj_mutex_create_simple(pool, "out", &g_out_lock);

    pjsua_config_default(&cfg);
    cfg.cb.on_call_state = &on_call_state;
    cfg.cb.on_call_media_state = &on_call_media_state;
    cfg.cb.on_dtmf_digit2 = &on_dtmf_digit2;
    cfg.cb.on_transport_state = &on_transport_state;
    cfg.max_calls = 1;
    pjsua_logging_config_default(&log_cfg);
    log_cfg.console_level = 0;
    log_cfg.level = 0;
    if (logfile && *logfile) {   /* debugging: full SIP log to this file */
        log_cfg.level = 5;
        log_cfg.msg_logging = PJ_TRUE;
        log_cfg.log_filename = pj_str((char *)logfile);
    }
    if (c.stun[0]) {   /* learn the public address for the audio (behind NAT) */
        cfg.stun_srv_cnt = 1;
        cfg.stun_srv[0] = pj_str(c.stun);
    }
    pjsua_media_config_default(&media_cfg);
    media_cfg.clock_rate = 8000;
    media_cfg.snd_clock_rate = 8000;
    media_cfg.no_vad = PJ_TRUE;
    media_cfg.ec_tail_len = 0;
    if (pjsua_init(&cfg, &log_cfg, &media_cfg) != PJ_SUCCESS) { emit("ERROR pjsua_init"); return 1; }

    pjsua_transport_config_default(&tcfg);
    tcfg.port = 0;
    if (!strcmp(c.transport, "tls")) {
        tp = PJSIP_TRANSPORT_TLS;
        tcfg.tls_setting.verify_server = PJ_FALSE;  /* checked in on_transport_state (wildcard names) */
        if (c.ca[0]) tcfg.tls_setting.ca_list_file = pj_str(c.ca);
        snprintf(uri_tail, sizeof uri_tail, ";transport=tls");
    } else if (!strcmp(c.transport, "tcp")) {
        tp = PJSIP_TRANSPORT_TCP;
        snprintf(uri_tail, sizeof uri_tail, ";transport=tcp");
    } else {
        tp = PJSIP_TRANSPORT_UDP;
        uri_tail[0] = 0;
    }
    if (pjsua_transport_create(tp, &tcfg, NULL) != PJ_SUCCESS) { emit("ERROR transport %s", c.transport); return 1; }
    if (pjsua_start() != PJ_SUCCESS) { emit("ERROR pjsua_start"); return 1; }
    pjsua_set_null_snd_dev();

    {   /* keep the INVITE small: PCMU, PCMA and telephone-event only */
        const char *off[] = {"speex", "iLBC", "GSM", "G722", "L16", "opus", "G7221", "AMR"};
        for (unsigned i = 0; i < sizeof off / sizeof off[0]; i++) {
            pj_str_t c = pj_str((char *)off[i]);
            pjsua_codec_set_priority(&c, 0);
        }
    }

    snprintf(id, sizeof id, "sip:%s@%s", c.user, c.server);
    snprintf(reg, sizeof reg, "sip:%s:%d%s", c.server, c.port, uri_tail);
    pjsua_acc_config_default(&acfg);
    acfg.id = pj_str(id);
    acfg.reg_uri = pj_str(reg);
    acfg.cred_count = 1;
    acfg.cred_info[0].realm = pj_str("*");
    acfg.cred_info[0].scheme = pj_str("digest");
    acfg.cred_info[0].username = pj_str(c.user);
    acfg.cred_info[0].data_type = PJSIP_CRED_DATA_PLAIN_PASSWD;
    acfg.cred_info[0].data = pj_str(c.pass);
    if (tp != PJSIP_TRANSPORT_UDP) {   /* sign-in and calls through the server: --proxy sip:server:port;transport=x;lr */
        snprintf(proxy, sizeof proxy, "%s;lr", reg);
        acfg.proxy_cnt = 1;
        acfg.proxy[0] = pj_str(proxy);
    }
    acfg.reg_timeout = 3600;
    if (!strcmp(c.srtp, "optional")) acfg.use_srtp = PJMEDIA_SRTP_OPTIONAL;
    else if (!strcmp(c.srtp, "mandatory")) acfg.use_srtp = PJMEDIA_SRTP_MANDATORY;
    else acfg.use_srtp = PJMEDIA_SRTP_DISABLED;
    acfg.srtp_secure_signaling = (tp == PJSIP_TRANSPORT_TLS) ? 1 : 0;
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
