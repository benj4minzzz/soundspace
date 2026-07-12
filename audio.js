/**
 * Sound Space Rhythm Game - Audio & Beatmap Controller
 * Handles YouTube Iframe API and Web Audio API (for local uploads).
 * Performs energy-peak beat analysis on local files and seeded-procedural beatmap generation for YouTube.
 */

// Helper: Seeded pseudo-random number generator (Mulberry32)
function seededRandom(seed) {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Helper: String hash function
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

class AudioController {
  constructor() {
    this.mode = 'yt'; // 'yt' or 'local'
    this.ytPlayer = null;
    this.ytReady = false;
    
    // Web Audio API fields
    this.audioCtx = null;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.analyserNode = null;
    
    // Game sync variables
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.duration = 0;
    this.activeVideoId = 'a8XAOMeWdqY';
    
    // High-precision YouTube sync clock variables
    this.lastSyncTime = 0;
    this.lastYtTime = 0;
    this.smoothedOffset = null; // Phase-Locked Loop smoothed offset for visual sync
    
    // Callbacks
    this.onStateChange = null; // function(state) -> 'playing', 'paused', 'ended'
    this.onTimeUpdate = null; // function(time, percent)
    
    // Timer for YouTube syncing
    this.ytSyncInterval = null;

    this.initYouTube();
  }

  initYouTube() {
    // 1. Declare the global callback BEFORE injecting the script
    window.onYouTubeIframeAPIReady = () => {
      console.log("YouTube IFrame API Ready event fired.");
      this.setupYTPlayer();
    };

    // 2. Check if YT is already loaded
    if (window.YT && window.YT.Player) {
      console.log("YouTube Player API already loaded.");
      this.setupYTPlayer();
      return;
    }

    // 3. Dynamically inject the YouTube IFrame Player API script tag
    try {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.head.appendChild(tag);
      }
      console.log("Dynamically injected YouTube IFrame API script tag.");
    } catch (e) {
      console.error("Failed to inject YouTube script:", e);
    }
  }

  setupYTPlayer() {
    console.log("Setting up YT.Player...");
    try {
      this.ytPlayer = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        videoId: 'a8XAOMeWdqY', // Requested YouTube Music video as default
        playerVars: {
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          // Only pass origin if running in http/https to prevent file:// protocol blocking
          ...(window.location.protocol.startsWith('http') ? { origin: window.location.origin } : {})
        },
        events: {
          onReady: () => {
            this.ytReady = true;
            console.log("YouTube Player Ready event fired.");
          },
          onStateChange: (event) => {
            this.handleYTStateChange(event.data);
          },
          onError: (event) => {
            console.error("YouTube Player Error Code:", event.data);
            alert("YouTube Playback Error (code: " + event.data + "). Note that some music tracks may be blocked outside YouTube or require licensing agreements. Try another link or local audio!");
          }
        }
      });
    } catch (err) {
      console.error("Failed to construct YT.Player:", err);
    }
  }

  handleYTStateChange(state) {
    if (!this.isPlaying && this.mode === 'yt') return;

    if (state === YT.PlayerState.PLAYING) {
      this.smoothedOffset = null; // reset clock sync baseline
      if (this.onStateChange) this.onStateChange('playing');
      this.startYTSyncTimer();
    } else if (state === YT.PlayerState.PAUSED) {
      if (this.onStateChange) this.onStateChange('paused');
      this.stopYTSyncTimer();
    } else if (state === YT.PlayerState.ENDED) {
      if (this.onStateChange) this.onStateChange('ended');
      this.stopYTSyncTimer();
    }
  }

  startYTSyncTimer() {
    this.stopYTSyncTimer();
    this.ytSyncInterval = setInterval(() => {
      if (!this.ytPlayer || typeof this.ytPlayer.getCurrentTime !== 'function') return;
      const curTime = this.ytPlayer.getCurrentTime();
      const dur = this.ytPlayer.getDuration() || 1;
      this.duration = dur;
      if (this.onTimeUpdate) {
        this.onTimeUpdate(curTime, curTime / dur);
      }
    }, 100);
  }

  stopYTSyncTimer() {
    if (this.ytSyncInterval) {
      clearInterval(this.ytSyncInterval);
      this.ytSyncInterval = null;
    }
  }

  parseYoutubeId(url) {
    if (!url) return null;
    url = url.trim();

    // Direct ID check
    if (url.length === 11 && !url.includes('/') && !url.includes('.')) {
      return url;
    }

    // Match standard patterns
    const regExp = /(?:v=|\/v\/|\/embed\/|\/shorts\/|youtu\.be\/|\/watch\?v=)([^"&?\/\s]{11})/i;
    const match = url.match(regExp);
    if (match) return match[1];
    
    // Fallback: search for any 11-char alphanumeric pattern if there is a 11-char segment in path or queries
    const parts = url.split(/[?&/=\s]+/);
    for (const part of parts) {
      if (part.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(part)) {
        return part;
      }
    }
    return null;
  }

  loadYoutubeSong(url) {
    return new Promise(async (resolve, reject) => {
      this.mode = 'yt';
      const videoId = this.parseYoutubeId(url);
      
      if (!videoId) {
        reject(new Error("Invalid YouTube URL or Video ID. Check your link and try again."));
        return;
      }

      this.activeVideoId = videoId;

      console.log("Loading YouTube Video ID:", videoId);

      // Async wait loop for YouTube API initialization (up to 5 seconds)
      let waitAttempts = 0;
      while ((!this.ytReady || !this.ytPlayer || typeof this.ytPlayer.cueVideoById !== 'function') && waitAttempts < 50) {
        await new Promise(r => setTimeout(r, 100));
        waitAttempts++;
      }

      if (!this.ytReady || !this.ytPlayer || typeof this.ytPlayer.cueVideoById !== 'function') {
        reject(new Error("YouTube IFrame Player API failed to initialize. If you opened the file directly, please try running it through http://localhost:8000/ instead."));
        return;
      }

      try {
        this.ytPlayer.cueVideoById({
          videoId: videoId
        });
        
        // Wait for player to load metadata and duration for the NEW video ID specifically
        let attempts = 0;
        const checkCued = setInterval(() => {
          const currentData = typeof this.ytPlayer.getVideoData === 'function' ? this.ytPlayer.getVideoData() : null;
          const currentId = currentData ? currentData.video_id : null;
          const dur = this.ytPlayer.getDuration();
          
          // Poll for official metadata. Continue polling for up to 3 seconds if metadata is generic/placeholder
          const hasRealMetadata = currentData && 
                                  currentData.title && 
                                  currentData.title !== "YouTube Audio" && 
                                  currentData.title !== "YouTube Video" &&
                                  currentData.author && 
                                  currentData.author !== "Unknown" &&
                                  currentData.author !== "";

          if (currentId === videoId && dur > 0 && (hasRealMetadata || attempts > 30)) {
            clearInterval(checkCued);
            this.duration = dur;
            this.activeTitle = currentData.title || "YouTube Audio";
            this.activeAuthor = currentData.author || "Unknown";
            resolve({
              videoId: videoId,
              duration: this.duration,
              title: this.activeTitle,
              author: this.activeAuthor
            });
          }
          
          attempts++;
          if (attempts > 50) { // 5 seconds timeout
            clearInterval(checkCued);
            const fallbackDur = (currentId === videoId && dur > 0) ? dur : 180;
            this.duration = fallbackDur;
            this.activeTitle = (currentData && currentData.video_id === videoId) ? (currentData.title || "YouTube Video") : "YouTube Video (Loaded)";
            this.activeAuthor = (currentData && currentData.video_id === videoId) ? (currentData.author || "Unknown") : "Unknown";
            resolve({
              videoId: videoId,
              duration: fallbackDur,
              title: this.activeTitle,
              author: this.activeAuthor
            });
          }
        }, 100);
      } catch (err) {
        reject(new Error("Error loading YouTube Video: " + err.message));
      }
    });
  }

  // Setup Web Audio context
  initAudioContext() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      // Node chains
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.gainNode = this.audioCtx.createGain();
      
      this.gainNode.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // Load a Local File
  loadLocalFile(file) {
    return new Promise((resolve, reject) => {
      this.mode = 'local';
      this.initAudioContext();

      const reader = new FileReader();
      reader.onload = (e) => {
        const arrayBuffer = e.target.result;
        
        // Decode
        this.audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
          this.audioBuffer = decodedBuffer;
          this.duration = decodedBuffer.duration;
          this.activeTitle = file.name;
          this.activeAuthor = "Local File";
          resolve({
            duration: this.duration,
            title: this.activeTitle,
            author: this.activeAuthor
          });
        }, (err) => {
          reject("Audio decoding failed. Ensure the file is not corrupted.");
        });
      };
      reader.onerror = () => reject("File reading failed.");
      reader.readAsArrayBuffer(file);
    });
  }

  // Play
  play() {
    this.isPlaying = true;
    if (this.mode === 'yt') {
      this.smoothedOffset = null; // reset clock sync baseline
      if (this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
        this.ytPlayer.playVideo();
      }
    } else {
      // Local play
      this.initAudioContext();
      
      // We must construct a new SourceNode every time we play
      this.sourceNode = this.audioCtx.createBufferSource();
      this.sourceNode.buffer = this.audioBuffer;
      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.gainNode);
      
      this.startTime = this.audioCtx.currentTime - this.pauseOffset;
      this.sourceNode.start(0, this.pauseOffset);
      
      if (this.onStateChange) this.onStateChange('playing');
      
      // Start local ticker timer
      this.startLocalTicker();
    }
  }

  // Pause
  pause() {
    this.isPlaying = false;
    if (this.mode === 'yt') {
      if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
        this.ytPlayer.pauseVideo();
      }
      this.stopYTSyncTimer();
    } else {
      // Local pause
      if (this.sourceNode) {
        try {
          this.sourceNode.stop();
        } catch(e) {}
        this.sourceNode = null;
      }
      this.pauseOffset = this.audioCtx.currentTime - this.startTime;
      if (this.onStateChange) this.onStateChange('paused');
      this.stopLocalTicker();
    }
  }

  // Stop/Reset
  stop() {
    this.isPlaying = false;
    if (this.mode === 'yt') {
      if (this.ytPlayer && typeof this.ytPlayer.stopVideo === 'function') {
        this.ytPlayer.stopVideo();
        this.ytPlayer.seekTo(0, true);
      }
      this.stopYTSyncTimer();
    } else {
      // Local stop
      if (this.sourceNode) {
        try {
          this.sourceNode.stop();
        } catch(e) {}
        this.sourceNode = null;
      }
      this.pauseOffset = 0;
      if (this.onStateChange) this.onStateChange('ended');
      this.stopLocalTicker();
    }
  }

  // Get current game/music time with high-precision extrapolation for YouTube
  getCurrentTime() {
    if (this.mode === 'yt') {
      if (!this.isPlaying) {
        return this.pauseOffset;
      }
      if (this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {
        const curTime = this.ytPlayer.getCurrentTime();
        const localTime = performance.now() / 1000;
        const offset = curTime - localTime;
        
        if (this.smoothedOffset === null) {
          this.smoothedOffset = offset;
        } else {
          // If the difference is large (seek / buffer stall), snap immediately
          if (Math.abs(offset - this.smoothedOffset) > 0.6) {
            this.smoothedOffset = offset;
          } else {
            // Apply exponential moving average filter to remove YouTube player tick jitter
            this.smoothedOffset = this.smoothedOffset * 0.97 + offset * 0.03;
          }
        }
        return localTime + this.smoothedOffset;
      }
      return 0;
    } else {
      if (!this.isPlaying) return this.pauseOffset;
      return this.audioCtx.currentTime - this.startTime;
    }
  }

  // Seek
  seekTo(seconds) {
    if (this.mode === 'yt') {
      this.smoothedOffset = null; // reset clock sync baseline
      if (this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
        this.ytPlayer.seekTo(seconds, true);
      }
    } else {
      const playing = this.isPlaying;
      if (playing) {
        this.pause();
      }
      this.pauseOffset = Math.max(0, Math.min(seconds, this.duration));
      if (playing) {
        this.play();
      } else {
        if (this.onTimeUpdate) {
          this.onTimeUpdate(this.pauseOffset, this.pauseOffset / this.duration);
        }
      }
    }
  }

  // Set Volume (0 to 1)
  setVolume(vol) {
    if (this.mode === 'yt') {
      if (this.ytPlayer && typeof this.ytPlayer.setVolume === 'function') {
        this.ytPlayer.setVolume(Math.floor(vol * 100));
      }
    } else {
      if (this.gainNode) {
        this.gainNode.gain.value = vol;
      }
    }
  }

  // Local ticker for timeline update
  startLocalTicker() {
    this.stopLocalTicker();
    this.localTicker = setInterval(() => {
      const curTime = this.getCurrentTime();
      if (curTime >= this.duration) {
        this.stop();
        if (this.onStateChange) this.onStateChange('ended');
      } else {
        if (this.onTimeUpdate) {
          this.onTimeUpdate(curTime, curTime / this.duration);
        }
      }
    }, 100);
  }

  stopLocalTicker() {
    if (this.localTicker) {
      clearInterval(this.localTicker);
      this.localTicker = null;
    }
  }

  // Time-domain bandpass filter (220Hz to 1100Hz) to isolate vocal presence
  filterVocals(channelData, sampleRate) {
    const len = channelData.length;
    const filtered = new Float32Array(len);
    
    // High-pass filter coefficients (220Hz) to cut out heavy bass drums/sub rumble
    const dt = 1.0 / sampleRate;
    const hpFreq = 220;
    const hpRC = 1.0 / (2 * Math.PI * hpFreq);
    const hpAlpha = hpRC / (hpRC + dt);
    
    let prevX = 0;
    let prevY = 0;
    const temp = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const x = channelData[i];
      const y = hpAlpha * (prevY + x - prevX);
      temp[i] = y;
      prevX = x;
      prevY = y;
    }
    
    // Low-pass filter coefficients (1100Hz) to cut out cymbals and high treble sibilance
    const lpFreq = 1100;
    const lpRC = 1.0 / (2 * Math.PI * lpFreq);
    const lpAlpha = dt / (lpRC + dt);
    
    let prevLP = 0;
    for (let i = 0; i < len; i++) {
      const x = temp[i];
      const y = prevLP + lpAlpha * (x - prevLP);
      filtered[i] = y;
      prevLP = y;
    }
    
    return filtered;
  }

  // Peak-Energy Beat Detection for Local Files
  detectLocalPeaks(difficulty, audioFocus) {
    if (!this.audioBuffer) return [];

    const sampleRate = this.audioBuffer.sampleRate;
    let channelData = this.audioBuffer.getChannelData(0); // Left channel

    // Apply voice bandpass filtering if requested
    if (audioFocus === 'vocal') {
      console.log("Audio DSP: Applying vocal bandpass filter (220Hz - 1100Hz)...");
      channelData = this.filterVocals(channelData, sampleRate);
    }

    // 20ms Window size
    const windowSeconds = 0.02;
    const windowSize = Math.floor(sampleRate * windowSeconds);
    const stepSize = windowSize;

    // 1. Calculate energy in sequential chunks
    const energies = [];
    for (let i = 0; i < channelData.length; i += stepSize) {
      let sum = 0;
      const end = Math.min(i + windowSize, channelData.length);
      for (let j = i; j < end; j++) {
        sum += channelData[j] * channelData[j];
      }
      const energy = Math.sqrt(sum / (end - i));
      energies.push({
        time: i / sampleRate,
        energy: energy
      });
    }

    // 2. Adjust threshold coefficient based on difficulty
    let thresholdMultiplier = 1.4;
    if (difficulty === 'easy') thresholdMultiplier = 1.8;
    if (difficulty === 'hard') thresholdMultiplier = 1.25;
    if (difficulty === 'brrr') thresholdMultiplier = 1.1;

    // Lower the threshold slightly for vocals to capture softer pitch transitions
    if (audioFocus === 'vocal') {
      thresholdMultiplier *= 0.92;
    }

    // If vocal mode is on, vocals are softer than raw beats, so lower the energy gate slightly
    const minEnergyGate = audioFocus === 'vocal' ? 0.022 : 0.04;

    const windowRadius = 15; // Moving window threshold approx 300ms on each side
    const peaks = [];

    for (let i = 0; i < energies.length; i++) {
      const start = Math.max(0, i - windowRadius);
      const end = Math.min(energies.length, i + windowRadius + 1);
      
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += energies[j].energy;
      }
      const localAverage = sum / (end - start);
      const energy = energies[i].energy;

      // Peak conditions
      if (energy > localAverage * thresholdMultiplier && energy > minEnergyGate) {
        const prevEnergy = i > 0 ? energies[i - 1].energy : 0;
        const nextEnergy = i < energies.length - 1 ? energies[i + 1].energy : 0;

        if (energy >= prevEnergy && energy >= nextEnergy) {
          peaks.push(energies[i].time);
        }
      }
    }

    // 3. Filter peaks by note distance limits (cool-down time)
    let minDistance = 0.25; // 250ms spacing
    if (difficulty === 'easy') minDistance = 0.45;
    if (difficulty === 'hard') minDistance = 0.18;
    if (difficulty === 'brrr') minDistance = 0.11;

    const filteredPeaks = [];
    let lastPeakTime = -999;

    for (let i = 0; i < peaks.length; i++) {
      const time = peaks[i];
      if (time - lastPeakTime >= minDistance) {
        // Safe buffer start delay
        if (time > 2.5) {
          filteredPeaks.push(time);
          lastPeakTime = time;
        }
      }
    }

    console.log(`Web Audio Peak Detection (${audioFocus} mode): Found ${filteredPeaks.length} notes.`);
    return filteredPeaks;
  }

  // Seeds and generates a beatmap for the song
  generateBeatmap(videoIdOrFilename, difficulty, gridSize, audioFocus = 'vocal', songOffset = 0) {
    const offsetSeconds = songOffset / 1000;

    if (this.mode === 'local' && this.audioBuffer) {
      // Local analysis
      const timestamps = this.detectLocalPeaks(difficulty, audioFocus);
      
      // Calculate an average peak density to estimate BPM for visual speed locking
      let localBpm = 120;
      if (timestamps.length > 2) {
        const first = timestamps[0];
        const last = timestamps[timestamps.length - 1];
        const avgInterval = (last - first) / (timestamps.length - 1);
        if (avgInterval > 0 && avgInterval < 5) {
          let baseInterval = avgInterval;
          while (baseInterval > 0.8) baseInterval /= 2;
          while (baseInterval < 0.3) baseInterval *= 2;
          localBpm = 60 / baseInterval;
        }
      }
      this.bpm = Math.max(90, Math.min(180, localBpm));
      console.log(`Local File Beat Detector: Estimated song BPM is ${this.bpm.toFixed(1)}`);
      
      // Distribute grid positions based on a simple PRNG seeded by the filename
      const seed = hashString(videoIdOrFilename);
      const rand = seededRandom(seed);
      
      let lastX = Math.floor(gridSize / 2);
      let lastY = Math.floor(gridSize / 2);

      return timestamps.map(time => {
        let nextX = lastX;
        let nextY = lastY;
        let attempts = 0;

        while (attempts < 10) {
          const dx = Math.floor(rand() * 3) - 1; // -1, 0, 1
          const dy = Math.floor(rand() * 3) - 1; // -1, 0, 1
          const tx = lastX + dx;
          const ty = lastY + dy;

          if (tx >= 0 && tx < gridSize && ty >= 0 && ty < gridSize && (dx !== 0 || dy !== 0)) {
            nextX = tx;
            nextY = ty;
            break;
          }
          attempts++;
        }

        if (nextX === lastX && nextY === lastY) {
          nextX = Math.floor(rand() * gridSize);
          nextY = Math.floor(rand() * gridSize);
        }

        lastX = nextX;
        lastY = nextY;

        // Shift timestamps by user offset
        return { time: Math.max(0, time + offsetSeconds), x: nextX, y: nextY };
      });

    } else {
      // Universal Phrase-Aligned Beat Generator for all YouTube tracks
      const seed = hashString(videoIdOrFilename || "soundspace");
      const rand = seededRandom(seed);
      
      // Seeded BPM estimate
      let bpm = 120;
      if (videoIdOrFilename === 'a8XAOMeWdqY') {
        bpm = 125;
      } else if (videoIdOrFilename === 'Qskm9MTz2V4') {
        bpm = 160; // Rush E actual BPM
      } else {
        bpm = (115 + (seed % 6) * 5);
      }
      this.bpm = bpm;
      const beatDuration = 60 / bpm;
      const notes = [];
      
      console.log(`YouTube Universal Beat Generator: BPM: ${bpm}. Offset: ${offsetSeconds}s`);
      
      if (!AudioController.LYRIC_INTERVALS || AudioController.LYRIC_INTERVALS.length === 0) {
        console.log(`Generating beatmap using tempo grid (BPM: ${bpm}). Duration: ${this.duration || 180}s`);
        
        let currentTime = offsetSeconds + 2.0; // Start notes 2 seconds in
        const endTime = (this.duration || 180) - 2.0; // End notes 2 seconds before end
        let step = difficulty === 'easy' ? 1.0 : (difficulty === 'medium' ? 0.5 : (difficulty === 'hard' ? 0.25 : 0.125));
        if (videoIdOrFilename === 'Qskm9MTz2V4') {
          step = difficulty === 'easy' ? 0.5 : (difficulty === 'medium' ? 0.25 : 0.125);
        }
        
        let lastX = Math.floor(gridSize / 2);
        let lastY = Math.floor(gridSize / 2);
        
        while (currentTime < endTime) {
          notes.push({
            time: currentTime,
            x: lastX,
            y: lastY
          });
          
          let nextX = lastX;
          let nextY = lastY;
          let attempts = 0;
          while (attempts < 10) {
            const dx = Math.floor(rand() * 3) - 1;
            const dy = Math.floor(rand() * 3) - 1;
            const tx = lastX + dx;
            const ty = lastY + dy;
            if (tx >= 0 && tx < gridSize && ty >= 0 && ty < gridSize && (dx !== 0 || dy !== 0)) {
              nextX = tx;
              nextY = ty;
              break;
            }
            attempts++;
          }
          if (nextX === lastX && nextY === lastY) {
            nextX = Math.floor(rand() * gridSize);
            nextY = Math.floor(rand() * gridSize);
          }
          lastX = nextX;
          lastY = nextY;
          
          currentTime += step * beatDuration;
        }
      } else {
        AudioController.LYRIC_INTERVALS.forEach((interval) => {
          const text = interval.text || "";
          const cleanText = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
          const words = cleanText.split(/\s+/).filter(Boolean);
          if (words.length === 0) return;
          
          let currentTime = interval.start + offsetSeconds;
          const endTime = interval.end + offsetSeconds;
          
          let lastX = Math.floor(gridSize / 2);
          let lastY = Math.floor(gridSize / 2);
          
          // Spacing modifiers based on difficulty (clamped to prevent overlapping other lines)
          const syllableStep = difficulty === 'easy' ? 0.75 : (difficulty === 'medium' ? 0.5 : (difficulty === 'hard' ? 0.35 : 0.22));
          const wordStep = difficulty === 'easy' ? 1.25 : (difficulty === 'medium' ? 0.75 : (difficulty === 'hard' ? 0.5 : 0.35));
          
          words.forEach((word) => {
            const syllables = countSyllables(word);
            
            for (let i = 0; i < syllables; i++) {
              if (currentTime >= endTime + 0.1) break;
              
              notes.push({
                time: currentTime,
                x: lastX,
                y: lastY
              });
              
              // Choose next grid slot
              let nextX = lastX;
              let nextY = lastY;
              let attempts = 0;
              while (attempts < 10) {
                const dx = Math.floor(rand() * 3) - 1;
                const dy = Math.floor(rand() * 3) - 1;
                const tx = lastX + dx;
                const ty = lastY + dy;

                if (tx >= 0 && tx < gridSize && ty >= 0 && ty < gridSize && (dx !== 0 || dy !== 0)) {
                  nextX = tx;
                  nextY = ty;
                  break;
                }
                attempts++;
              }

              if (nextX === lastX && nextY === lastY) {
                nextX = Math.floor(rand() * gridSize);
                nextY = Math.floor(rand() * gridSize);
              }

              lastX = nextX;
              lastY = nextY;
              
              // Spacing within the word
              if (i < syllables - 1) {
                currentTime += syllableStep * beatDuration;
              }
            }
            
            // Gap step after the word
            currentTime += wordStep * beatDuration;
          });
        });
      }
      
      // Sort notes chronologically
      notes.sort((a, b) => a.time - b.time);
      
      console.log(`YouTube Universal Lyric-Aligned Beatmap: Generated ${notes.length} notes.`);
      return notes;
    }
  }

  // Get current raw frequency bytes for visualization
  getAnalyserData() {
    if (!this.analyserNode) return null;
    const array = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(array);
    return array;
  }
}

