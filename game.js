/**
 * Sound Space Rhythm Game - Core Game Engine
 * Manages Canvas 3D rendering, mouse input tracking, trail physics, scoring mechanics, particles, and HUD updates.
 */

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    // Explode outwards in a random direction
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 6 + 3;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.radius = Math.random() * 3 + 2;
    this.color = color;
    this.alpha = 1.0;
    this.decay = Math.random() * 0.02 + 0.02; // Fades out over ~0.5s
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vx *= 0.96; // Air resistance
    this.vy *= 0.96;
    this.alpha -= this.decay;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.restore();
  }
}

class TrailPoint {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.alpha = 1.0;
  }

  update() {
    this.alpha -= 0.04; // Trail fade speed
  }
}

class GameEngine {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    
    // Game options / settings
    this.gridSize = 3; // 3x3 or 4x4
    this.approachRate = 800; // in ms
    this.cursorRadius = 30; // in px
    this.difficulty = 'medium';
    this.cursorColor = '#ffffff';
    this.cursorImg = null;
    this.theme = 'dark';
    this.rainbowHue = 0;
    this.sensitivity = 1.0; // Mouse sensitivity multiplier
    
    // Play state
    this.beatmap = [];
    this.audioController = new AudioController();
    this.gameState = 'menu'; // 'menu', 'loading', 'playing', 'paused', 'finished'
    
    // Scoring & Stats
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.totalNotes = 0;
    this.hitsPerfect = 0;
    this.hitsGood = 0;
    this.hitsOkay = 0;
    this.misses = 0;
    
    // Mouse coords
    this.mouseX = 0;
    this.mouseY = 0;
    this.isMouseInCanvas = false;
    this.trailPoints = [];
    this.particles = [];
    
    // 3D parameters
    this.zMax = 1000;
    this.fov = 300;
    
    // Visual indicators
    this.screenShake = 0;
    this.gridFlashes = []; // Holds color & timer for cells flashing on hits/misses
    this.cellsHovered = []; // Tracks which cell the cursor is inside
    
    // UI references
    this.menuOverlay = document.getElementById('menu-overlay');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.pauseOverlay = document.getElementById('pause-overlay');
    this.finishOverlay = document.getElementById('finish-overlay');
    this.loadingMessage = document.getElementById('loading-message');
    
    // Stat displays
    this.accDisplay = document.getElementById('accuracy-display');
    this.scoreDisplay = document.getElementById('score-display');
    this.comboDisplay = document.getElementById('combo-display');
    this.maxComboDisplay = document.getElementById('max-combo-display');
    this.hitRatingOverlay = document.getElementById('hit-rating-overlay');
    this.progressBarFill = document.getElementById('progress-bar-fill');
    this.songTimeDisplay = document.getElementById('song-time-display');

    // Vulnus HUD displays
    this.pausesDisplay = document.getElementById('pauses-display');
    this.missesDisplay = document.getElementById('misses-display');
    this.notesRatioDisplay = document.getElementById('notes-ratio-display');
    this.bgComboDisplay = document.getElementById('bg-combo-counter');
    this.gameplayHud = document.getElementById('gameplay-hud');
    this.songNameDisplay = document.getElementById('song-name-display');
    this.pausesCount = 0;

    // Multiplayer properties
    this.isMultiplayer = false;
    this.multiplayerRole = null;
    this.lobbyCode = null;
    this.multiplayerInterval = null;
    this.oppFinished = false;

