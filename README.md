# jellyfin-zapping

Channel surfing for **Jellyfin Live TV** in the web client: jump to the next or previous channel without going back to the guide, plus a quick guide showing what is on air right now.

*Italiano più sotto.*

## Features

While a Live TV channel is playing:

| Action | Mouse | Keyboard |
|---|---|---|
| Next / previous channel | ▲ / ▼ buttons | `PageUp` / `PageDown` (also `ChannelUp` / `ChannelDown` remotes) |
| Last channel watched | — | `Backspace` |
| Quick guide (all channels, program on air, progress) | ☰ button | `G`, then `↑` `↓` `Enter`, `Esc` to close |

- The buttons appear and hide together with Jellyfin's own on-screen controls.
- Channels are ordered by channel number.
- **Anti-stutter cushion:** many IPTV sources deliver video in bursts. After the first stall the player waits until ~20 s are buffered before resuming, so later gaps are absorbed. Set `BUFFER_TARGET = 0` at the top of `zapping.js` to disable it.
- Interface in English, Italian and German (follows the browser/Jellyfin language).

It uses only the regular Jellyfin API: the web client asks the server to play the next channel in its own session, so the normal Jellyfin player does the work.

**Limits:** web client only (browser, and apps that wrap the web client). Native Android TV / Fire TV / iOS apps are not affected. Tested with Jellyfin 10.11 (jellyfin-web 12.1) and an M3U tuner.

## Install

### Option A — JavaScript Injector plugin (no shell access needed)

If you use a plugin that injects custom JavaScript into the web client, paste the content of `zapping.js` into it and save.

### Option B — install script (Debian/Ubuntu package, LXC, VM)

```sh
git clone https://github.com/nebry-ber/jellyfin-zapping.git
cd jellyfin-zapping
sudo sh install.sh
```

The script copies `zapping.js` next to the web client, adds one `<script>` tag to `index.html`, and installs an apt hook that re-applies it after every `jellyfin-web` upgrade. Reload Jellyfin in the browser afterwards.

Custom location: `sudo sh install.sh --web /path/to/jellyfin-web`
Uninstall: `sudo sh install.sh --uninstall`

### Docker

The web files are inside the image, so changes are lost when the container is recreated. Either use option A, or mount a modified `index.html` plus `zapping.js` into the web folder (`/jellyfin/jellyfin-web` in the official image, `/usr/share/jellyfin/web` in linuxserver).

## Tips for smoother Live TV

Not part of the script, but they helped a lot on our server (Dashboard → Playback / Live TV):

- If channels are re-encoded to **AV1 or HEVC in software**, switching is slow and CPU-heavy. Disabling *Allow encoding in AV1/HEVC* makes fallback transcoding use H.264, which starts much faster.
- On M3U tuners, *Read input at native frame rate* slows down the initial buffering; turning it off made channels start faster for us.

---

## Italiano

Zapping per la **TV in diretta di Jellyfin** dal browser: passi al canale successivo o precedente senza tornare alla guida, e hai una guida rapida con quello che va in onda adesso.

- **▲ / ▼** o **PagSu / PagGiù**: canale successivo / precedente; **Backspace**: ultimo canale visto.
- **☰** o tasto **G**: guida rapida con tutti i canali e il programma in onda; frecce e Invio per scegliere, Esc per chiudere.
- I pulsanti compaiono e spariscono insieme alla barra di Jellyfin.
- **Margine anti-scatti:** al primo blocco il player aspetta ~20 secondi di buffer prima di ripartire, così le pause della sorgente non si sentono più (`BUFFER_TARGET = 0` per disattivarlo).

Installazione: `sudo sh install.sh` sul server (pacchetto Debian/Ubuntu), oppure incolla `zapping.js` in un plugin che inietta JavaScript nel client web. Funziona solo nel client web, non nelle app native.

## License

MIT
