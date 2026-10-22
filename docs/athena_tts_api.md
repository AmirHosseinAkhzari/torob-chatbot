# Athena TTS API (reverse-engineered)

Source: chat.athenai.app web app, inspected on 2026-10-23. Script: `scripts/athena_tts.py`.

## How it works

The web app is a LibreChat fork. Text-to-speech is not a direct TTS endpoint: it is a chat
**agent** ("دستیار تولید صدا", `agent_eeMDIFgAZ_x8PUTe-azim`) that runs an LLM (`gpt-5.6-luna`),
which calls a `generate_sound` tool. The tool saves an MP3 to S3 and attaches it to the reply.

```
POST https://api.athenai.app/libre/v1/api/agents/chat/agents
     -> {"streamId": <conversationId>, "conversationId": ..., "status": "started"}
GET  https://api.athenai.app/libre/v1/api/agents/chat/status/{conversationId}
     -> {"active": true|false}            (poll until false; ~8-15 s)
GET  https://api.athenai.app/libre/v1/api/messages/{conversationId}
     -> last message .attachments[0].filepath = https://s3.metisai.ir/genx-sts/images/<user>/<id>.mp3
```

The web app reads progress from the SSE stream `GET .../api/agents/chat/stream/{id}`, but that
returns 404 once the job is done, so the script polls `status` instead.

All calls use `Authorization: Bearer <accessToken>`. The MP3 URL itself is **public** (no auth).

### Request body (POST /api/agents/chat/agents)

Captured from a real request on 2026-10-23:

```json
{
  "text": "سلام، این یک تست است.",
  "sender": "User",
  "clientTimestamp": "2026-10-23T02:08:27",
  "isCreatedByUser": true,
  "parentMessageId": "<previous message id, or 00000000-0000-0000-0000-000000000000>",
  "conversationId": "<existing id, or null for a new chat>",
  "messageId": "<new uuid>",
  "error": false,
  "endpoint": "agents",
  "endpointType": "agents",
  "agent_id": "agent_eeMDIFgAZ_x8PUTe-azim",
  "sound_model": "tts-athena",
  "key": "2026-10-22T23:38:27.490Z",
  "sound_mode": "text-to-speech",
  "sound_voice": "kian",
  "sound_instrumental": false,
  "sound_custom_mode": true,
  "sound_length": 21,
  "isTemporary": false,
  "isRegenerate": false,
  "isContinued": false,
  "ephemeralAgent": {"artifacts": "auto"},
  "timezone": "Asia/Tehran"
}
```

- `sound_voice` is the voice **slug**.
- `sound_length` is the character count of `text`.
- Optional, from the JS code: `sound_pace` (`slow` | `fast`, omitted for normal) and
  `sound_tone` (tone key such as `serious`, `warm`, `happy`). These weren't in the captured request.
- The capture continued an existing chat. The script sends `conversationId: null` to start
  a new one each time; that path is standard LibreChat but hasn't been captured live.

### Other useful endpoints

| endpoint | what |
|---|---|
| `GET api.athenai.app/chat/v1/sound-models` | voice catalog: 26 voices (slug, gender, sample mp3), tone/pace tags, `maxInputChars: 2000`, cost bands |
| `GET .../libre/v1/api/messages/{conversationId}` | messages incl. audio attachments |
| `GET .../libre/v1/api/convos/{conversationId}` | conversation (has `sound_model`) |
| `POST api.athenai.app/upm/v1/auth/refresh` `{refreshToken}` | → `{access_token, refresh_token}` |
| `GET api.athenai.app/banker/v1/credit/subscription-usage` | free quota: `freeMedia.sound = {used, limit, maxChars, resetAtEpochMs}` |

Voices: kian, negin, ava, bardia, arman, hasti, saman, keivan, shakiba, laleh, anahita, leila,
bahram, dariush, raha, yasaman, mahsa, farhad, kamran, nila, sohrab, rostam, taraneh,
fereshteh, arash, paria.

## Token lifetime

| token | where | lifetime |
|---|---|---|
| **accessToken** (JWT, RS256, `iss: athena`) | `jwtToken` cookie, NextAuth session | **365 days** (`iat` 2026-10-22 → `exp` 2027-10-22) |
| **refreshToken** (opaque, 86 chars) | `refreshToken` cookie | cookie kept **30 days**; rotates on each refresh |
| NextAuth session | `/api/auth/session` | 30 days, renewed while you use the site |

The app refreshes 60 s before the access token's `exp` by calling `/upm/v1/auth/refresh`.
Logging out (or "log out other sessions") can revoke tokens earlier, so treat the year as an
upper bound.

## Limits and caveats

- Free plan: 2 generations per 168 h (rolling), **max 500 chars** each. Paid cost scales by
  length (≤500 / 1000 / 2000 chars).
- The text goes through an LLM first. Its instructions say to pass the text verbatim, but it
  could still refuse or rephrase odd inputs.
- This is a private, undocumented API: it can change any time, and automated use may break
  Athena's terms of service.
