# Invisible

A local-first desktop assistant that listens to a live conversation, transcribes
it, and streams model-generated advice onto a transparent overlay that is
excluded from screen capture.

Everything runs on the machine. No audio, transcript, or model call leaves the
host.

---

## Before you use this

**Recording a conversation without the other party's consent is unlawful in
two-party-consent jurisdictions** — including California, Washington, Illinois,
and most of the EU. The design reflects that: audio is never written to disk,
the transcript lives only in memory capped at 40 turns, and one keystroke
(`Ctrl+Shift+X`) stops capture, clears state, and hides the overlay.

**Using this in a live interview is deception of the interviewer.** Most
employers treat it as grounds for rescinding an offer, and some proctored
platforms detect overlay or process anomalies. The software does not enforce
that judgement; it is yours to make.

**What the capture exclusion does and does not do.** `setContentProtection`
maps to `WDA_EXCLUDEFROMCAPTURE` on Windows. It defeats Zoom, Teams, Meet, OBS,
Game Bar, and PrintScreen. It does **not** defeat a phone camera pointed at the
screen, and it does **not** hide the process from software that enumerates
running executables.

---

## Requirements

| | |
|---|---|
| OS | Windows 11 x64 |
| GPU | NVIDIA, 12 GB VRAM or more. Developed on an RTX 4090 (24 GB). |
| Docker | Docker Desktop with the WSL2 backend and working GPU passthrough |
| Node | 24 or newer |
| Disk | ~13 GB — 1.1 GB whisper binary, 1.6 GB whisper model, 9 GB answer model |
| Audio | **Headphones are mandatory.** Through speakers, the microphone
re-captures system audio and every remote utterance is transcribed twice. |

Verify Docker can reach the GPU before anything else:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

If that does not print your GPU, nothing below will work at a usable speed.

---

## Setup

```bash
npm install                 # also vendors the VAD and ONNX assets
npm run services:up         # Ollama + Qdrant containers, GPU-enabled
npm run ollama:pull         # answer model, 9 GB
npm run embed:pull          # embedding model, 274 MB
npm run fetch-whisper       # whisper binary + model, 2.3 GB
npm run dev
```

Then press `Ctrl+Shift+,` and read the **Setup** panel. It probes every
dependency and prints the exact command for anything missing. It never changes
anything itself — every fix is a command you run.

### Grounding answers in your own material

Drop markdown into `corpus/` — résumé, project write-ups, prepared STAR
stories, notes on the company — then:

```bash
npm run ingest
```

Write **one idea per `##` section**: chunks split on headings, so a section that
is one coherent story retrieves cleanly while a section covering four jobs
retrieves as mush. See `corpus/README.md`. Nothing in that directory is
committed.

Without a corpus the app works fine; answers are simply less specific.

---

## Shortcuts

| | |
|---|---|
| `Ctrl+Shift+\` | Show / hide the overlay |
| `Ctrl+Shift+Enter` | Toggle click-through (blue border = clickable) |
| `Ctrl+Shift+Space` | Answer the last question again |
| `Ctrl+Shift+K` | Clear the transcript |
| `Ctrl+Shift+X` | Panic — stop capture, clear, hide |
| `Ctrl+Shift+Arrows` | Move the overlay |
| `Ctrl+Shift+,` | Settings |
| `Ctrl+Shift+M` | Toggle interview / meeting mode |
| `Ctrl+Shift+/` | Type a question to the assistant |
| `Ctrl+Shift+.` | Cycle answer style (auto / bullets / spoken / brief) |
| `Ctrl+Shift+E` | Export meeting notes to Documents\Invisible |
| `Ctrl+Shift+;` | Answer the text currently on the clipboard |
| `Ctrl+Shift+O` | Jump the overlay to the next screen corner |
| `Ctrl+Shift+'` | Resume capture after panic |

---

## How it works

```
microphone ─┐                                    ┌─ Qdrant (your corpus)
            ├─ Silero VAD ─ whisper.cpp ─ triage ┤
system audio┘                                    └─ Ollama ─ overlay
```

Speaker identity comes from which capture chain the audio arrived on, so no
diarization model is needed. Your own speech is transcribed but never answered.

Measured end to end: **~673 ms** from end of question to first visible word —
384 ms VAD close, 113 ms transcription, 60 ms retrieval, 164 ms to first token.

---

## Building an installer

```bash
npm run dist
```

Produces `release/Invisible Setup 0.1.0.exe`, about 107 MB. It bundles app code
only — place `bin/` and `models/` beside the installed `Invisible.exe`, or run
`npm run fetch-whisper` from a source checkout and copy them across.

**The installer is unsigned.** Windows SmartScreen will warn on first run;
dismiss it with *More info → Run anyway*.

---

## Design documents

`docs/superpowers/specs/` holds the design and every decision that changed
during implementation, with the measurements behind each.
`docs/superpowers/plans/` holds the per-phase implementation plans.