// Timed Lyrics Database for perfect vocal beat alignment and subtitle display
AudioController.LYRIC_INTERVALS = [
  { start: 8.70, end: 12.00, text: "Yeah, they tried to stop me" },
  { start: 12.54, end: 15.80, text: "I'ma roll a fronto up in this brown leaf" },
  { start: 16.38, end: 19.80, text: "I'm in a black truck and it's a diesel" },
  { start: 20.22, end: 23.60, text: "Yeah, they tried to stop me, it's not that easy" },
  { start: 24.06, end: 27.50, text: "I'm not God but I wish I was" },
  { start: 27.90, end: 31.20, text: "I'ma roll a fronto up in this brown leaf" },
  { start: 31.74, end: 35.10, text: "I'm in a black truck and it's a diesel" },
  { start: 35.58, end: 39.00, text: "Yeah, they tried to stop me, it's not that easy" },
  { start: 39.42, end: 43.00, text: "I'm not God but I wish I was" },
  { start: 45.18, end: 48.70, text: "I don't care if my conscience is clear if the view is" },
  { start: 49.02, end: 52.50, text: "In this cup, it can make me pause like I'm music" },
  { start: 52.86, end: 56.30, text: "30 hangin' out that graph, this Glock got a pool stick" },
  { start: 56.70, end: 60.20, text: "Crib with the high ceilings at the spiral high" },
  { start: 60.54, end: 64.00, text: "It's just me and my bitch, we gon' stay in for the night" },
  { start: 64.38, end: 67.80, text: "When I was sixteen, I would die for this life" },
  { start: 68.22, end: 71.70, text: "Now I'd trade any day just to feel alive" },
  { start: 72.06, end: 75.50, text: "I'ma roll a fronto up in this brown leaf" },
  { start: 75.90, end: 79.30, text: "I'm in a black truck and it's a diesel" },
  { start: 79.74, end: 83.20, text: "Yeah, they tried to stop me, it's not that easy" },
  { start: 83.58, end: 87.00, text: "I'm not God but I wish I was" },
  { start: 87.42, end: 90.80, text: "I'ma roll a fronto up in this brown leaf" },
  { start: 91.26, end: 94.70, text: "I'm in a black truck and it's a diesel" },
  { start: 95.10, end: 98.50, text: "Yeah, they tried to stop me, it's not that easy" },
  { start: 98.94, end: 103.50, text: "I'm not God but I wish I was" }
];

function countSyllables(word) {
  word = word.toLowerCase().trim();
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const vowels = word.match(/[aeiouy]{1,2}/g);
  return vowels ? vowels.length : 1;
}

function countLineSyllables(line) {
  const cleanLine = line.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
  const words = cleanLine.split(/\s+/).filter(Boolean);
  let count = 0;
  words.forEach(w => {
    count += countSyllables(w);
  });
  return count;
}
