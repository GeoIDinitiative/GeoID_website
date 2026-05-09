(function () {
      const TRACKS = [
        "../../../assets/music/Go Now, Explore... (1).mp3",
        "../../../assets/music/Go Now, Explore....mp3",
        "../../../assets/music/Mars.mp3",
        "../../../assets/music/Mars2.mp3",
        "../../../assets/music/Olympus Mons2.mp3",
        "../../../assets/music/Space Age.mp3",
        "../../../assets/music/cfl_turningpages-stellar-opus-386735.mp3",
        "../../../assets/music/nikitakondrashev-space-440026.mp3",
        "../../../assets/music/sigmamusicart-space-ambient-background-music-462074.mp3",
        "../../../assets/music/slicedcorpse-retrowave-ambient-dreamwave-relaxing-music-v2-324013.mp3",
        "../../../assets/music/universfield-ambient-space-background-350710.mp3",
      ];
      let playlist = [];
      let trackIndex = 0, manuallyPaused = false, nasaActive = false;
      const audio = new Audio();
      audio.volume = 0.3;
      function shuffleTracks(tracks) {
        const shuffled = tracks.slice();
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
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
        if (trackIndex >= playlist.length) {
          rebuildPlaylist(0);
        } else {
          setTrack(trackIndex);
        }
        audio.play().catch(() => {});
      });
      const btn = document.getElementById("music-btn");
      audio.addEventListener("play",  () => { btn.textContent = "⏸ MUSIC"; btn.title = "Pause music"; btn.classList.remove("is-paused"); });
      audio.addEventListener("pause", () => { btn.textContent = "▶ MUSIC"; btn.title = "Play music";  btn.classList.add("is-paused"); });
      audio.play().catch(() => {
        // Browser blocked autoplay (no prior interaction). Retry on the first user gesture —
        // which happens almost immediately as the user starts exploring the 3D scene.
        const unlock = () => {
          if (!manuallyPaused) { audio.play().catch(() => {}); }
          document.removeEventListener("pointerdown", unlock, true);
          document.removeEventListener("keydown", unlock, true);
        };
        document.addEventListener("pointerdown", unlock, true);
        document.addEventListener("keydown", unlock, true);
      });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (audio.paused) { manuallyPaused = false; audio.play().catch(() => {}); }
        else              { manuallyPaused = true;  audio.pause(); }
      });
      const nasaAudioEl = document.getElementById("mars-audio-el");
      if (nasaAudioEl) {
        nasaAudioEl.addEventListener("play", () => { nasaActive = true; if (!audio.paused) audio.pause(); });
        const nasaStop = () => { nasaActive = false; if (!manuallyPaused) audio.play().catch(() => {}); };
        nasaAudioEl.addEventListener("pause", nasaStop);
        nasaAudioEl.addEventListener("ended", nasaStop);
      }
    })();
