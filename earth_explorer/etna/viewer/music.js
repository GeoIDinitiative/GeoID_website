(function () {
  const TRACKS = [
    "/earth_explorer/assets/music/atlasaudio-ambient-cinematic-510518.mp3",
    "/earth_explorer/assets/music/grand_project-soul-of-the-earth_10min-391197.mp3",
    "/earth_explorer/assets/music/leberch-atmospheric-documentary-509386.mp3",
    "/earth_explorer/assets/music/leberch-soft-music-519312.mp3",
    "/earth_explorer/assets/music/the_mountain-cinematic-wave-136949.mp3",
    "/earth_explorer/assets/music/tunetank-cinematic-ambient-348342.mp3",
  ];
  let playlist = [];
  let trackIndex = 0, manuallyPaused = false, videoActive = false;
  const audio = new Audio();
  audio.volume = 0.28;

  function shuffleTracks(tracks) {
    const s = tracks.slice();
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    return s;
  }
  function setTrack(index) {
    if (!playlist.length) return;
    audio.src = encodeURI(playlist[index]);
  }
  function rebuildPlaylist(startIndex = 0) {
    playlist = shuffleTracks(TRACKS);
    trackIndex = Math.max(0, Math.min(startIndex, playlist.length - 1));
    setTrack(trackIndex);
  }
  rebuildPlaylist(0);

  audio.addEventListener("ended", () => {
    if (!playlist.length) return;
    trackIndex += 1;
    if (trackIndex >= playlist.length) rebuildPlaylist(0);
    else setTrack(trackIndex);
    audio.play().catch(() => {});
  });

  const btn = document.getElementById("music-btn");
  audio.addEventListener("play",  () => { if (btn) { btn.textContent = "⏸ MUSIC"; btn.title = "Pause music"; btn.classList.remove("is-paused"); } });
  audio.addEventListener("pause", () => { if (btn) { btn.textContent = "▶ MUSIC"; btn.title = "Play music";  btn.classList.add("is-paused"); } });

  audio.play().catch(() => {
    // Browser blocked autoplay — retry on first user gesture
    const unlock = () => {
      if (!manuallyPaused && !videoActive) audio.play().catch(() => {});
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
  });

  if (btn) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (audio.paused) { manuallyPaused = false; audio.play().catch(() => {}); }
      else              { manuallyPaused = true;  audio.pause(); }
    });
  }

  // Pause ambient music while the INGV video is playing
  const videoEl = document.getElementById("etna-video-el");
  if (videoEl) {
    videoEl.addEventListener("play",  () => { videoActive = true;  if (!audio.paused) audio.pause(); });
    const onVideoStop = () => { videoActive = false; if (!manuallyPaused) audio.play().catch(() => {}); };
    videoEl.addEventListener("pause", onVideoStop);
    videoEl.addEventListener("ended", onVideoStop);
  }
})();
