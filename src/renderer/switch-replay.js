// Replay buffer for the Switch window: keeps the last N seconds of the capture
// card in memory so a moment can be saved after it happened.
// A recording only plays from its own start, so old chunks cannot simply be
// dropped. Two recorders take turns instead: each restarts every 2×N seconds,
// N seconds apart, so the older one always holds between N and 2×N seconds.
(function exposeSwitchReplay(global) {
  const TYPES = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1.640028,opus', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];

  function pickType(hasAudio, isSupported) {
    for (const [type, extension] of TYPES) {
      const candidate = hasAudio ? type : type.replace(/,(mp4a\.40\.2|opus)$/, '');
      if (isSupported(candidate)) return { type: candidate, extension };
    }
    return null;
  }

  function create(stream, { seconds, bitrate = 10_000_000, Recorder = global.MediaRecorder, now = () => Date.now() } = {}) {
    if (!Recorder || !(seconds > 0)) return null;
    const format = pickType(stream.getAudioTracks().length > 0, type => Recorder.isTypeSupported(type));
    if (!format) return null;
    const period = seconds * 2000;
    const slots = [{}, {}];
    let timer = null;
    let stopped = false;

    function begin(slot) {
      // MP4 is written a fragment per keyframe; without a fixed interval a
      // flushed recording can hold no playable frame at all.
      const recorder = new Recorder(stream, { mimeType: format.type, videoBitsPerSecond: bitrate, videoKeyFrameIntervalDuration: 1000 });
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.start(1000);
      Object.assign(slot, { recorder, chunks, started: now() });
    }

    function drop(slot) {
      if (!slot.recorder) return;
      slot.recorder.ondataavailable = null;
      if (slot.recorder.state !== 'inactive') slot.recorder.stop();
      slot.recorder = null;
      slot.chunks = [];
    }

    function tick() {
      const time = now();
      for (const slot of slots) if (slot.recorder && time - slot.started >= period) { drop(slot); begin(slot); }
    }

    begin(slots[0]);
    // The second recorder joins N seconds later.
    const second = setTimeout(() => { if (!stopped) begin(slots[1]); }, seconds * 1000);
    timer = setInterval(tick, 1000);

    // Flushes the older recorder without stopping it, so the buffer keeps
    // running, and returns what it holds as one playable file.
    function save() {
      const slot = slots.filter(item => item.recorder).sort((a, b) => a.started - b.started)[0];
      if (!slot) return Promise.resolve(null);
      const { recorder, chunks, started } = slot;
      return new Promise(resolve => {
        const done = () => {
          recorder.removeEventListener('dataavailable', done);
          resolve({ blob: new Blob(chunks.slice(), { type: format.type.split(';')[0] }), extension: format.extension, durationMs: now() - started });
        };
        // The slot's own handler runs first and appends the final chunk.
        recorder.addEventListener('dataavailable', done);
        recorder.requestData();
      });
    }

    function stop() {
      stopped = true;
      clearTimeout(second);
      clearInterval(timer);
      slots.forEach(drop);
    }

    return { save, stop, format };
  }

  global.PRGSwitchReplay = { create, pickType };
})(typeof window !== 'undefined' ? window : globalThis);
