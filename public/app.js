/**
 * Pulse Dance PWA MVP
 * Main Application Logic & State Machine
 */

// --- STATE MACHINE ---
const STATES = {
    BOOT: 'BOOT',
    READY: 'READY',
    REQUEST_PERMISSIONS: 'REQUEST_PERMISSIONS',
    SELECT_MOOD: 'SELECT_MOOD',
    JOIN_ROOM: 'JOIN_ROOM',
    SOLO_ACTIVE: 'SOLO_ACTIVE',
    ENCOUNTER_ACTIVE: 'ENCOUNTER_ACTIVE',
    PROXIMITY_SUSTAINED: 'PROXIMITY_SUSTAINED',
    DISCONNECTED: 'DISCONNECTED'
  };
  
  let currentState = STATES.BOOT;
  
  // App Data
  let currentMood = null;
  let movementIntensity = 0; // 0 to 100
  let lastAcceleration = { x: 0, y: 0, z: 0 };
  
  // Timer State
  let soloTimerTimeout = null;
  let hintShown = false;

  // Sync / Polling State
  const localClientId = Math.random().toString(36).substring(2, 15);
  let heartbeatInterval = null;
  
  // Audio Data
  let audioContext = null;
  let baseAudioSource = null;
  let baseGain = null;
  let encounterAudioSource = null;
  let encounterGain = null;
  let audioBuffers = {}; // Store preloaded tracks
  
  // DOM Elements
  const screens = {
    ready: document.getElementById('screen-ready'),
    permissions: document.getElementById('screen-permissions'),
    mood: document.getElementById('screen-mood'),
    active: document.getElementById('screen-active')
  };
  
  const ui = {
    statusHeader: document.getElementById('status-header'),
    poeticHint: document.getElementById('poetic-hint'),
    pulseVisual: document.getElementById('pulse-visual'),
    intensitySpan: document.querySelector('#intensity-display span'),
    userCountSpan: document.getElementById('active-user-count'),
    debugState: document.getElementById('debug-state'),
    debugLog: document.getElementById('debug-log'),
    debugContent: document.getElementById('debug-content')
  };
  
  // --- CORE LOGIC ---
  
  function init() {
    log('App Booted');
    bindEvents();
    
    // Pre-initialize the Audio Context immediately upon load (in suspended state)
    // to reduce latency when a mood is selected
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!audioContext && AudioContext) {
        audioContext = new AudioContext();
    }
    
    // Asynchronously preload all audio files into RAM immediately while reading the Intro screen
    preloadAllAudio();
    
    transitionTo(STATES.READY);
    
    // Start the visual update loop
    requestAnimationFrame(updateVisuals);
  }
  
  function transitionTo(newState) {
    log(`Transition: ${currentState} -> ${newState}`);
    currentState = newState;
    ui.debugState.textContent = newState;
  
    // Hide all screens
    Object.values(screens).forEach(screen => {
      screen.classList.remove('active');
      screen.classList.add('hidden');
    });
  
    // Handle specific state logic
    switch (newState) {
      case STATES.READY:
        screens.ready.classList.remove('hidden');
        screens.ready.classList.add('active');
        break;
  
      case STATES.REQUEST_PERMISSIONS:
        screens.permissions.classList.remove('hidden');
        screens.permissions.classList.add('active');
        break;
  
      case STATES.SELECT_MOOD:
        screens.mood.classList.remove('hidden');
        screens.mood.classList.add('active');
        break;
  
      case STATES.JOIN_ROOM:
        screens.active.classList.remove('hidden');
        screens.active.classList.add('active');
        ui.statusHeader.textContent = 'Connecting...';
        startHeartbeat();
        break;
  
      case STATES.SOLO_ACTIVE:
        screens.active.classList.remove('hidden');
        screens.active.classList.add('active');
        
        if (currentMood === 'calm') {
            ui.statusHeader.textContent = `Relax, you are safe`;
        } else if (currentMood === 'anxious') {
            ui.statusHeader.textContent = `Move your body to shake off anxiety.`;
        } else if (currentMood === 'playful') {
            ui.statusHeader.textContent = `Have fun! Shake your phone and dance!`;
        } else {
            ui.statusHeader.textContent = `Dancing Solo (${currentMood})`;
        }
        
        ui.pulseVisual.classList.remove('encounter');
        ui.pulseVisual.classList.remove('harmonized');
        ui.pulseVisual.classList.remove('glow-hint');
        stopVibration();
        
        // Reset filter and gracefully mute encounter track
        if (encounterGain && audioContext) {
            encounterGain.gain.setTargetAtTime(0, audioContext.currentTime, 1.5);
        }
        if (window.encounterFilter && audioContext) {
            window.encounterFilter.frequency.setTargetAtTime(500, audioContext.currentTime, 2.0); 
        }
        
        // Ensure the hint doesn't show immediately if switching back to solo quickly
        if (soloTimerTimeout) clearTimeout(soloTimerTimeout);
        hintShown = false;
        
        log('Starting 15s solo timer...');
        soloTimerTimeout = setTimeout(() => {
            if (currentState === STATES.SOLO_ACTIVE && !hintShown) {
                ui.poeticHint.classList.add('visible');
                ui.pulseVisual.classList.add('glow-hint');
                hintShown = true;
                log('15s reached: Hint shown, color transitioning...');
                
                // Trigger PROXIMITY_SUSTAINED exactly 4s after the hint shows
                setTimeout(() => {
                    if (currentState === STATES.SOLO_ACTIVE) {
                        log('4s delay finished: Triggering local PROXIMITY_SUSTAINED magic!');
                        transitionTo(STATES.PROXIMITY_SUSTAINED);
                    }
                }, 4000);
            }
        }, 15000);
        break;
  
      case STATES.ENCOUNTER_ACTIVE:
        screens.active.classList.remove('hidden');
        screens.active.classList.add('active');
        ui.statusHeader.textContent = ''; 
        ui.pulseVisual.classList.add('encounter');
        ui.pulseVisual.classList.remove('harmonized');
        
        // 1. SOUND: Increase volume (100%) and ramp faster (0.5 time constant = ~1.5s total fade)
        if (encounterGain && audioContext) {
            encounterGain.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.5);
        }
        
        // 2. HAPTICS: Distinct 3-pulse vibration pattern to signal mode change
        if ("vibrate" in navigator) {
            navigator.vibrate([200, 100, 200, 100, 400]); 
        }
        break;

      case STATES.PROXIMITY_SUSTAINED:
        screens.active.classList.remove('hidden');
        screens.active.classList.add('active');
        ui.pulseVisual.classList.add('harmonized');
        startVibration(); // Start the heartbeat haptics
        
        // The Magical Harmonization:
        // 1. Bring encounter layer up to 100% volume smoothly and continuously using linearRampToValueAtTime (8 seconds fade in)
        if (encounterGain && audioContext) {
            encounterGain.gain.cancelScheduledValues(audioContext.currentTime);
            // Must set the current value to lock it in before ramping
            encounterGain.gain.setValueAtTime(encounterGain.gain.value, audioContext.currentTime);
            encounterGain.gain.linearRampToValueAtTime(1.0, audioContext.currentTime + 8.0);
        }
        
        // 2. Filter Sweep: Slowly open the low-pass filter over 8 seconds 
        // to reveal the bright, full-spectrum encounter sound harmoniously.
        if (window.encounterFilter && audioContext) {
            window.encounterFilter.frequency.cancelScheduledValues(audioContext.currentTime);
            window.encounterFilter.frequency.setValueAtTime(window.encounterFilter.frequency.value, audioContext.currentTime);
            window.encounterFilter.frequency.linearRampToValueAtTime(20000, audioContext.currentTime + 8.0); 
        }
        break;
  
      case STATES.DISCONNECTED:
        screens.active.classList.remove('hidden');
        screens.active.classList.add('active');
        ui.statusHeader.textContent = 'Disconnected. Retrying...';
        break;
    }
  }
  
  // --- EVENT BINDING ---
  function bindEvents() {
    // Main Flow Buttons
    document.getElementById('btn-begin').addEventListener('click', () => {
      // Transition to permissions if on iOS, or direct to mood if already granted/Android
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        transitionTo(STATES.REQUEST_PERMISSIONS);
      } else {
        transitionTo(STATES.SELECT_MOOD);
        startMotionTracking(); // Android/others don't need direct permission prompt
      }
    });
  
    document.getElementById('btn-grant-permissions').addEventListener('click', async () => {
      try {
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
          const permissionState = await DeviceMotionEvent.requestPermission();
          if (permissionState === 'granted') {
            startMotionTracking();
            transitionTo(STATES.SELECT_MOOD);
          } else {
            alert('Motion permission is required.');
          }
        } else {
          // Fallback if permission isn't a function but it triggered anyway
          startMotionTracking();
          transitionTo(STATES.SELECT_MOOD);
        }
      } catch (e) {
        log('Error requesting permissions: ' + e);
        alert('Permission request failed: ' + e.message);
      }
    });
  
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        currentMood = e.target.getAttribute('data-mood');
        log(`Mood selected: ${currentMood}. Loading...`);
        
        // Show loading state BEFORE transitioning to room
        screens.mood.classList.remove('active');
        screens.mood.classList.add('hidden');
        screens.active.classList.remove('hidden');
        screens.active.classList.add('active');
        ui.statusHeader.textContent = 'Loading sounds...';
        
        // Wait for audio to fully load and decode before joining room
        await initAudio(); 
        
        // Now that audio is playing silently, join the room
        transitionTo(STATES.JOIN_ROOM);
      });
    });
  
    // Debug Panel Events
    document.getElementById('btn-toggle-debug').addEventListener('click', () => {
      ui.debugContent.classList.toggle('open');
    });
  
    document.getElementById('debug-btn-solo').addEventListener('click', () => {
      syncState('FORCE_SOLO');
      transitionTo(STATES.SOLO_ACTIVE);
    });
  
    document.getElementById('debug-btn-encounter').addEventListener('click', () => {
      syncState('FORCE_ENCOUNTER');
      transitionTo(STATES.ENCOUNTER_ACTIVE);
    });
  
    document.getElementById('debug-intensity').addEventListener('input', (e) => {
      movementIntensity = parseInt(e.target.value);
    });
  
    document.getElementById('debug-btn-vibrate').addEventListener('click', () => {
      triggerSingleVibration();
    });
  }
  
  // --- HTTP POLLING (Replaces WebSockets for Vercel) ---
  let syncInterval = null;

  async function syncState(action = 'heartbeat') {
      try {
          const res = await fetch('/api/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clientId: localClientId, type: action })
          });
          const msg = await res.json();
          
          // Update UI counter
          if (msg.activeCount !== undefined) {
              ui.userCountSpan.textContent = msg.activeCount;
              // Log to debug panel so we can see it's working
              // log(`Active users: ${msg.activeCount}`); 
          }

          // ONLY trigger a transition if we are truly changing states
          // Otherwise, we keep restarting the 15-second solo timer!
          if (msg.type === 'SOLO_ACTIVE' && currentState !== STATES.SOLO_ACTIVE) {
              transitionTo(STATES.SOLO_ACTIVE);
          } else if (msg.type === 'ENCOUNTER_ACTIVE' && currentState !== STATES.ENCOUNTER_ACTIVE) {
              transitionTo(STATES.ENCOUNTER_ACTIVE);
          } else if (msg.type === 'PROXIMITY_SUSTAINED' && currentState !== STATES.PROXIMITY_SUSTAINED) {
              transitionTo(STATES.PROXIMITY_SUSTAINED);
          }
      } catch (e) {
          console.error(e);
          log('Sync Error (Check server console)');
      }
  }

  function startHeartbeat() {
    log('Starting API Polling');
    syncState(); // initial sync
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => syncState('heartbeat'), 3000);
  }
  
  // --- HARDWARE APIs ---
  
  async function fetchAndDecodeAudio(filename) {
    if (audioBuffers[filename]) {
        return audioBuffers[filename]; // Return cached buffer if already preloaded
    }
    
    let url = `assets/${filename}.mp3`;
    try {
        let response = await fetch(url);
        if (!response.ok) {
            url = `assets/${filename}.aiff`;
            response = await fetch(url);
        }
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
        audioBuffers[filename] = decodedBuffer; // Cache it
        return decodedBuffer;
    } catch (e) {
        log(`Failed to load audio for ${filename}. Tried .mp3 and .aiff.`);
        return null;
    }
  }

  async function preloadAllAudio() {
      // Aggressively download and decode all tracks in the background while user reads Intro screens
      log('Background preloading started...');
      try {
          await Promise.all([
              fetchAndDecodeAudio('calm'),
              fetchAndDecodeAudio('anxious'),
              fetchAndDecodeAudio('playful'),
              fetchAndDecodeAudio('encounter')
          ]);
          log('All audio tracks successfully preloaded into RAM.');
      } catch (e) {
          log('Preloading failed, will fallback to loading on click.');
      }
  }

  async function initAudio() {
    log('Initializing audio playback from RAM...');
    
    // Explicitly resume (needed for iOS Safari to unlock audio context on user interaction)
    if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
    }
    
    // If we've already loaded and started these specific tracks, just return
    if (baseAudioSource && encounterAudioSource) {
        return;
    }
    
    // Grab completely pre-decoded tracks from RAM (instant/zero latency)
    const baseBuffer = await fetchAndDecodeAudio(currentMood);
    const encounterBuffer = await fetchAndDecodeAudio('encounter');
    
    // Create Base Track Nodes
    baseGain = audioContext.createGain();
    baseGain.gain.value = 0; // Starts silent, volume controlled by movement
    baseGain.connect(audioContext.destination);
    
    if (baseBuffer) {
        baseAudioSource = audioContext.createBufferSource();
        baseAudioSource.buffer = baseBuffer;
        baseAudioSource.loop = true;
        baseAudioSource.connect(baseGain);
        baseAudioSource.start(); // Starts instantly from RAM
    } else {
        log('WARNING: Base track missing.');
    }
    
    // Create Encounter Track Nodes
    encounterGain = audioContext.createGain();
    encounterGain.gain.value = 0; // Starts silent, opens during ENCOUNTER_ACTIVE
    
    // Create a Low-Pass Filter for the encounter track
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500; // Start muffled
    
    // Store it globally so we can sweep it during encounter
    window.encounterFilter = filter; 
    
    encounterGain.connect(filter);
    filter.connect(audioContext.destination);
    
    if (encounterBuffer) {
        encounterAudioSource = audioContext.createBufferSource();
        encounterAudioSource.buffer = encounterBuffer;
        encounterAudioSource.loop = true;
        encounterAudioSource.connect(encounterGain);
        encounterAudioSource.start(); // Starts instantly from RAM in sync with base
    } else {
        log('WARNING: Encounter track missing.');
    }
    
    log('Audio initialized and playing perfectly in sync.');
  }

  function startMotionTracking() {
    log('Motion tracking started');
    
    window.addEventListener('devicemotion', (event) => {
      if (!event.acceleration) return;
      
      const acc = event.acceleration;
      // Calculate delta
      const dx = Math.abs(acc.x - lastAcceleration.x);
      const dy = Math.abs(acc.y - lastAcceleration.y);
      const dz = Math.abs(acc.z - lastAcceleration.z);
      
      const delta = dx + dy + dz;
      
      // Simple smoothing/mapping to 0-100 scale
      const isOverridden = document.getElementById('debug-intensity').value > 0;
      
      // Increased sensitivity (lower threshold, higher multiplier) so normal dancing keeps music playing
      if (!isOverridden && delta > 0.2) {
        let newIntensity = Math.min(100, movementIntensity + (delta * 4));
        movementIntensity = newIntensity;
      } else if (!isOverridden) {
        // Slower decay so music doesn't cut out instantly between dance moves
        movementIntensity = Math.max(0, movementIntensity - 1);
      }
  
      lastAcceleration = { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 };
    });
  }
  
  let vibrationInterval;
  function startVibration() {
    if ("vibrate" in navigator) {
      log('Starting heartbeat vibration');
      // Vibrate for 100ms, pause for 400ms
      vibrationInterval = setInterval(() => {
        navigator.vibrate(100);
      }, 500);
    } else {
      log('Vibration not supported on this device');
    }
  }
  
  function stopVibration() {
    if ("vibrate" in navigator) {
      clearInterval(vibrationInterval);
      navigator.vibrate(0);
    }
  }
  
  function triggerSingleVibration() {
    if ("vibrate" in navigator) {
      navigator.vibrate(200);
      log('Vibrated 200ms');
    } else {
      log('Vibration not supported');
    }
  }
  
  // --- RENDER LOOP ---
  function updateVisuals() {
    if (currentState === STATES.SOLO_ACTIVE || currentState === STATES.ENCOUNTER_ACTIVE || currentState === STATES.PROXIMITY_SUSTAINED) {
      ui.intensitySpan.textContent = Math.round(movementIntensity);
      
      // Aggressive fallback: Ensure iOS hasn't randomly suspended the audio context
      if (audioContext && audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
      }
      
      // Ensure the text stays exactly as requested in all subsequent states.
      // Removing this logic so the text STAYS VISIBLE once it appears.

      // Update Audio Volume based on movement intensity (0 to 1)
      if (baseGain && audioContext) {
          let targetVol;
          
          if (currentMood === 'calm') {
              // Calm mood is for sitting/meditating. It stays at a constant full volume, ignoring movement.
              targetVol = 1.0;
          } else {
              // For anxious and playful, map 0-40 intensity to 0-1 volume
              targetVol = Math.min(1, movementIntensity / 40); 
              // Faint but audible baseline so the track doesn't completely die when standing still
              targetVol = Math.max(0.15, targetVol); 
          }
          
          // Smoother, longer ramp time (0.3s) to prevent audio stuttering during dance direction changes
          baseGain.gain.setTargetAtTime(targetVol, audioContext.currentTime, 0.3);
      }
      
      // Scale and opacity of the pulse visual based on movement
      const scale = 1 + (movementIntensity / 100);
      const opacity = 0.2 + (movementIntensity / 100) * 0.8;
      
      ui.pulseVisual.style.transform = `scale(${scale})`;
      ui.pulseVisual.style.opacity = opacity;
    }
    
    requestAnimationFrame(updateVisuals);
  }
  
  // --- UTILS ---
  function log(msg) {
    console.log(msg);
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString().split(' ')[0];
    div.textContent = `[${time}] ${msg}`;
    ui.debugLog.prepend(div);
  }
  
  // Boot the app
  init();