    this.clickBuffers = { creamy: null, clacky: null, custom: null };
    this.initEventListeners();
    this.resizeCanvas();
    this.loadConfig(); // Restore preferences from LocalStorage
    this.loadClickSounds(); // Load custom clicks
    this.startRenderLoop();
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  initEventListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());

    // Mouse tracking with custom sensitivity relative to screen center
    window.addEventListener('mousemove', (e) => {
      this.isMouseInCanvas = true;
      if (this.sensitivity !== 1.0) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        this.mouseX = Math.max(0, Math.min(window.innerWidth, cx + (e.clientX - cx) * this.sensitivity));
        this.mouseY = Math.max(0, Math.min(window.innerHeight, cy + (e.clientY - cy) * this.sensitivity));
      } else {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
      }

      if (this.gameState === 'playing') {
        // Add trail point
        this.trailPoints.push(new TrailPoint(this.mouseX, this.mouseY, this.cursorRadius));
        if (this.trailPoints.length > 30) {
          this.trailPoints.shift();
        }
      }
    });

    window.addEventListener('mouseout', () => {
      this.isMouseInCanvas = false;
    });

    // Form settings sliders update values
    const arInput = document.getElementById('approach-rate-input');
    const arVal = document.getElementById('ar-val');
    arInput.addEventListener('input', () => {
      arVal.innerText = `${arInput.value}ms`;
      this.approachRate = parseInt(arInput.value);
    });

    const cursorInput = document.getElementById('cursor-size-input');
    const cursorVal = document.getElementById('cursor-val');
    cursorInput.addEventListener('input', () => {
      cursorVal.innerText = `${cursorInput.value}px`;
      this.cursorRadius = parseInt(cursorInput.value);
    });

    const sensInput = document.getElementById('sensitivity-input');
    const sensVal = document.getElementById('sens-val');
    sensInput.addEventListener('input', () => {
      sensVal.innerText = `${sensInput.value}x`;
      this.sensitivity = parseFloat(sensInput.value);
    });

    // Auto-save configuration on input changes
    const inputsToWatch = [
      'grid-size-select', 'approach-rate-input', 'cursor-size-input', 
      'difficulty-input', 'cursor-color-input', 'offset-input', 
      'audio-focus-select', 'theme-select', 'click-sound-select', 
      'sensitivity-input', 'custom-bg-color', 'custom-card-color', 
      'custom-accent-color', 'yt-url-input'
    ];
    inputsToWatch.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => this.saveConfig());
        el.addEventListener('input', () => this.saveConfig());
      }
    });

    // Song start offset slider listener
    const offsetInput = document.getElementById('offset-input');
    const offsetVal = document.getElementById('offset-val');
    offsetInput.addEventListener('input', () => {
      offsetVal.innerText = `${offsetInput.value > 0 ? '+' : ''}${offsetInput.value}ms`;
    });

    // Tab Selection
    const tabYt = document.getElementById('tab-yt');
    const tabLocal = document.getElementById('tab-local');
    const tabMulti = document.getElementById('tab-multi');
    const contentYt = document.getElementById('content-yt');
    const contentLocal = document.getElementById('content-local');
    const contentMulti = document.getElementById('content-multi');

    tabYt.addEventListener('click', () => {
      tabYt.classList.add('active');
      tabLocal.classList.remove('active');
      tabMulti.classList.remove('active');
      contentYt.classList.remove('hidden');
      contentLocal.classList.add('hidden');
      contentMulti.classList.add('hidden');
      this.audioController.mode = 'yt';
    });

    tabLocal.addEventListener('click', () => {
      tabLocal.classList.add('active');
      tabYt.classList.remove('active');
      tabMulti.classList.remove('active');
      contentLocal.classList.remove('hidden');
      contentYt.classList.add('hidden');
      contentMulti.classList.add('hidden');
      this.audioController.mode = 'local';
    });

    tabMulti.addEventListener('click', () => {
      tabMulti.classList.add('active');
      tabYt.classList.remove('active');
      tabLocal.classList.remove('active');
      contentMulti.classList.remove('hidden');
      contentYt.classList.add('hidden');
      contentLocal.classList.add('hidden');
      
      // Auto fetch lobbies list
      this.refreshLobbiesList();
    });

    // File Input change text
    const fileInput = document.getElementById('audio-file-input');
    const uploadStatus = document.getElementById('upload-status-text');
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        uploadStatus.innerText = `Selected: ${e.target.files[0].name}`;
      } else {
        uploadStatus.innerText = `Choose audio file (MP3, WAV, M4A)`;
      }
    });

    // Start Button
    const startBtn = document.getElementById('start-game-btn');
    startBtn.addEventListener('click', () => this.handleLoadAndStart());

    // Multiplayer setup bindings
    const hostLobbyBtn = document.getElementById('host-lobby-btn');
    if (hostLobbyBtn) {
      hostLobbyBtn.addEventListener('click', () => this.hostLobby());
    }

    const joinLobbyBtn = document.getElementById('join-lobby-btn');
    if (joinLobbyBtn) {
      joinLobbyBtn.addEventListener('click', () => {
        const code = document.getElementById('join-code-input').value.trim();
        this.joinLobby(code);
      });
    }

    const startMultiBtn = document.getElementById('start-multi-btn');
    if (startMultiBtn) {
      startMultiBtn.addEventListener('click', () => this.startMultiMatch());
    }

    // Pause UI controls
    document.getElementById('resume-btn').addEventListener('click', () => this.resumeGame());
    document.getElementById('restart-btn').addEventListener('click', () => this.restartGame());
    document.getElementById('quit-btn').addEventListener('click', () => this.quitToMenu());

    // Finish UI controls
    document.getElementById('play-again-btn').addEventListener('click', () => this.restartGame());
    document.getElementById('finish-quit-btn').addEventListener('click', () => this.quitToMenu());

    // Keyboard Shortcuts (Space for Pause, R to Restart, Arrows to skip 5s, -/+=/[] to adjust sync offset)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.gameState === 'playing') {
          this.pauseGame();
        } else if (this.gameState === 'paused') {
          this.resumeGame();
        }
      }
      if (e.code === 'KeyR' && (this.gameState === 'playing' || this.gameState === 'paused')) {
        this.restartGame();
      }
      if (e.code === 'ArrowLeft' && this.gameState === 'playing') {
        e.preventDefault();
        this.seekGame(-5);
      }
      if (e.code === 'ArrowRight' && this.gameState === 'playing') {
        e.preventDefault();
        this.seekGame(5);
      }
      if ((e.code === 'BracketLeft' || e.code === 'Minus') && this.gameState === 'playing') {
        e.preventDefault();
        const amount = e.shiftKey ? -10 : -100;
        this.adjustOffset(amount);
      }
      if ((e.code === 'BracketRight' || e.code === 'Equal') && this.gameState === 'playing') {
        e.preventDefault();
        const amount = e.shiftKey ? 10 : 100;
        this.adjustOffset(amount);
      }
    });

    // Wire Audio Controller updates to HUD progress
    this.audioController.onTimeUpdate = (time, percent) => {
      const displayPercent = Math.min(100, Math.max(0, percent * 100));
      this.progressBarFill.style.width = `${displayPercent}%`;
      
      const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };
      
      const totalDur = this.audioController.duration || 0;
      this.songTimeDisplay.innerText = `${formatTime(time)} / ${formatTime(totalDur)}`;
    };

    this.audioController.onStateChange = (state) => {
      if (state === 'ended') {
        this.finishGame();
      }
    };

    // Cursor Image Upload listener
    const cursorImageStatus = document.getElementById('cursor-image-status');
    const cursorImageInput = document.getElementById('cursor-image-input');
    cursorImageInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        cursorImageStatus.innerText = file.name;
        const reader = new FileReader();
        reader.onload = (event) => {
          this.cursorImg = new Image();
          this.cursorImg.src = event.target.result;
        };
        reader.readAsDataURL(file);
      } else {
        cursorImageStatus.innerText = "Use Custom Image...";
        this.cursorImg = null;
      }
    });

    // Custom Click Sound Upload listener
    const customClickInput = document.getElementById('custom-click-input');
    const customClickStatus = document.getElementById('custom-click-status');
    customClickInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        customClickStatus.innerText = file.name;
        
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const audioCtx = this.getHitAudioCtx();
            this.clickBuffers.custom = await audioCtx.decodeAudioData(event.target.result);
            console.log("Custom click sound decoded successfully.");
            
            // Set selector to Custom automatically
            const select = document.getElementById('click-sound-select');
            if (select) {
              select.value = 'custom';
              select.dispatchEvent(new Event('change'));
            }
          } catch(err) {
            console.error("Failed to decode custom click MP3:", err);
            customClickStatus.innerText = "Error decoding file!";
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        customClickStatus.innerText = "Use Custom MP3...";
        this.clickBuffers.custom = null;
      }
    });

    // Theme selector & Custom theme handlers
    const themeSelect = document.getElementById('theme-select');
    const customThemeControls = document.getElementById('custom-theme-controls');
    
    const applyTheme = (theme) => {
      this.theme = theme;
      if (theme === 'custom') {
        customThemeControls.classList.remove('hidden');
        updateCustomTheme();
      } else {
        customThemeControls.classList.add('hidden');
        
        if (theme === 'dark') {
          document.documentElement.style.setProperty('--bg-color', '#0e0e12');
          document.documentElement.style.setProperty('--card-bg', 'rgba(22, 22, 30, 0.9)');
          document.documentElement.style.setProperty('--accent-color', '#ffffff');
          document.documentElement.style.setProperty('--text-color', '#e2e8f0');
          document.documentElement.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.08)');
        } else if (theme === 'deep-dark') {
          document.documentElement.style.setProperty('--bg-color', '#000000');
          document.documentElement.style.setProperty('--card-bg', 'rgba(10, 10, 10, 0.95)');
          document.documentElement.style.setProperty('--accent-color', '#ffffff');
          document.documentElement.style.setProperty('--text-color', '#ffffff');
          document.documentElement.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.05)');
        } else if (theme === 'pink-purple') {
          document.documentElement.style.setProperty('--bg-color', '#120314');
          document.documentElement.style.setProperty('--card-bg', 'rgba(30, 12, 36, 0.9)');
          document.documentElement.style.setProperty('--accent-color', '#d946ef');
          document.documentElement.style.setProperty('--text-color', '#f472b6');
          document.documentElement.style.setProperty('--border-color', 'rgba(217, 70, 239, 0.15)');
        }
      }
    };

    const updateCustomTheme = () => {
      if (this.theme !== 'custom') return;
      const bgColor = document.getElementById('custom-bg-color').value;
      const cardColor = document.getElementById('custom-card-color').value;
      const accentColor = document.getElementById('custom-accent-color').value;
      document.documentElement.style.setProperty('--bg-color', bgColor);
      document.documentElement.style.setProperty('--card-bg', cardColor);
      document.documentElement.style.setProperty('--accent-color', accentColor);
      document.documentElement.style.setProperty('--text-color', '#ffffff');
      document.documentElement.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.1)');
    };

    themeSelect.addEventListener('change', (e) => applyTheme(e.target.value));
    document.getElementById('custom-bg-color').addEventListener('input', updateCustomTheme);
    document.getElementById('custom-card-color').addEventListener('input', updateCustomTheme);
    document.getElementById('custom-accent-color').addEventListener('input', updateCustomTheme);

    // Initialize Default Theme
    applyTheme('dark');

    // Setup Challenge Card Event Listeners
    const cards = document.querySelectorAll('.challenge-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const ytUrl = card.getAttribute('data-youtube');
        const diff = card.getAttribute('data-difficulty');
        const grid = card.getAttribute('data-grid');
        const ar = card.getAttribute('data-ar');

        // Set Tab to YouTube programmatically
        const tabYt = document.getElementById('tab-yt');
        if (tabYt) tabYt.click();

        // Populate fields
        const ytInput = document.getElementById('yt-url-input');
        if (ytInput) ytInput.value = ytUrl;

        const diffSelect = document.getElementById('difficulty-input');
        if (diffSelect) diffSelect.value = diff;

        const gridSelect = document.getElementById('grid-size-select');
        if (gridSelect) gridSelect.value = grid;

        const arInput = document.getElementById('approach-rate-input');
        if (arInput) {
          arInput.value = ar;
          arInput.dispatchEvent(new Event('input'));
        }

        // Start the game!
        this.handleLoadAndStart();
      });
    });
  }

  async handleLoadAndStart() {
    this.gameState = 'loading';
    this.menuOverlay.classList.add('hidden');
    this.loadingOverlay.classList.remove('hidden');
    this.loadingMessage.innerText = "LOADING AUDIO FILE...";

    // Read form values
    this.gridSize = parseInt(document.getElementById('grid-size-select').value);
    this.difficulty = document.getElementById('difficulty-input').value;
    this.cursorColor = document.getElementById('cursor-color-input').value || '#ffffff';
    const audioFocus = document.getElementById('audio-focus-select').value || 'vocal';
    const songOffset = parseInt(document.getElementById('offset-input').value) || 0;
    
    // Reset indicators
    this.gridFlashes = Array(this.gridSize * this.gridSize).fill(null).map(() => ({ color: '', val: 0 }));
    this.cellsHovered = Array(this.gridSize * this.gridSize).fill(null).map(() => ({ inside: false, justEntered: false }));

    try {
      let songInfo = null;
      if (this.audioController.mode === 'yt') {
        const ytUrl = document.getElementById('yt-url-input').value;
        this.loadingMessage.innerText = "CONNECTING YOUTUBE API...";
        songInfo = await this.audioController.loadYoutubeSong(ytUrl);
        
        this.loadingMessage.innerText = "RETRIEVING TIMED LYRICS...";
        // Fetch timed lyrics dynamically from LrcLib (required for gameplay)
        const syncedLyrics = await this.fetchSyncedLyrics(songInfo.title, songInfo.author, songInfo.videoId);
        if (!syncedLyrics || syncedLyrics.length === 0) {
          console.warn("No synced lyrics found. Generating tempo-grid beatmap fallback.");
          AudioController.LYRIC_INTERVALS = null;
        } else {
          // Save the dynamic timed lyrics intervals
          AudioController.LYRIC_INTERVALS = syncedLyrics;
        }
      } else {
        const fileInput = document.getElementById('audio-file-input');
        if (fileInput.files.length === 0) {
          throw new Error("Please select a local audio file first.");
        }
        this.loadingMessage.innerText = "DECODING AUDIO CHANNELS...";
        songInfo = await this.audioController.loadLocalFile(fileInput.files[0]);
      }

      this.loadingMessage.innerText = "ANALYZING BEAT ENERGIES...";
      // Generate Beatmap
      const inputId = this.audioController.mode === 'yt' ? songInfo.videoId : songInfo.title;
      const rawBeatmap = this.audioController.generateBeatmap(inputId, this.difficulty, this.gridSize, audioFocus, songOffset);
      
      // Map properties: state is 'upcoming', 'hit', 'miss'
      this.beatmap = rawBeatmap.map(note => ({
        ...note,
        state: 'upcoming',
        evaluated: false
      }));

      this.totalNotes = this.beatmap.length;
      if (this.totalNotes === 0) {
        throw new Error("No notes were generated for this song. Try a different speed/BPM settings.");
      }

      // Pre-adjust audio volume
      this.audioController.setVolume(0.5);

      // Show synchronous Tap-To-Play overlay trigger button (bypasses browser autoplay restrictions)
      this.showReadyButton();

    } catch (err) {
      alert("Error: " + err.message);
      this.loadingOverlay.classList.add('hidden');
      this.menuOverlay.classList.remove('hidden');
      this.gameState = 'menu';
    }
  }

  showReadyButton() {
    this.loadingMessage.innerText = "SONG READY & SYNCHRONIZED";
    
    // Hide loading spinner
    const spinner = this.loadingOverlay.querySelector('.neon-spinner');
    if (spinner) spinner.classList.add('hidden');
    
    // Create or show play button
    let startBtn = document.getElementById('ready-start-btn');
    if (!startBtn) {
      startBtn = document.createElement('button');
      startBtn.id = 'ready-start-btn';
      startBtn.className = 'action-btn neon-btn';
      startBtn.style.marginTop = '20px';
      startBtn.innerText = 'TAP / CLICK TO PLAY';
      
      const container = this.loadingOverlay.querySelector('.loading-container');
      if (container) {
        container.appendChild(startBtn);
      }
      
      startBtn.addEventListener('click', () => {
        // Hide loading overlay
        this.loadingOverlay.classList.add('hidden');
        
        // Remove button for future games
        startBtn.remove();
        
        // Show spinner again for next loads
        if (spinner) spinner.classList.remove('hidden');
        
        // Start the game synchronously inside user gesture callback
        this.startGame();
      });
    }
  }

  startGame() {
    this.resetStats();
    this.gameState = 'playing';
    this.audioController.play();
    
    if (this.gameplayHud) this.gameplayHud.classList.remove('hidden');
    this.pausesCount = 0;
    if (this.pausesDisplay) this.pausesDisplay.innerText = "0";
    if (this.missesDisplay) this.missesDisplay.innerText = "0";
    if (this.notesRatioDisplay) this.notesRatioDisplay.innerText = `0/${this.totalNotes}`;
    if (this.bgComboDisplay) this.bgComboDisplay.innerText = "0";
    
    const activeTitle = this.audioController.activeTitle || "Unknown Song";
    const activeAuthor = this.audioController.activeAuthor || "Unknown Artist";
    if (this.songNameDisplay) {
      this.songNameDisplay.innerText = `${activeAuthor} - ${activeTitle}`;
    }

    if (this.isMultiplayer) {
      this.startMultiplayerGameLoop();
    } else {
      const vsPanel = document.getElementById('multiplayer-vs-panel');
      if (vsPanel) vsPanel.classList.add('hidden');
    }
  }

  pauseGame() {
    if (this.gameState !== 'playing') return;
    this.gameState = 'paused';
    this.audioController.pause();
    this.pauseOverlay.classList.remove('hidden');
    
    this.pausesCount++;
    if (this.pausesDisplay) this.pausesDisplay.innerText = this.pausesCount;
  }

  resumeGame() {
    if (this.gameState !== 'paused') return;
    this.gameState = 'playing';
    this.pauseOverlay.classList.add('hidden');
    this.audioController.play();
  }

  restartGame() {
    this.pauseOverlay.classList.add('hidden');
    this.finishOverlay.classList.add('hidden');
    if (this.gameplayHud) this.gameplayHud.classList.remove('hidden');
    
    this.audioController.stop();
    
    // Reset beatmap notes
    this.beatmap.forEach(note => {
      note.state = 'upcoming';
      note.evaluated = false;
    });

    this.resetStats();
    
    this.pausesCount = 0;
    if (this.pausesDisplay) this.pausesDisplay.innerText = "0";
    if (this.missesDisplay) this.missesDisplay.innerText = "0";
    if (this.notesRatioDisplay) this.notesRatioDisplay.innerText = `0/${this.totalNotes}`;
    if (this.bgComboDisplay) this.bgComboDisplay.innerText = "0";
    
    const activeTitle = this.audioController.activeTitle || "Unknown Song";
    const activeAuthor = this.audioController.activeAuthor || "Unknown Artist";
    if (this.songNameDisplay) {
      this.songNameDisplay.innerText = `${activeAuthor} - ${activeTitle}`;
    }

    this.gameState = 'playing';
    this.audioController.play();
  }

  quitToMenu() {
    this.pauseOverlay.classList.add('hidden');
    this.finishOverlay.classList.add('hidden');
    if (this.gameplayHud) this.gameplayHud.classList.add('hidden');
    const lyricsDiv = document.getElementById('lyrics-display');
    if (lyricsDiv) lyricsDiv.classList.add('hidden');
    
    if (this.multiplayerInterval) {
      clearInterval(this.multiplayerInterval);
      this.multiplayerInterval = null;
    }
    this.isMultiplayer = false;
    this.lobbyCode = null;
    this.multiplayerRole = null;
    
    const joinBtn = document.getElementById('join-lobby-btn');
    if (joinBtn) {
      joinBtn.innerText = "Join Lobby";
      joinBtn.disabled = false;
    }

    this.audioController.stop();
    this.gameState = 'menu';
    this.menuOverlay.classList.remove('hidden');
  }

  finishGame() {
    this.gameState = 'finished';
    this.finishOverlay.classList.remove('hidden');
    if (this.gameplayHud) this.gameplayHud.classList.add('hidden');
    const lyricsDiv = document.getElementById('lyrics-display');
    if (lyricsDiv) lyricsDiv.classList.add('hidden');

    // Populate stats
    document.getElementById('final-accuracy').innerText = this.accDisplay.innerText;
    document.getElementById('final-score').innerText = this.score;
    document.getElementById('final-combo').innerText = this.maxCombo;
    document.getElementById('final-hits').innerText = `${this.hitsPerfect} / ${this.hitsGood} / ${this.hitsOkay}`;
    document.getElementById('final-misses').innerText = this.misses;

    // Multiplayer checks
    const multiPanel = document.getElementById('multiplayer-result-panel');
    if (this.isMultiplayer) {
      if (multiPanel) multiPanel.classList.remove('hidden');
      if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
      this.sendFinalMultiStats();
    } else {
      if (multiPanel) multiPanel.classList.add('hidden');
    }
  }

  resetStats() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hitsPerfect = 0;
    this.hitsGood = 0;
    this.hitsOkay = 0;
    this.misses = 0;
    this.trailPoints = [];
    this.particles = [];
    this.screenShake = 0;
    
    this.updateHUD();
  }

  updateHUD() {
    if (this.scoreDisplay) this.scoreDisplay.innerText = this.score.toLocaleString('en-US');
    if (this.comboDisplay) this.comboDisplay.innerText = `${this.combo}x`;
    if (this.bgComboDisplay) this.bgComboDisplay.innerText = this.combo;
    if (this.maxComboDisplay) this.maxComboDisplay.innerText = this.maxCombo;

    if (this.missesDisplay) this.missesDisplay.innerText = this.misses;

    const hitsCount = this.hitsPerfect + this.hitsGood + this.hitsOkay;
    if (this.notesRatioDisplay) this.notesRatioDisplay.innerText = `${hitsCount}/${this.totalNotes || 0}`;

    const totalEvaluated = hitsCount + this.misses;
    if (totalEvaluated === 0) {
      this.accDisplay.innerText = "100.00%";
    } else {
      const rawAcc = hitsCount / totalEvaluated; // Accuracy only goes down on misses
      this.accDisplay.innerText = `${(rawAcc * 100).toFixed(2)}%`;
    }
  }

  triggerRating(ratingText, colorClass) {
    // Show text indicator in middle
    this.hitRatingOverlay.innerHTML = `<span class="${colorClass}">${ratingText}</span>`;
    this.hitRatingOverlay.className = "rating-float";
    
    // Clear animation class after delay so it can be re-triggered
    setTimeout(() => {
      this.hitRatingOverlay.className = "";
    }, 450);
  }

  getHitAudioCtx() {
    // Reuse a single global AudioContext to avoid hitting browser limits
    if (!window.globalHitAudioCtx) {
      window.globalHitAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (window.globalHitAudioCtx.state === 'suspended') {
      window.globalHitAudioCtx.resume();
    }
    return window.globalHitAudioCtx;
  }

  async loadClickSounds() {
    const audioCtx = this.getHitAudioCtx();
    const loadSound = async (name, url) => {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        this.clickBuffers[name] = await audioCtx.decodeAudioData(arrayBuffer);
        console.log(`Loaded custom click file: ${name}`);
      } catch (e) {
        console.error(`Failed to load click audio file ${name}:`, e);
      }
    };
    await Promise.all([
      loadSound('creamy', 'creamy.mp3'),
      loadSound('clacky', 'clacky.mp3')
    ]);
  }

  playHitSound() {
    try {
      const audioCtx = this.getHitAudioCtx();
      const clickType = document.getElementById('click-sound-select')?.value || 'normal';
      
      // Play high-fidelity loaded custom MP3 files if decoded successfully
      if (clickType === 'custom' && this.clickBuffers.custom) {
        const source = audioCtx.createBufferSource();
        source.buffer = this.clickBuffers.custom;
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); // Custom uploaded volume
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        source.start(0);
        return;
      }
      if (clickType === 'creamy' && this.clickBuffers.creamy) {
        const source = audioCtx.createBufferSource();
        source.buffer = this.clickBuffers.creamy;
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.45, audioCtx.currentTime); // Creamy buffer volume
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        source.start(0);
        return;
      }
      if (clickType === 'clacky' && this.clickBuffers.clacky) {
        const source = audioCtx.createBufferSource();
        source.buffer = this.clickBuffers.clacky;
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.07, audioCtx.currentTime); // Clacky buffer volume turned down hella (7% gain)
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        source.start(0);
        return;
      }

      const gainNode = audioCtx.createGain();
      gainNode.connect(audioCtx.destination);
      
      if (clickType === 'creamy') {
        // Creamy: Warm, marbly, deep thock (like KTT Kang White or lubed linear switch)
        // Main deep body: Triangle wave sliding from 220Hz to 85Hz over 65ms
        const oscBody = audioCtx.createOscillator();
        oscBody.type = 'triangle';
        oscBody.frequency.setValueAtTime(220, audioCtx.currentTime);
        oscBody.frequency.exponentialRampToValueAtTime(85, audioCtx.currentTime + 0.065);
        
        // Lowpass filter to keep it deep and warm
        const filterLp = audioCtx.createBiquadFilter();
        filterLp.type = 'lowpass';
        filterLp.frequency.setValueAtTime(400, audioCtx.currentTime);
        
        oscBody.connect(filterLp);
        filterLp.connect(gainNode);

        // Marbly resonance: Bandpass filter excited by a short sine wave
        const filterBp = audioCtx.createBiquadFilter();
        filterBp.type = 'bandpass';
        filterBp.frequency.setValueAtTime(1200, audioCtx.currentTime);
        filterBp.Q.setValueAtTime(6, audioCtx.currentTime);

        const oscMarble = audioCtx.createOscillator();
        oscMarble.type = 'sine';
        oscMarble.frequency.setValueAtTime(1200, audioCtx.currentTime);
        oscMarble.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.012);
        
        oscMarble.connect(filterBp);
        filterBp.connect(gainNode);

        // Envelope: smooth creamy decay
        gainNode.gain.setValueAtTime(0.55, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.07);

        oscBody.start(audioCtx.currentTime);
        oscBody.stop(audioCtx.currentTime + 0.08);
        oscMarble.start(audioCtx.currentTime);
        oscMarble.stop(audioCtx.currentTime + 0.025);
      } else if (clickType === 'clacky') {
        // Clacky: Bright, high-pitched, plastic-on-plate mechanical switch bottom-out
        // Highpass filter to cut low rumble and highlight plastic collision
        const filterHp = audioCtx.createBiquadFilter();
        filterHp.type = 'highpass';
        filterHp.frequency.setValueAtTime(1100, audioCtx.currentTime);
        filterHp.connect(gainNode);

        // Sharp plastic transient: high sine glide
        const oscBody = audioCtx.createOscillator();
        oscBody.type = 'triangle';
        oscBody.frequency.setValueAtTime(2000, audioCtx.currentTime);
        oscBody.frequency.exponentialRampToValueAtTime(700, audioCtx.currentTime + 0.022);
        oscBody.connect(filterHp);

        // Cap strike noise transient
        const oscStrike = audioCtx.createOscillator();
        oscStrike.type = 'sine';
        oscStrike.frequency.setValueAtTime(5000, audioCtx.currentTime);
        oscStrike.frequency.exponentialRampToValueAtTime(1800, audioCtx.currentTime + 0.008);
        oscStrike.connect(filterHp);

        // Envelope: very sharp, immediate decay
        gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.028);

        oscBody.start(audioCtx.currentTime);
        oscBody.stop(audioCtx.currentTime + 0.035);
        oscStrike.start(audioCtx.currentTime);
        oscStrike.stop(audioCtx.currentTime + 0.015);
      } else {
        // Normal: Crisp standard woodblock
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1100, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(180, audioCtx.currentTime + 0.04);
        osc.connect(gainNode);
        
        gainNode.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
        
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.05);
      }
    } catch (e) {
      console.error("Audio synthesiser failure:", e);
    }
  }

  async fetchSyncedLyrics(title, artist, videoId) {
    // 1. HARDCODED PERFECT SYNCED LYRICS FOR THE DEFAULT TRACK
    if (videoId === 'a8XAOMeWdqY') {
      const defaultLrc = `[00:09.60] Yeah, they tried to stop me
[00:11.46] I'ma roll a fronto up in this brown leaf
[00:17.41] Yeah, they tried to stop me
[00:19.87] I'ma roll a fronto up in this brown leaf
[00:23.13] Smoke dope, I'ma smoke till I'm dying
[00:27.18] White hoes snorting coke, and they're tryin'
[00:30.91] Tryin' new drugs, new pills, green mud
[00:34.94] They can't get enough (they can't)
[00:36.32] Yeah, they can't get enough
[00:44.11] Yeah, they can't get enough
[00:48.46] Yeah, they tried to stop me
[00:50.86] I'ma roll a fronto up in this brown leaf
[00:54.15] White hoes in my condo moving so slow
[00:58.21] Pink lines of the molly in her nose-nose
[01:02.57] Blue pills and then 30 bangs for the fuckin' gang
[01:05.83] We be tweakin' all night
[01:08.39] Yeah, we not the same
[01:12.13] Yeah, we not the same
[01:16.22] Yeah, we not the same
[01:25.77] Faygo red bottom like my shoes is
[01:29.29] I don't care if my conscience is clear if the view is
[01:33.10] In this cup, it can make me pause like I'm music
[01:37.31] 30 hanging out that graph
[01:38.92] This Glock got a pool stick
[01:40.82] Firm with the high ceilings, I just bought a high
[01:44.40] It's just me and my bitch we gon' stay for the night
[01:48.09] When I was 16 I would die for this life
[01:51.96] Now I'd trade any moment just to get a peace of mind
[01:55.86] I was shoppin' in the Saks left a piece of me behind
[01:59.84] This little pink pill takes the pain from my spine
[02:03.51] Gotta pay me for the photo (photo)
[02:06.87] Lobster steak shrimp in risotto (risotto)
[02:10.31] In the rear view you were drivin' so slow
[02:15.02] I feel ain't buy enough
[02:17.14] You can barely catch up
[02:21.35] Yeah, they tried to stop me
[02:23.71] I'ma roll a fronto up in this brown leaf
[02:27.25] White hoes in my condo movin' so slow
[02:31.19] Pink lines of the molly in her nose-nose
[02:34.94] Blue pills and then 30 bangs for the fuckin' gang
[02:38.76] We be tweakin' all night
[02:41.25] Yeah, we not the same`;
      return this.parseLrcLyrics(defaultLrc);
    }

    // 2. DYNAMIC FETCH FOR ANY OTHER SONG
    // Clean strings: Remove feat., with, parenthesis tags, brackets, and extra spaces
    const cleanTitle = title.replace(/\((?:official|lyric|audio|video|HD|4K|HQ|feat\.?|with|prod\.?|remixed|remix)\b.*?\)/gi, '')
                            .replace(/\[.*?\]/g, '')
                            .replace(/feat\.?.*?$/gi, '')
                            .replace(/prod\.?.*?$/gi, '')
                            .trim();

    const cleanArtist = artist.replace(/- Topic/gi, '')
                              .replace(/&.*?$/gi, '')
                              .replace(/feat\.?.*?$/gi, '')
                              .trim();

    const searchQueries = [
      // Direct exact match
      { artist: cleanArtist, title: cleanTitle },
      // Search with both names
      { q: `${cleanArtist} ${cleanTitle}` },
      // Search with title only
      { q: cleanTitle }
    ];

    for (const sq of searchQueries) {
      try {
        let res;
        if (sq.artist) {
          const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(sq.artist)}&track_name=${encodeURIComponent(sq.title)}`;
          res = await fetch(url);
        } else if (sq.q) {
          const url = `https://lrclib.net/api/search?q=${encodeURIComponent(sq.q)}`;
          res = await fetch(url);
        }

        if (res && res.ok) {
          const json = await res.json();
          if (sq.artist) {
            // Direct matching 'get' returns a single record
            if (json && json.syncedLyrics) {
              console.log(`Lyrics successfully matched using direct API!`, json.trackName);
              return this.parseLrcLyrics(json.syncedLyrics);
            }
          } else {
            // Search query returns an array
            if (json && json.length > 0) {
              // Find the best match that has synced lyrics and matches title/artist metadata
              const match = json.find(r => {
                if (!r.syncedLyrics || r.syncedLyrics.length <= 10) return false;
                
                const normalize = (str) => (str || "").toLowerCase().replace(/[^a-z0-9]/g, '');
                const cuedT = normalize(cleanTitle);
                const candT = normalize(r.trackName);
                if (!candT.includes(cuedT) && !cuedT.includes(candT)) return false;
                
                // Fuzzy check for artist to ensure we don't fetch another artist's track
                if (cleanArtist && cleanArtist.toLowerCase() !== 'unknown' && cleanArtist.trim() !== '') {
                  const cuedA = normalize(cleanArtist);
                  const candA = normalize(r.artistName);
                  const artistOk = candA.includes(cuedA) || 
                                   cuedA.includes(candA) ||
                                   cleanArtist.toLowerCase().split(/\s+/).some(w => w.length > 3 && r.artistName.toLowerCase().includes(w));
                  if (!artistOk) return false;
                }
                return true;
              });
              if (match) {
                console.log(`Lyrics successfully matched using verified search API query!`, match.trackName, "by", match.artistName);
                return this.parseLrcLyrics(match.syncedLyrics);
              }
            }
          }
        }
      } catch (e) {
        console.error(`Sub-query match attempt failed:`, e);
      }
    }

    return null;
  }

  parseLrcLyrics(syncedLyricsText) {
    const lines = syncedLyricsText.split('\n');
    const tempIntervals = [];
    const timeRegex = /\[(\d+):(\d+)\.(\d+)\]/;
    const enhancedRegex = /<(\d+):(\d+)\.(\d+)>/;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const lineMatch = line.match(timeRegex);
      if (lineMatch) {
        const min = parseInt(lineMatch[1]);
        const sec = parseInt(lineMatch[2]);
        const ms = parseInt(lineMatch[3]);
        const secFraction = ms / (ms > 99 ? 1000 : 100);
        const lineStartTime = min * 60 + sec + secFraction;
        
        const textWithoutLineTag = line.replace(timeRegex, '').trim();
        
        // Parse word-level enhanced LRC tags if present in the synced lyrics string
        if (enhancedRegex.test(textWithoutLineTag)) {
          const parts = textWithoutLineTag.split(/(?=<[^>]+>)/);
          parts.forEach(part => {
            const partMatch = part.match(/<(\d+):(\d+)\.(\d+)>/);
            if (partMatch) {
              const wMin = parseInt(partMatch[1]);
              const wSec = parseInt(partMatch[2]);
              const wMs = parseInt(partMatch[3]);
              const wFraction = wMs / (wMs > 99 ? 1000 : 100);
              const wordTime = wMin * 60 + wSec + wFraction;
              
              const wordText = part.replace(/<[^>]+>/, '').trim();
              if (wordText) {
                tempIntervals.push({
                  start: wordTime,
                  text: wordText,
                  isWordLevel: true
                });
              }
            }
          });
        } else {
          // Fallback to standard line-level
          const text = textWithoutLineTag.trim();
          if (text) {
            tempIntervals.push({
              start: lineStartTime,
              text: text,
              isWordLevel: false
            });
          }
        }
      }
    }
    
    tempIntervals.sort((a, b) => a.start - b.start);
    
    const intervals = [];
    for (let i = 0; i < tempIntervals.length; i++) {
      const start = tempIntervals[i].start;
      const end = tempIntervals[i].isWordLevel
        ? (i < tempIntervals.length - 1 ? Math.min(start + 0.4, tempIntervals[i+1].start - 0.05) : start + 0.4)
        : (i < tempIntervals.length - 1 ? Math.min(start + 4.0, tempIntervals[i+1].start - 0.15) : start + 4.0);
      
      intervals.push({
        start: start,
        end: end,
        text: tempIntervals[i].text,
        isWordLevel: tempIntervals[i].isWordLevel
      });
    }
    
    return intervals;
  }

  // 3D Projection Math Helper
  project3D(cx, cy, targetX, targetY, z) {
    const scale = this.fov / (this.fov + z);
    return {
      x: cx + (targetX - cx) * scale,
      y: cy + (targetY - cy) * scale,
      scale: scale
    };
  }

  startRenderLoop() {
    const frame = () => {
      this.updatePhysics();
      this.drawGame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  updatePhysics() {
    // Rainbow theme cycle accent color
    if (this.theme === 'rainbow') {
      this.rainbowHue = (this.rainbowHue + 1) % 360;
      document.documentElement.style.setProperty('--accent-color', `hsl(${this.rainbowHue}, 85%, 65%)`);
      document.documentElement.style.setProperty('--bg-color', '#09090d');
      document.documentElement.style.setProperty('--card-bg', 'rgba(18, 18, 24, 0.9)');
      document.documentElement.style.setProperty('--text-color', '#e2e8f0');
      document.documentElement.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.05)');
    }

    const lyricsDiv = document.getElementById('lyrics-display');
    if (this.gameState !== 'playing') {
      if (lyricsDiv) lyricsDiv.classList.add('hidden');
      return;
    }

    const songTime = this.audioController.getCurrentTime();

    // Live Subtitle Update (displays lyrics dynamically if loaded)
    if (this.audioController.mode === 'yt' && this.audioController.ytPlayer && AudioController.LYRIC_INTERVALS && AudioController.LYRIC_INTERVALS.length > 0) {
      const offsetSeconds = (parseInt(document.getElementById('offset-input').value) || 0) / 1000;
      const rawTime = songTime - offsetSeconds;
      
      const activeLyric = AudioController.LYRIC_INTERVALS.find(
        interval => rawTime >= interval.start && rawTime < interval.end
      );

      if (activeLyric) {
        lyricsDiv.innerText = activeLyric.text;
        lyricsDiv.classList.remove('hidden');
      } else {
        lyricsDiv.classList.add('hidden');
      }
    } else {
      if (lyricsDiv) lyricsDiv.classList.add('hidden');
    }

    // 1. Update particles
    this.particles.forEach(p => p.update());
    this.particles = this.particles.filter(p => p.alpha > 0);

    // 2. Update trail points
    this.trailPoints.forEach(tp => tp.update());
    this.trailPoints = this.trailPoints.filter(tp => tp.alpha > 0);

    // 3. Screen shake decay
    if (this.screenShake > 0) {
      this.screenShake *= 0.85;
      if (this.screenShake < 0.2) this.screenShake = 0;
    }

    // 4. Grid flashes decay
    this.gridFlashes.forEach(flash => {
      if (flash.val > 0) flash.val -= 0.08;
    });

    // 5. Grid Cell Sizing & Cursor Positioning
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const gridBound = Math.min(this.canvas.width, this.canvas.height) * 0.55;
    const cellSize = gridBound / this.gridSize;
    const cellGap = 8;
    const totalSize = gridBound + cellGap * (this.gridSize - 1);

    // Track which cell cursor is inside
    for (let index = 0; index < this.gridSize * this.gridSize; index++) {
      const col = index % this.gridSize;
      const row = Math.floor(index / this.gridSize);

      const targetX = cx + (col - (this.gridSize - 1) / 2) * (cellSize + cellGap);
      const targetY = cy + (row - (this.gridSize - 1) / 2) * (cellSize + cellGap);

      // Hitbox is slightly larger based on the cursor hit-radius
      const left = targetX - cellSize / 2 - this.cursorRadius;
      const right = targetX + cellSize / 2 + this.cursorRadius;
      const top = targetY - cellSize / 2 - this.cursorRadius;
      const bottom = targetY + cellSize / 2 + this.cursorRadius;

      const cursorInside = this.mouseX >= left && this.mouseX <= right && 
                            this.mouseY >= top && this.mouseY <= bottom;

      // Note transition check: we track if cursor just entered
      const prevHovered = this.cellsHovered[index] ? this.cellsHovered[index].inside : false;
      const inside = cursorInside && this.isMouseInCanvas;
      
      this.cellsHovered[index] = {
        inside: inside,
        justEntered: (!prevHovered && inside)
      };
    }

    // 6. Rhythm notes evaluation (Hit & Miss Windows)
    for (let i = 0; i < this.beatmap.length; i++) {
      const note = this.beatmap[i];
      if (note.evaluated) continue;

      const dt = note.time - songTime;
      const index = note.y * this.gridSize + note.x;
      const hovered = this.cellsHovered[index];

      // Miss if note has passed the timing window (dt < -0.15s)
      if (dt < -0.15) {
        note.evaluated = true;
        note.state = 'miss';
        this.misses++;
        this.combo = 0;
        this.gridFlashes[index] = { color: 'rgba(255, 62, 62, 0.4)', val: 1.0 }; // flash cell red
        this.triggerRating("MISS", "text-red");
        this.updateHUD();
        continue;
      }

      // Hit Windows:
      // Perfect: |dt| <= 0.045s (45ms)
      // Good: |dt| <= 0.090s (90ms)
      // Okay: |dt| <= 0.150s (150ms)
      const absDt = Math.abs(dt);
      
      if (absDt <= 0.15) { // Inside the hit window
        let hitRegistered = false;
        let rating = "";
        let colorClass = "";
        let points = 0;

        if (hovered && hovered.inside) {
          // Rule to solve hover-camp problem:
          // If already inside cell, trigger immediately when close to zero (Perfect window or late dt)
          // If just entered the cell, trigger immediately
          if (hovered.justEntered || absDt <= 0.03 || dt < 0) {
            hitRegistered = true;

            if (absDt <= 0.045) {
              rating = "PERFECT";
              colorClass = "neon-blue";
              this.hitsPerfect++;
              points = 300;
            } else if (absDt <= 0.09) {
              rating = "GOOD";
              colorClass = "neon-green";
              this.hitsGood++;
              points = 200;
            } else {
              rating = "OKAY";
              colorClass = "neon-magenta";
              this.hitsOkay++;
              points = 100;
            }
          }
        }

        if (hitRegistered) {
          note.evaluated = true;
          note.state = 'hit';
          
          this.playHitSound(); // Click audio feedback!
          
          this.combo++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.score += points * (1 + Math.floor(this.combo / 10));

          // Visual feedback
          this.screenShake = Math.max(this.screenShake + 4, 10);
          this.gridFlashes[index] = { 
            color: rating === "PERFECT" ? 'rgba(0, 240, 255, 0.35)' : 'rgba(57, 255, 20, 0.25)', 
            val: 1.0 
          };

          // Spark particle explosion
          const col = index % this.gridSize;
          const row = Math.floor(index / this.gridSize);
          const targetX = cx + (col - (this.gridSize - 1) / 2) * (cellSize + cellGap);
          const targetY = cy + (row - (this.gridSize - 1) / 2) * (cellSize + cellGap);
          
          const particleColor = this.cursorColor;
          for (let j = 0; j < 12; j++) {
            this.particles.push(new Particle(targetX, targetY, particleColor));
          }

          this.triggerRating(rating, colorClass);
          this.updateHUD();
        }
      }
    }
  }

  drawGame() {
    // Clear screen (Matches visual theme background color dynamically)
    this.ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim() || '#0e0e12';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.gameState === 'menu' || this.gameState === 'loading') {
      return;
    }

    this.ctx.save();
    // Apply Screen Shake
    if (this.screenShake > 0) {
      const shakeX = (Math.random() - 0.5) * this.screenShake;
      const shakeY = (Math.random() - 0.5) * this.screenShake;
      this.ctx.translate(shakeX, shakeY);
    }

    // Parameters
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const gridBound = Math.min(this.canvas.width, this.canvas.height) * 0.55;
    const cellSize = gridBound / this.gridSize;
    const cellGap = 8;

    // 3. Draw particles
    this.particles.forEach(p => p.draw(this.ctx));

    // 4. Draw Incoming Notes in 3D depth
    const songTime = this.audioController.getCurrentTime();
    
    // Calculate approach rate dynamically locked to the song's BPM
    const songBpm = this.audioController.bpm || 120;
    const beatDuration = 60 / songBpm;
    const beatMultiplier = (this.approachRate || 800) / 400; // default 800ms = 2.0 beats travel duration
    const approachSeconds = beatDuration * beatMultiplier;

    // Filter notes that are visible
    const visibleNotes = this.beatmap.filter(note => {
      if (note.evaluated) return false;
      const dt = note.time - songTime;
      return dt > -0.15 && dt <= approachSeconds;
    });

    // Draw notes from back to front (sorting by time / depth)
    visibleNotes.sort((a, b) => b.time - a.time);

    visibleNotes.forEach(note => {
      const dt = note.time - songTime;
      // depth z: max down to 0
      const z = (dt / approachSeconds) * this.zMax;
      
      const col = note.x;
      const row = note.y;
      const targetX = cx + (col - (this.gridSize - 1) / 2) * (cellSize + cellGap);
      const targetY = cy + (row - (this.gridSize - 1) / 2) * (cellSize + cellGap);

      // Project coordinates
      const proj = this.project3D(cx, cy, targetX, targetY, z);
      const pw = cellSize * proj.scale;
      const ph = cellSize * proj.scale;

      // Note color: fades from blue/magenta to bright cyan/white as it approaches
      const progress = 1 - (z / this.zMax); // 0 to 1
      const alpha = Math.min(1, progress * 1.5);
      const noteColor = `rgba(255, 0, 127, ${alpha})`;
      const coreColor = `rgba(0, 240, 255, ${alpha})`;

      // Draw the incoming note square block (Match active theme accent color dynamically)
      const themeAccentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#ffffff';
      
      this.ctx.save();
      
      // Draw outer outline matching the theme color (Smaller, very rounded, and thicker)
      const ringScale = 0.65; // Smaller ring scale (65% of size)
      const rw = pw * ringScale;
      const rh = ph * ringScale;
      const rx = proj.x - rw/2;
      const ry = proj.y - rh/2;
      const rRadius = rw * 0.16; // Rounded corner radius (less round squircle)

      this.ctx.beginPath();
      if (typeof this.ctx.roundRect === 'function') {
        this.ctx.roundRect(rx, ry, rw, rh, rRadius);
      } else {
        this.ctx.rect(rx, ry, rw, rh);
      }
      this.ctx.strokeStyle = themeAccentColor;
      this.ctx.globalAlpha = alpha * 0.85;
      this.ctx.lineWidth = 3.5 + 4.0 * progress; // Thicker ring outline
      this.ctx.stroke();

      this.ctx.restore();
    });

    // Restore screen shake
    this.ctx.restore();

    // 5. Draw Cursor and Ribbon Trail
    if (this.isMouseInCanvas && this.gameState === 'playing') {
      this.drawCursorTrail();
    }
  }

  drawBackgroundTunnel(cx, cy, cellSize, cellGap) {
    const zBackground = this.zMax * 1.2;
    const scaleBG = this.fov / (this.fov + zBackground);
    const bgCellSize = cellSize * scaleBG;
    const bgCellGap = cellGap * scaleBG;

    // Draw lines connecting outer boundaries
    const totalSizeFront = (cellSize + cellGap) * this.gridSize - cellGap;
    const totalSizeBack = (bgCellSize + bgCellGap) * this.gridSize - bgCellGap;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    this.ctx.lineWidth = 1;

    // Four corners of grid boundary
    this.ctx.moveTo(cx - totalSizeFront/2, cy - totalSizeFront/2);
    this.ctx.lineTo(cx - totalSizeBack/2, cy - totalSizeBack/2);

    this.ctx.moveTo(cx + totalSizeFront/2, cy - totalSizeFront/2);
    this.ctx.lineTo(cx + totalSizeBack/2, cy - totalSizeBack/2);

    this.ctx.moveTo(cx + totalSizeFront/2, cy + totalSizeFront/2);
    this.ctx.lineTo(cx + totalSizeBack/2, cy + totalSizeBack/2);

    this.ctx.moveTo(cx - totalSizeFront/2, cy + totalSizeFront/2);
    this.ctx.lineTo(cx - totalSizeBack/2, cy + totalSizeBack/2);
    this.ctx.stroke();

    // Draw background boundary square
    this.ctx.beginPath();
    this.ctx.rect(cx - totalSizeBack/2, cy - totalSizeBack/2, totalSizeBack, totalSizeBack);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawCursorTrail() {
    // Determine active cursor theme color for trail matching
    let activeTrailColor = this.cursorColor;
    if (this.theme === 'rainbow' || this.theme === 'pink-purple' || this.theme === 'custom') {
      if (this.cursorColor === '#ffffff' || this.cursorColor === '#000000') {
        // If cursor color is white/black, make trail match theme accent color
        activeTrailColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
      }
    }

    // 1. Draw sleek flat ribbon trail (tapers and fades, no neon glow)
    if (this.trailPoints.length > 1) {
      this.ctx.save();
      
      for (let i = 1; i < this.trailPoints.length; i++) {
        const p1 = this.trailPoints[i - 1];
        const p2 = this.trailPoints[i];
        
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        
        const ratio = i / this.trailPoints.length;
        this.ctx.strokeStyle = activeTrailColor;
        this.ctx.globalAlpha = p2.alpha * ratio * 0.45;
        this.ctx.lineWidth = this.cursorRadius * 0.5 * ratio;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();
      }
      this.ctx.restore();
    }

    // 2. Draw active flat cursor (uploaded custom image centered, or flat color dot)
    this.ctx.save();
    if (this.cursorImg && this.cursorImg.complete) {
      const size = this.cursorRadius * 2;
      this.ctx.drawImage(this.cursorImg, this.mouseX - this.cursorRadius, this.mouseY - this.cursorRadius, size, size);
    } else {
      this.ctx.beginPath();
      this.ctx.arc(this.mouseX, this.mouseY, 6, 0, Math.PI * 2);
      this.ctx.fillStyle = activeTrailColor;
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  saveConfig() {
    const config = {
      gridSize: document.getElementById('grid-size-select').value,
      approachRate: document.getElementById('approach-rate-input').value,
      cursorRadius: document.getElementById('cursor-size-input').value,
      difficulty: document.getElementById('difficulty-input').value,
      cursorColor: document.getElementById('cursor-color-input').value,
      songOffset: document.getElementById('offset-input').value,
      audioFocus: document.getElementById('audio-focus-select').value,
      theme: document.getElementById('theme-select').value,
      clickSound: document.getElementById('click-sound-select').value,
      sensitivity: document.getElementById('sensitivity-input').value,
      customBgColor: document.getElementById('custom-bg-color').value,
      customCardColor: document.getElementById('custom-card-color').value,
      customAccentColor: document.getElementById('custom-accent-color').value,
      ytUrl: document.getElementById('yt-url-input').value
    };
    localStorage.setItem('soundspace_config_v2', JSON.stringify(config));
    console.log("Configuration saved to LocalStorage.");
  }

  loadConfig() {
    try {
      const configStr = localStorage.getItem('soundspace_config_v2');
      if (!configStr) return;
      const config = JSON.parse(configStr);
      
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined) {
          el.value = val;
          el.dispatchEvent(new Event('input'));
          el.dispatchEvent(new Event('change'));
        }
      };

      if (config.gridSize) setVal('grid-size-select', config.gridSize);
      if (config.approachRate) setVal('approach-rate-input', config.approachRate);
      if (config.cursorRadius) setVal('cursor-size-input', config.cursorRadius);
      if (config.difficulty) setVal('difficulty-input', config.difficulty);
      if (config.cursorColor) setVal('cursor-color-input', config.cursorColor);
      if (config.songOffset) setVal('offset-input', config.songOffset);
      if (config.audioFocus) setVal('audio-focus-select', config.audioFocus);
      if (config.theme) setVal('theme-select', config.theme);
      if (config.clickSound) setVal('click-sound-select', config.clickSound);
      if (config.sensitivity) setVal('sensitivity-input', config.sensitivity);
      if (config.customBgColor) setVal('custom-bg-color', config.customBgColor);
      if (config.customCardColor) setVal('custom-card-color', config.customCardColor);
      if (config.customAccentColor) setVal('custom-accent-color', config.customAccentColor);
      if (config.ytUrl) setVal('yt-url-input', config.ytUrl);

      console.log("Configuration loaded successfully.");
    } catch (e) {
      console.warn("Failed to load configuration:", e);
    }
  }

  seekGame(seconds) {
    const curTime = this.audioController.getCurrentTime();
    const newTime = Math.max(0, Math.min(curTime + seconds, this.audioController.duration || 180));
    
    // Seek audio playback
    this.audioController.seekTo(newTime);
    
    // Recalibrate evaluated state of beatmap notes
    this.beatmap.forEach(note => {
      if (note.time < newTime) {
        note.evaluated = true;
        note.state = 'miss'; // skip past notes
      } else {
        note.evaluated = false;
        note.state = 'upcoming'; // restore future notes to playable state
      }
    });
    
    console.log(`Seeked playback to ${newTime.toFixed(1)}s (${seconds > 0 ? '+' : ''}${seconds}s shift).`);
  }

  adjustOffset(diffMs) {
    const diffSec = diffMs / 1000;
    
    // Update input element
    const offsetInput = document.getElementById('offset-input');
    if (offsetInput) {
      const currentVal = parseInt(offsetInput.value) || 0;
      const newVal = Math.max(-10000, Math.min(10000, currentVal + diffMs));
      offsetInput.value = newVal;
      
      const offsetVal = document.getElementById('offset-val');
      if (offsetVal) {
        offsetVal.innerText = `${newVal > 0 ? '+' : ''}${newVal}ms`;
      }
      
      // Auto-save configuration
      this.saveConfig();
    }
    
    // Adjust timing of all notes in the active beatmap
    if (this.beatmap) {
      this.beatmap.forEach(note => {
        note.time += diffSec;
      });
    }
    
    // Adjust timing of subtitle lyric intervals
    if (AudioController.LYRIC_INTERVALS) {
      AudioController.LYRIC_INTERVALS.forEach(interval => {
        interval.start += diffSec;
        interval.end += diffSec;
      });
    }
    
    this.showSyncToast(diffMs);
  }

  showSyncToast(diffMs) {
    let toast = document.getElementById('sync-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sync-toast';
      toast.style.position = 'absolute';
      toast.style.top = '12%';
      toast.style.left = '50%';
      toast.style.transform = 'translate(-50%, -50%)';
      toast.style.background = 'rgba(15, 23, 42, 0.9)';
      toast.style.color = '#ffffff';
      toast.style.padding = '10px 24px';
      toast.style.borderRadius = '100px';
      toast.style.fontFamily = 'Outfit, sans-serif';
      toast.style.fontSize = '13px';
      toast.style.fontWeight = '700';
      toast.style.letterSpacing = '1.5px';
      toast.style.zIndex = '10000';
      toast.style.transition = 'opacity 0.25s ease, transform 0.2s ease';
      toast.style.border = '1px solid rgba(255, 255, 255, 0.15)';
      toast.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.5)';
      document.body.appendChild(toast);
    }
    
    const offsetInput = document.getElementById('offset-input');
    const totalOffset = offsetInput ? parseInt(offsetInput.value) : 0;
    
    toast.innerText = `OFFSET: ${totalOffset > 0 ? '+' : ''}${totalOffset}ms (${diffMs > 0 ? '+' : ''}${diffMs}ms)`;
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, -50%) scale(1.05)';
    
    setTimeout(() => {
      toast.style.transform = 'translate(-50%, -50%) scale(1.0)';
    }, 100);
    
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
    }, 1800);
  }

  async refreshLobbiesList() {
    try {
      const res = await fetch('/api/lobby/list');
      if (!res.ok) return;
      const lobbies = await res.json();
      const list = document.getElementById('lobbies-list');
      if (!list) return;
      
      if (lobbies.length === 0) {
        list.innerHTML = `<span class="help-text" style="font-size: 12px; color: #718096;">No active lobbies. Host one!</span>`;
        return;
      }
      
      list.innerHTML = lobbies.map(lobby => `
        <div class="challenge-card" style="margin-bottom: 8px;">
          <div class="challenge-info">
            <span class="challenge-name">${lobby.songArtist} - ${lobby.songTitle}</span>
            <span class="challenge-artist">Lobby Code: ${lobby.code} (${lobby.status})</span>
          </div>
          <button class="action-btn neon-btn join-room-card-btn" data-code="${lobby.code}" style="padding: 5px 12px; font-size: 12px;">JOIN</button>
        </div>
      `).join('');
      
      list.querySelectorAll('.join-room-card-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const code = btn.getAttribute('data-code');
          document.getElementById('join-code-input').value = code;
          this.joinLobby(code);
        });
      });
    } catch (err) {
      console.error("Error fetching lobbies:", err);
    }
  }

  async hostLobby() {
    const songUrl = document.getElementById('yt-url-input').value;
    const difficulty = document.getElementById('difficulty-input').value;
    const gridSize = parseInt(document.getElementById('grid-size-select').value);
    const ar = parseInt(document.getElementById('approach-rate-input').value);
    
    const activeTitle = this.audioController.activeTitle || "YouTube Song";
    const activeAuthor = this.audioController.activeAuthor || "Unknown Artist";
    
    const payload = {
      songUrl,
      songTitle: activeTitle,
      songArtist: activeAuthor,
      difficulty,
      gridSize,
      ar
    };
    
    try {
      const res = await fetch('/api/lobby/host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to host lobby");
      
      const room = await res.json();
      this.isMultiplayer = true;
      this.multiplayerRole = 'host';
      this.lobbyCode = room.code;
      
      document.getElementById('host-code-val').innerText = room.code;
      document.getElementById('host-status-container').classList.remove('hidden');
      document.getElementById('host-status-text').innerText = "Waiting for opponent...";
      document.getElementById('start-multi-btn').classList.add('hidden');
      
      this.startOpponentPoll();
    } catch(err) {
      alert(err.message);
    }
  }

  async joinLobby(code) {
    if (!code) {
      alert("Please enter a room code first.");
      return;
    }
    
    try {
      const res = await fetch('/api/lobby/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to join lobby");
      }
      
      const lobby = await res.json();
      this.isMultiplayer = true;
      this.multiplayerRole = 'guest';
      this.lobbyCode = code;
      
      document.getElementById('yt-url-input').value = lobby.settings.songUrl;
      document.getElementById('difficulty-input').value = lobby.settings.difficulty;
      document.getElementById('grid-size-select').value = lobby.settings.gridSize;
      document.getElementById('approach-rate-input').value = lobby.settings.ar;
      document.getElementById('approach-rate-input').dispatchEvent(new Event('input'));
      
      const joinBtn = document.getElementById('join-lobby-btn');
      if (joinBtn) {
        joinBtn.innerText = `LOBBY JOINED (${code})`;
        joinBtn.disabled = true;
      }
      
      this.startMatchStartPoll();
    } catch(err) {
      alert(err.message);
    }
  }

  startOpponentPoll() {
    if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
    
    this.multiplayerInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/lobby/status?code=${this.lobbyCode}`);
        if (!res.ok) return;
        const room = await res.json();
        
        if (room.status === 'ready') {
          document.getElementById('host-status-text').innerText = "Opponent is ready!";
          document.getElementById('start-multi-btn').classList.remove('hidden');
        }
      } catch(err) {
        console.error("Opponent poll error:", err);
      }
    }, 1000);
  }

  startMatchStartPoll() {
    if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
    
    this.multiplayerInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/lobby/status?code=${this.lobbyCode}`);
        if (!res.ok) return;
        const room = await res.json();
        
        if (room.status === 'playing') {
          clearInterval(this.multiplayerInterval);
          this.handleLoadAndStart();
        }
      } catch(err) {
        console.error("Match start poll error:", err);
      }
    }, 1000);
  }

  async startMultiMatch() {
    try {
      const res = await fetch('/api/lobby/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: this.lobbyCode })
      });
      if (!res.ok) throw new Error("Failed to start lobby match");
      
      clearInterval(this.multiplayerInterval);
      this.handleLoadAndStart();
    } catch(err) {
      alert(err.message);
    }
  }

  startMultiplayerGameLoop() {
    if (this.multiplayerInterval) clearInterval(this.multiplayerInterval);
    this.oppFinished = false;
    
    const vsPanel = document.getElementById('multiplayer-vs-panel');
    if (vsPanel) vsPanel.classList.remove('hidden');
    
    this.multiplayerInterval = setInterval(async () => {
      if (this.gameState !== 'playing' && this.gameState !== 'finished') return;
      
      const hitsCount = this.hitsPerfect + this.hitsGood + this.hitsOkay;
      const notesRatio = `${hitsCount}/${this.totalNotes || 0}`;
      
      const payload = {
        code: this.lobbyCode,
        role: this.multiplayerRole,
        score: this.score,
        acc: this.accDisplay.innerText,
        combo: this.combo,
        misses: this.misses,
        notes: notesRatio,
        finished: this.gameState === 'finished'
      };
      
      try {
        await fetch('/api/lobby/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        const res = await fetch(`/api/lobby/status?code=${this.lobbyCode}`);
        if (!res.ok) return;
        const room = await res.json();
        
        const me = this.multiplayerRole === 'host' ? room.host : room.guest;
        const opp = this.multiplayerRole === 'host' ? room.guest : room.host;
        
        if (opp) {
          document.getElementById('vs-my-score').innerText = me.score.toLocaleString('en-US');
          document.getElementById('vs-my-acc').innerText = me.acc;
          
          document.getElementById('vs-opp-score').innerText = opp.score.toLocaleString('en-US');
          document.getElementById('vs-opp-acc').innerText = opp.acc;
        }
      } catch(err) {
        console.error("Multiplayer gameplay loop error:", err);
      }
    }, 250);
  }

  async sendFinalMultiStats() {
    const hitsCount = this.hitsPerfect + this.hitsGood + this.hitsOkay;
    const notesRatio = `${hitsCount}/${this.totalNotes || 0}`;
    
    const payload = {
      code: this.lobbyCode,
      role: this.multiplayerRole,
      score: this.score,
      acc: this.accDisplay.innerText,
      combo: this.combo,
      misses: this.misses,
      notes: notesRatio,
      finished: true
    };
    
    try {
      await fetch('/api/lobby/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      this.multiplayerInterval = setInterval(async () => {
        const res = await fetch(`/api/lobby/status?code=${this.lobbyCode}`);
        if (!res.ok) return;
        const room = await res.json();
        
        const me = this.multiplayerRole === 'host' ? room.host : room.guest;
        const opp = this.multiplayerRole === 'host' ? room.guest : room.host;
        
        if (opp) {
          document.getElementById('my-final-score').innerText = me.score.toLocaleString('en-US');
          document.getElementById('opp-final-score').innerText = opp.score.toLocaleString('en-US');
          document.getElementById('opp-final-acc').innerText = opp.acc;
          
          const outcomeEl = document.getElementById('multiplayer-outcome');
          if (opp.finished) {
            clearInterval(this.multiplayerInterval);
            if (me.score > opp.score) {
              outcomeEl.innerText = "🏆 YOU WON!";
              outcomeEl.style.color = "#d946ef";
            } else if (me.score < opp.score) {
              outcomeEl.innerText = "💀 YOU LOST!";
              outcomeEl.style.color = "#ff5252";
            } else {
              outcomeEl.innerText = "🤝 IT'S A TIE!";
              outcomeEl.style.color = "#ffffff";
            }
          } else {
            outcomeEl.innerText = "Waiting for Opponent...";
            outcomeEl.style.color = "#718096";
          }
        }
      }, 500);
    } catch(err) {
      console.error("Failed to send final multi stats:", err);
    }
  }
}

// Initialize Game Engine on page load
window.addEventListener('DOMContentLoaded', () => {
  window.gameEngine = new GameEngine();
});
