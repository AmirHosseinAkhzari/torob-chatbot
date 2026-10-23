---
title: Store inquiry and price verification
tags: [voip, sip, dtmf, tts, inquiry, verification, sms, phone]
summary: How Tarboche confirms a shop's price and stock — by the shop's panel or by an automated Persian phone call — and tells the customer.
code: [backend/app/inquiry.py, backend/app/voip.py, backend/app/tts.py, backend/app/numwords.py, backend/app/verify.py, backend/app/sms.py, backend/callctl/callctl.c]
---

# Store inquiry and price verification

## When a price needs confirming
`verify.needs` marks a shop's offer for confirmation with one or more reasons:

| Reason | Rule |
|---|---|
| `no_price` | No usable price listed |
| `stale_price` | Price older than 90 days |
| `stock_unknown` | No stock answer, or the last one is older than 7 days |
| `store_closed` | Shop is closed now |

The agent is told never to present such a price or stock as confirmed, and to say the shop is being asked.

## Verification requests (`verify.py`)

- One open request per offer; every customer who asked joins as a watcher.
- The shop answers in its panel (or the phone inquiry answers it). The offer's price/stock is updated and
  watchers get an SMS.
- Follow-up job, every minute: a request still open after 1 hour while the shop is open gets one SMS to the
  shop's staff; failed sends retry at 5 / 15 / 45 minutes; every attempt is logged in `notification_log`.
- Requests expire after `VERIFY_EXPIRE_HOURS` (default 48). A closed shop's request waits until it opens.
- Status: `pending` → `in_progress` → `verified` | `unavailable` | `expired` | `cancelled`.

## Phone inquiry (استعلام دستگاه, `inquiry.py`)

The app calls an open shop and runs a short keypad script in Persian:

1. **Availability** — "Do you have … in stock?" 1 = yes, 2 = no (done, unavailable).
2. **Price** — "Is it X toman?" 1 = yes (confirmed), 2 = no → step 3.
3. **Enter price** — shop types the price and presses `#` (`*` restarts).
4. **Read back** — the entered price is spoken in words; 1 = correct (saved), 2 = re-enter. Up to 3 tries.

Unanswered prompts repeat once, then give up (`no_answer` / unverified). A price the shop says is wrong is
never kept as confirmed. Job status: `queued → preparing → ringing → in_call → available | unavailable |
no_answer | failed`. The customer gets an SMS with the result.

### How the call works

- `voip.py` drives `callctl`, a small C program on pjsua (`backend/callctl/`): dial, report call state and
  every key, play a WAV on command. Clips can be made mid-call (the price read-back).
- Keys arrive as RFC 2833 or SIP INFO (`VOIP_DTMF`). Liara blocks inbound UDP, so production uses SIP over
  TLS with SIP INFO keys.
- `tts.py`: Athena TTS when a token is set, Edge TTS otherwise or on failure; clips cached by text;
  converted to 16 kHz mono WAV (`afconvert`, `miniaudio`, or `ffmpeg`).
- `numwords.py`: numbers to spoken Persian with vowel marks so the voice pronounces them correctly.
- Product titles are shortened for speech (`inquiry.spoken_title`).

### Diagnostics

- `python -m app.voiptest <phone> [info]` or `POST /api/voip-test`: rings a phone, collects keys, reports
  which keys arrived and how, audio packet counts and SIP log lines.
- `NET_PROBE=true`: logs at startup whether UDP and SIP (UDP/TLS) can leave the host.
- `SEED_TEST_SHOP=true`: seeds a 24/7 test shop so the inquiry button is always available.
- `INQUIRY_CALL_OVERRIDE` / `VERIFY_SMS_OVERRIDE` send calls and SMS to a test number instead of real shops.
