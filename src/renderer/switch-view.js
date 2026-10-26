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
    },
    en: {
      opening: 'Connecting to the capture card…', close: 'Esc — close', noAudio: 'no sound',
      busy: 'The capture card is in use by another app', busyHint: 'Close OBS or any other app showing the card, then open the Switch window again.',
      missing: 'Capture card not found', missingHint: 'Check that it is plugged in and choose it in launcher Settings → General → Switch window.',
      failed: 'Could not open the capture card', signal: 'No picture? Check that the Switch is on and docked.',
      replayKey: seconds => `S — save the last ${seconds} s`, saving: 'Saving the clip…', saved: 'Clip saved',
      savedWhere: 'Videos → PRGLauncher Switch', replayOff: 'The replay buffer is not available on this PC', clip: 'Save clip',
      replayEmpty: 'The buffer is still empty — try again in a second',
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
    const settings = stream.getVideoTracks()[0].getSettings();
    if (replaySeconds) {
      replay = window.PRGSwitchReplay ? window.PRGSwitchReplay.create(stream, { seconds: replaySeconds, bitrate: BITRATE[params.get('quality')] || BITRATE['1080p60'] }) : null;
      clipButton.textContent = TEXT.clip;
      clipButton.hidden = !replay;
    }
    const replayLine = !replaySeconds ? '' : replay ? `\n${TEXT.replayKey(replaySeconds)}` : `\n${TEXT.replayOff}`;
    show(camera.label, `${settings.width}×${settings.height} · ${Math.round(settings.frameRate || frameRate)} fps · ${microphone ? microphone.label : TEXT.noAudio}\n${TEXT.close}${replayLine}`);
    // No frames at all after a few seconds usually means no HDMI signal.
    let frames = 0;
    const count = () => { frames++; video.requestVideoFrameCallback(count); };
    video.requestVideoFrameCallback(count);
    setTimeout(() => { if (!frames) show(camera.label, TEXT.signal, { sticky: true }); }, 4000);
    stream.getVideoTracks()[0].addEventListener('ended', () => show(TEXT.missing, TEXT.missingHint, { error: true, sticky: true }));
  }

  // The clip is handed to the main process as a download; it saves it to
  // Videos\PRGLauncher Switch without asking, so play is not interrupted.
  async function saveClip() {
    if (!replay || saving) return;
    saving = true;
    show(TEXT.saving);
    try {
      const clip = await replay.save();
      if (!clip || !clip.blob.size) { show(TEXT.replayEmpty); return; }
      const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(clip.blob);
      link.download = `PRG Switch ${stamp}.${clip.extension}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60000);
      show(TEXT.saved, `${TEXT.savedWhere} · ${Math.round(clip.durationMs / 1000)} s`);
    } finally {
      saving = false;
    }
  }
  document.addEventListener('keydown', event => { if (event.code === 'KeyS' && !event.repeat) saveClip(); });
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
