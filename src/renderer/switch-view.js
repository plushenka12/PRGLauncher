// Switch window page: plays the capture card named in the URL (video + its
// sound) full screen. No launcher bridge; the main process closes it on Esc.
(function switchView() {
  const params = new URLSearchParams(location.search);
  const lang = params.get('lang') === 'en' ? 'en' : 'uk';
  const TEXT = {
    uk: {
      opening: 'Підключаю картку захоплення…', close: 'Esc — закрити', noAudio: 'без звуку',
      busy: 'Картку зайнято іншою програмою', busyHint: 'Закрий OBS або іншу програму, що показує картку, і відкрий вікно Switch ще раз.',
      missing: 'Картку захоплення не знайдено', missingHint: 'Перевір, що вона підключена, і вибери її в налаштуваннях лаунчера → Загальні → Вікно Switch.',
      failed: 'Не вдалося відкрити картку', signal: 'Немає сигналу? Перевір, що Switch увімкнений і в доці.',
      replayKey: seconds => `S — зберегти останні ${seconds} с`, saving: 'Зберігаю кліп…', saved: 'Кліп збережено',
      savedWhere: 'Відео → PRGLauncher Switch', replayOff: 'Буфер повтору недоступний на цьому ПК', clip: 'Зберегти кліп',
      replayEmpty: 'Буфер ще порожній — спробуй за секунду',
      replayStuck: 'Буфер повтору не записує', replayStuckHint: 'Відеокарта не віддає кадри для запису. Зазвичай допомагає перезапуск ПК; гра у вікні працює й так.',
      fullKey: 'F11 — на весь екран', shotKey: 'P — скріншот', shot: 'Скріншот збережено', outputMissing: 'Вибраний звуковий вихід не підключено — граю через стандартний вихід Windows',
    },
    en: {
      opening: 'Connecting to the capture card…', close: 'Esc — close', noAudio: 'no sound',
      busy: 'The capture card is in use by another app', busyHint: 'Close OBS or any other app showing the card, then open the Switch window again.',
      missing: 'Capture card not found', missingHint: 'Check that it is plugged in and choose it in launcher Settings → General → Switch window.',
      failed: 'Could not open the capture card', signal: 'No picture? Check that the Switch is on and docked.',
      replayKey: seconds => `S — save the last ${seconds} s`, saving: 'Saving the clip…', saved: 'Clip saved',
      savedWhere: 'Videos → PRGLauncher Switch', replayOff: 'The replay buffer is not available on this PC', clip: 'Save clip',
      replayEmpty: 'The buffer is still empty — try again in a second',
      replayStuck: 'The replay buffer is not recording', replayStuckHint: 'The graphics card is not passing frames to the recorder. A PC restart usually helps; the picture works either way.',
      fullKey: 'F11 — full screen', shotKey: 'P — screenshot', shot: 'Screenshot saved', outputMissing: 'The chosen sound output is not connected — playing through the Windows default',
    },
  }[lang];
  const QUALITY = { '1080p60': [1920, 1080, 60], '720p60': [1280, 720, 60], '1080p30': [1920, 1080, 30] };
  const BITRATE = { '1080p60': 12_000_000, '720p60': 8_000_000, '1080p30': 8_000_000 };
  const replaySeconds = [30, 60].includes(Number(params.get('replay'))) ? Number(params.get('replay')) : 0;
  const clipButton = document.getElementById('clip');
  let replay = null;
  let saving = false;
  const CAPTURE = /(cam ?link|elgato|avermedia|live gamer|capture|hdmi|usb video|game ?capture|hd60|4k60|ezcap|ripsaw|magewell)/i;
  const video = document.getElementById('video');
  const hud = document.getElementById('hud');
  let hideTimer = null;

  function show(title, detail = '', { error = false, sticky = false } = {}) {
    hud.className = `hud${error ? ' error' : ''}`;
    const heading = document.createElement('b');
    heading.textContent = title;
    hud.replaceChildren(heading, ...String(detail).split('\n').filter(Boolean).map(line => { const span = document.createElement('span'); span.textContent = line; return span; }));
    clearTimeout(hideTimer);
    if (!sticky) hideTimer = setTimeout(() => hud.classList.add('hide'), 4000);
  }

  // A saved device id can change (another USB port, a driver update), so the
  // label is the fallback.
  function findDevice(devices, kind, id, label) {
    const list = devices.filter(device => device.kind === kind);
    return list.find(device => device.deviceId === id) || (label && list.find(device => device.label === label)) || null;
  }

  async function start() {
    show(TEXT.opening, '', { sticky: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const camera = findDevice(devices, 'videoinput', params.get('video'), params.get('videoLabel'));
    if (!camera) { show(TEXT.missing, TEXT.missingHint, { error: true, sticky: true }); return; }
    const audioChoice = params.get('audio') || 'auto';
    const audios = devices.filter(device => device.kind === 'audioinput');
    const microphone = audioChoice === 'none' ? null
      : audioChoice === 'auto' ? (audios.find(device => device.groupId && device.groupId === camera.groupId) || audios.find(device => CAPTURE.test(device.label)) || null)
        : findDevice(devices, 'audioinput', audioChoice, params.get('audioLabel'));
    const [width, height, frameRate] = QUALITY[params.get('quality')] || QUALITY['1080p60'];
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: camera.deviceId }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
      // Game sound, not a voice: no echo cancelling, noise suppression or gain.
      audio: microphone ? { deviceId: { exact: microphone.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 } : false,
    });
    video.srcObject = stream;
    video.muted = false;
    // Sound can go to another output than the Windows default (headphones
    // for the game, speakers for the rest). A missing output falls back.
    let outputNote = '';
    const outputId = params.get('output') || 'default';
    if (microphone && outputId !== 'default' && typeof video.setSinkId === 'function') {
      const output = findDevice(await navigator.mediaDevices.enumerateDevices(), 'audiooutput', outputId, params.get('outputLabel'));
      if (output) { try { await video.setSinkId(output.deviceId); outputNote = ` → ${output.label}`; } catch { outputNote = ''; } }
      else outputNote = `\n${TEXT.outputMissing}`;
    }
    const settings = stream.getVideoTracks()[0].getSettings();
    if (replaySeconds) {
      replay = window.PRGSwitchReplay ? window.PRGSwitchReplay.create(stream, { seconds: replaySeconds, bitrate: BITRATE[params.get('quality')] || BITRATE['1080p60'] }) : null;
      clipButton.textContent = TEXT.clip;
      clipButton.hidden = !replay;
      // The recorder starts but some GPU driver states give it no frames.
      if (replay) setTimeout(() => { if (replay && !replay.hasData()) show(TEXT.replayStuck, TEXT.replayStuckHint, { sticky: true }); }, 6000);
    }
    const replayLine = !replaySeconds ? '' : replay ? `\n${TEXT.replayKey(replaySeconds)}` : `\n${TEXT.replayOff}`;
    show(camera.label, `${settings.width}×${settings.height} · ${Math.round(settings.frameRate || frameRate)} fps · ${microphone ? microphone.label : TEXT.noAudio}${outputNote}\n${TEXT.close}${params.get('mode') === 'window' ? ` · ${TEXT.fullKey}` : ''} · ${TEXT.shotKey}${replayLine}`);
    // No frames at all after a few seconds usually means no HDMI signal.
    let frames = 0;
    const count = () => { frames++; video.requestVideoFrameCallback(count); };
    video.requestVideoFrameCallback(count);
    setTimeout(() => { if (!frames) show(camera.label, TEXT.signal, { sticky: true }); }, 4000);
    stream.getVideoTracks()[0].addEventListener('ended', () => show(TEXT.missing, TEXT.missingHint, { error: true, sticky: true }));
  }

  // Clips and screenshots are handed to the main process as downloads; it
  // saves them to Videos\PRGLauncher Switch without asking, so play is not
  // interrupted. Names use the local time.
  function stamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  }
  function download(blob, extension) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `PRG Switch ${stamp()}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  }

  // The frame as the card delivers it, at full resolution.
  function saveScreenshot() {
    if (!video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      download(blob, 'png');
      show(TEXT.shot, TEXT.savedWhere);
    }, 'image/png');
  }

  async function saveClip() {
    if (!replay || saving) return;
    saving = true;
    show(TEXT.saving);
    try {
      const clip = await replay.save();
      if (!clip || !clip.blob.size) { show(TEXT.replayEmpty); return; }
      download(clip.blob, clip.extension);
      show(TEXT.saved, `${TEXT.savedWhere} · ${Math.round(clip.durationMs / 1000)} s`);
    } finally {
      saving = false;
    }
  }
  document.addEventListener('keydown', event => {
    if (event.repeat) return;
    if (event.code === 'KeyS') saveClip();
    else if (event.code === 'KeyP') saveScreenshot();
  });
  clipButton.addEventListener('click', saveClip);
  window.addEventListener('pagehide', () => replay && replay.stop());

  // Show the pointer only while it moves.
  let pointerTimer = null;
  document.addEventListener('mousemove', () => {
    document.body.classList.add('pointer');
    clearTimeout(pointerTimer);
    pointerTimer = setTimeout(() => document.body.classList.remove('pointer'), 1500);
  });

  start().catch(error => {
    if (error && (error.name === 'NotReadableError' || error.name === 'TrackStartError')) show(TEXT.busy, TEXT.busyHint, { error: true, sticky: true });
    else if (error && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) show(TEXT.missing, TEXT.missingHint, { error: true, sticky: true });
    else show(TEXT.failed, error && error.message ? error.message : '', { error: true, sticky: true });
  });
})();
