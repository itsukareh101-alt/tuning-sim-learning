
class AudioService {
  private ctx: AudioContext | null = null;
  // Multi-layer oscillators for engine character
  private subOsc: OscillatorNode | null = null;
  private midOsc: OscillatorNode | null = null;
  private highOsc: OscillatorNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  
  // Gains for layers
  private subGain: GainNode | null = null;
  private midGain: GainNode | null = null;
  private highGain: GainNode | null = null;
  private turboGain: GainNode | null = null;
  private intakeGain: GainNode | null = null;
  private exhaustNoise: AudioBufferSourceNode | null = null;
  private exhaustGain: GainNode | null = null;

  private engineFilter: BiquadFilterNode | null = null;
  private distortion: WaveShaperNode | null = null;
  private masterGain: GainNode | null = null;
  private isStarted = false;

  private lastThrottle = 0;

  constructor() {}

  private makeDistortionCurve(amount: number) {
    const k = amount;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  private init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);

    // Distortion for "bite" under load
    this.distortion = this.ctx.createWaveShaper();
    this.distortion.curve = this.makeDistortionCurve(50);
    this.distortion.oversample = '4x';

    // Filter to shape the overall engine tone (Low Pass)
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 800;
    this.engineFilter.Q.value = 1.2;
    
    this.engineFilter.connect(this.distortion);
    this.distortion.connect(this.masterGain);

    // Layer 1: Sub-bass (Triangle for displacement)
    this.subOsc = this.ctx.createOscillator();
    this.subOsc.type = 'triangle';
    this.subGain = this.ctx.createGain();
    this.subGain.gain.value = 0;
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.engineFilter);

    // Layer 2: Main Mechanical Growl (Sawtooth)
    this.midOsc = this.ctx.createOscillator();
    this.midOsc.type = 'sawtooth';
    this.midGain = this.ctx.createGain();
    this.midGain.gain.value = 0;
    this.midOsc.connect(this.midGain);
    this.midGain.connect(this.engineFilter);

    // Layer 3: High-end Raspy (Square with high pass)
    this.highOsc = this.ctx.createOscillator();
    this.highOsc.type = 'square';
    this.highGain = this.ctx.createGain();
    this.highGain.gain.value = 0;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    this.highOsc.connect(hp);
    hp.connect(this.highGain);
    this.highGain.connect(this.engineFilter);

    // Layer 4: Turbo Whistle (High pitch sine)
    this.turboOsc = this.ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboGain = this.ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboGain.connect(this.masterGain);

    // Layer 5: Intake / Airflow (Pink-ish noise)
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    this.exhaustNoise = this.ctx.createBufferSource();
    this.exhaustNoise.buffer = noiseBuffer;
    this.exhaustNoise.loop = true;
    this.exhaustGain = this.ctx.createGain();
    this.exhaustGain.gain.value = 0;
    
    this.intakeGain = this.ctx.createGain();
    this.intakeGain.gain.value = 0;

    const intakeFilter = this.ctx.createBiquadFilter();
    intakeFilter.type = 'lowpass';
    intakeFilter.frequency.value = 500;

    this.exhaustNoise.connect(this.exhaustGain);
    this.exhaustGain.connect(this.engineFilter);
    
    this.exhaustNoise.connect(intakeFilter);
    intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.masterGain);

    // Start all
    this.subOsc.start();
    this.midOsc.start();
    this.highOsc.start();
    this.turboOsc.start();
    this.exhaustNoise.start();

    this.isStarted = true;
  }

  public async startEngine() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
    
    const now = this.ctx!.currentTime;
    this.subGain?.gain.setTargetAtTime(0.4, now, 0.1);
    this.midGain?.gain.setTargetAtTime(0.25, now, 0.1);
    this.exhaustGain?.gain.setTargetAtTime(0.08, now, 0.5);
  }

  public stopEngine() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.subGain?.gain.setTargetAtTime(0, now, 0.2);
    this.midGain?.gain.setTargetAtTime(0, now, 0.2);
    this.highGain?.gain.setTargetAtTime(0, now, 0.2);
    this.turboGain?.gain.setTargetAtTime(0, now, 0.2);
    this.exhaustGain?.gain.setTargetAtTime(0, now, 0.5);
    this.intakeGain?.gain.setTargetAtTime(0, now, 0.2);
  }

  public updateRPM(rpm: number, load: number, isLimiter: boolean) {
    if (!this.ctx || !this.subOsc || !this.midOsc || !this.highOsc || !this.turboOsc || !this.engineFilter) return;

    const now = this.ctx.currentTime;
    const throttle = load / 220; // Normalized 0-1

    // BOV Effect (Turbo sneeze)
    if (this.lastThrottle > 0.4 && throttle < 0.1) {
      this.playBOV();
    }
    this.lastThrottle = throttle;

    // Frequencies (Deeper 4B11T Tuning)
    const baseFreq = 20 + (rpm / 8000) * 220; 
    this.subOsc.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.midOsc.frequency.setTargetAtTime(baseFreq * 2.05, now, 0.05); // Slight detune for thickness
    this.highOsc.frequency.setTargetAtTime(baseFreq * 4.0, now, 0.05);

    // Filter follows RPM + Throttle - extremely wide sweep
    const filterFreq = 250 + (rpm / 8000) * 5000 + (throttle * 3500);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, now, 0.05);

    // Gain adjustment based on Load 
    const loadMultiplier = 1.0 + throttle * 2.0;
    this.subGain?.gain.setTargetAtTime(0.6 * (0.85 + throttle * 0.6), now, 0.05); 
    this.midGain?.gain.setTargetAtTime(0.35 * loadMultiplier, now, 0.05);
    this.highGain?.gain.setTargetAtTime(0.12 * throttle * (rpm / 3500), now, 0.05); 
    this.intakeGain?.gain.setTargetAtTime(throttle * 0.15, now, 0.1);
    
    // Turbo Whistle
    const turboSpool = Math.min(1, (rpm / 6000) * (throttle > 0 ? 1 : 0.2));
    this.turboOsc.frequency.setTargetAtTime(1200 + turboSpool * 2500, now, 0.1); 
    this.turboGain?.gain.setTargetAtTime(turboSpool * 0.06, now, 0.2); 

    // Limiter (Aggressive stutter + Pops)
    if (isLimiter) {
      const stutter = Math.sin(now * 150) > 0.35 ? 1 : 0;
      this.masterGain?.gain.setValueAtTime(stutter * 0.6, now);
      
      if (Math.random() > 0.7) {
        this.playPop();
      }
    } else {
      this.masterGain?.gain.setTargetAtTime(0.5, now, 0.01);
    }
  }

  private playBOV() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1500;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start();
  }

  private playPop() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    
    // Low frequency thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(40, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 0.1);
    gain.gain.setValueAtTime(0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    
    // High frequency crackle/noise
    const noise = this.ctx.createBufferSource();
    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = noiseBuffer;
    
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1000 + Math.random() * 2000;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    osc.start();
    osc.stop(now + 0.1);
    noise.start();
  }

  public playKnock() {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800 + Math.random() * 400, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }
}

export const audioService = new AudioService();
