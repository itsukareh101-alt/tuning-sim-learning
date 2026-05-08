import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  AlertTriangle, 
  Play, 
  RotateCcw, 
  MessageSquare, 
  Cpu, 
  Gauge as GaugeIcon,
  Zap,
  Droplets,
  Send
} from 'lucide-react';
import { getMentorAdvice, chatWithMentor } from './services/mentorService';
import { Telemetry, EngineStatus, TuningTableData } from './types';
import { audioService } from './services/audioService';

// Constants
const TICK_RATE = 50; // ms
const MAX_RPM = 8000;
const IDLE_RPM = 850;
const TARGET_AFR = 14.7;

const INITIAL_FUEL_DATA = Array.from({ length: 12 }, () => [14.7, 14.7, 14.5, 14.2, 14.0, 13.5, 13.0, 12.5, 12.0, 11.5]);
const INITIAL_TIMING_DATA = [
  [15, 14, 13, 12, 11, 10, 9, 8, 7.5, 6.5], // 800 RPM
  [18, 17, 16, 15, 14, 13, 12, 11, 10, 8.5],
  [28, 26, 25, 24, 22, 20, 18, 16, 14, 11], // 2500 RPM
  [30, 28, 27, 26, 24, 22, 20, 18, 16, 13],
  [32, 30, 29, 28, 26, 24, 22, 20, 16.5, 13], // 4500 RPM
  [34, 32, 31, 30, 28, 26, 24, 22, 18.5, 15], // 5500 RPM
  [35, 33, 32, 31, 29, 27, 25, 23, 19, 15.5],
  [36, 34, 33, 32, 30, 28, 26, 24, 20, 16.5], // 7000 RPM
  [37, 35, 34, 33, 31, 29, 27, 25, 21, 17],
  [38, 36, 35, 34, 32, 30, 28, 26, 22, 18],
  [39, 37, 36, 35, 33, 31, 29, 27, 23, 19],
  [40, 38, 37, 36, 34, 32, 30, 28, 24, 20],
];
const INITIAL_ROWS = Array.from({ length: 12 }, (_, i) => 200 + i * (7500 - 200) / 11);
const INITIAL_COLS = Array.from({ length: 10 }, (_, i) => 0 + i * 220 / 9);

export default function App() {
  // Layout State
  const [isMentorVisible, setIsMentorVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'fuel' | 'timing' | 'limiter' | 'axes' | 'idle'>('timing');
  const [isGasPedalDown, setIsGasPedalDown] = useState(false);

  // Engine State
  const [status, setStatus] = useState<EngineStatus>('OFF');
  const [deathReason, setDeathReason] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>({
    rpm: 0,
    tps: 0,
    afr: 14.7,
    load: 0,
    knockCount: 0,
    timing: 15,
    revLimit: 7500,
    engineStressed: false,
    engineTemp: 85,
    mode: 'IDLE',
  });

  // Idle Control State (Draft/UI)
  const [maxIdleTps, setMaxIdleTps] = useState(12);
  const [idleRpmUpperLimit, setIdleRpmUpperLimit] = useState(250);
  const [coolantTemp, setCoolantTemp] = useState(104); // Fahrenheit (Lives/Sensor)
  const [idleRpmCurve, setIdleRpmCurve] = useState([1500, 1300, 1150, 950, 850, 750]); 
  const [idleDutyCurve, setIdleDutyCurve] = useState([45, 40, 35, 30, 25, 20]); 
  
  // Active Idle Configuration (Physics Engine)
  const [activeIdleConfig, setActiveIdleConfig] = useState({
    maxIdleTps: 12,
    idleRpmUpperLimit: 250,
    idleRpmCurve: [1500, 1300, 1150, 950, 850, 750],
    idleDutyCurve: [45, 40, 35, 30, 25, 20]
  });

  const [fuelTable, setFuelTable] = useState<TuningTableData>({
    rows: [...INITIAL_ROWS],
    cols: [...INITIAL_COLS],
    data: INITIAL_FUEL_DATA.map(row => [...row]),
  });

  const [timingTable, setTimingTable] = useState<TuningTableData>({
    rows: [...INITIAL_ROWS],
    cols: [...INITIAL_COLS],
    data: INITIAL_TIMING_DATA.map(row => [...row]),
  });

  // Saved Tuning States
  const [savedFuelTable, setSavedFuelTable] = useState<TuningTableData | null>(null);
  const [savedTimingTable, setSavedTimingTable] = useState<TuningTableData | null>(null);
  const [savedRevLimit, setSavedRevLimit] = useState<number | null>(null);
  const [savedIdleConfig, setSavedIdleConfig] = useState<any | null>(null);

  const saveCurrentState = () => {
    setSavedFuelTable(JSON.parse(JSON.stringify(fuelTable)));
    setSavedTimingTable(JSON.parse(JSON.stringify(timingTable)));
    setSavedRevLimit(revLimit);
    setSavedIdleConfig({
      maxIdleTps,
      idleRpmUpperLimit,
      idleRpmCurve: [...idleRpmCurve],
      idleDutyCurve: [...idleDutyCurve],
      activeIdleConfig: { ...activeIdleConfig }
    });
    // Visual feedback for save would be nice but not strictly requested
  };

  // Table selector
  const activeMap = activeTab === 'fuel' ? fuelTable : timingTable;
  const setActiveMap = activeTab === 'fuel' ? setFuelTable : setTimingTable;

  const resetMap = () => {
    if (activeTab === 'fuel') {
      if (savedFuelTable) {
        setFuelTable(JSON.parse(JSON.stringify(savedFuelTable)));
      } else {
        setFuelTable(prev => ({ 
          ...prev, 
          data: INITIAL_FUEL_DATA.map(row => [...row]),
          rows: [...INITIAL_ROWS],
          cols: [...INITIAL_COLS]
        }));
      }
    } else if (activeTab === 'timing') {
      if (savedTimingTable) {
        setTimingTable(JSON.parse(JSON.stringify(savedTimingTable)));
      } else {
        setTimingTable(prev => ({ 
          ...prev, 
          data: INITIAL_TIMING_DATA.map(row => [...row]),
          rows: [...INITIAL_ROWS],
          cols: [...INITIAL_COLS]
        }));
      }
    } else if (activeTab === 'limiter') {
      setRevLimit(savedRevLimit ?? 7500);
      setRevHysteresis(100);
    } else if (activeTab === 'idle') {
      if (savedIdleConfig) {
        setMaxIdleTps(savedIdleConfig.maxIdleTps);
        setIdleRpmUpperLimit(savedIdleConfig.idleRpmUpperLimit);
        setIdleRpmCurve([...savedIdleConfig.idleRpmCurve]);
        setIdleDutyCurve([...savedIdleConfig.idleDutyCurve]);
        setActiveIdleConfig({ ...savedIdleConfig.activeIdleConfig });
      } else {
        setMaxIdleTps(12);
        setIdleRpmUpperLimit(250);
        setIdleRpmCurve([1500, 1300, 1150, 950, 850, 750]);
        setIdleDutyCurve([45, 40, 35, 30, 25, 20]);
        setActiveIdleConfig({
          maxIdleTps: 12,
          idleRpmUpperLimit: 250,
          idleRpmCurve: [1500, 1300, 1150, 950, 850, 750],
          idleDutyCurve: [45, 40, 35, 30, 25, 20]
        });
      }
    } else if (activeTab === 'axes') {
      setRpmRange({ start: 200, end: 7500 });
      setLoadRange({ start: 0, end: 220 });
      // We need to trigger the redistribution manually or via useEffect
      const stepRpm = (7500 - 200) / (fuelTable.rows.length - 1);
      const newRows = Array.from({ length: fuelTable.rows.length }, (_, i) => 200 + i * stepRpm);
      const stepLoad = (220 - 0) / (fuelTable.cols.length - 1);
      const newCols = Array.from({ length: fuelTable.cols.length }, (_, i) => 0 + i * stepLoad);
      
      setFuelTable(prev => ({ ...prev, rows: newRows, cols: newCols }));
      setTimingTable(prev => ({ ...prev, rows: newRows, cols: newCols }));
    }
  };

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showCrosshair, setShowCrosshair] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [selectionStart, setSelectionStart] = useState<{r: number, c: number} | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{r: number, c: number} | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [localValue, setLocalValue] = useState<string>("");

  // Multi-edit popup state
  const [isMultiEditOpen, setIsMultiEditOpen] = useState(false);
  const [multiEditValue, setMultiEditValue] = useState("");
  const multiEditInputRef = useRef<HTMLInputElement>(null);

  const handleMultiEdit = (mode: 'add' | 'sub' | 'set') => {
    const val = parseFloat(multiEditValue);
    if (isNaN(val)) return;

    if (selectionStart && selectionEnd) {
      const newData = [...activeMap.data];
      const rMin = Math.min(selectionStart.r, selectionEnd.r), rMax = Math.max(selectionStart.r, selectionEnd.r);
      const cMin = Math.min(selectionStart.c, selectionEnd.c), cMax = Math.max(selectionStart.c, selectionEnd.c);
      
      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          if (mode === 'add') {
            newData[r][c] = parseFloat((newData[r][c] + val).toFixed(2));
          } else if (mode === 'sub') {
            newData[r][c] = parseFloat((newData[r][c] - val).toFixed(2));
          } else {
            newData[r][c] = val;
          }
        }
      }
      setActiveMap(prev => ({ ...prev, data: newData }));
      // Leave value and popup open so user can press multiple times
    }
  };

  // Global Key Listeners for Table
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Bulk Edit with '=' key globally if selection exists and we are not blocked
      if (e.key === '=' && selectionStart && selectionEnd) {
        const target = e.target as HTMLElement;
        const isCellInput = target.id?.startsWith('cell-');
        
        // Only run global prompt if we aren't in a non-cell input
        if (target.tagName !== 'INPUT' || isCellInput) {
          e.preventDefault();
          setIsMultiEditOpen(true);
          // Focus after animation
          setTimeout(() => multiEditInputRef.current?.focus(), 50);
        }
      }

      if (e.key === 'Escape' && isMultiEditOpen) {
        setIsMultiEditOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionStart, selectionEnd, isMultiEditOpen]);
  
  // Global Mouse Up for Selection
  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const applyIdleSettings = () => {
    setActiveIdleConfig({
      maxIdleTps,
      idleRpmUpperLimit,
      idleRpmCurve: [...idleRpmCurve],
      idleDutyCurve: [...idleDutyCurve]
    });
  };

  const tempLabels = [-4, 32, 68, 104, 140, 176];

  // Limiter Config
  const [revLimit, setRevLimit] = useState(7500);
  const [revHysteresis, setRevHysteresis] = useState(100);
  const [isCurrentlyCutting, setIsCurrentlyCutting] = useState(false);

  // Manual TPS Control
  const [manualTps, setManualTps] = useState(100);

  // Axis Limits
  const [rpmRange, setRpmRange] = useState({ start: 200, end: 7500 });
  const [loadRange, setLoadRange] = useState({ start: 0, end: 220 });

  // Mentor state
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'mentor', text: string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isMentorLoading, setIsMentorLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Initialize with a message
  useEffect(() => {
    setChatMessages([{ role: 'mentor', text: "Engine ready for calibration. Start her up." }]);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isMentorLoading) return;
    
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsMentorLoading(true);

    try {
      const response = await chatWithMentor(userMsg, chatMessages, telemetry, deathReason);
      setChatMessages(prev => [...prev, { role: 'mentor', text: response }]);
    } catch (error) {
      setChatMessages(prev => [...prev, { role: 'mentor', text: "Sorry, I'm having trouble processing that." }]);
    } finally {
      setIsMentorLoading(false);
    }
  };

  // Simulation Loop
  const timerRef = useRef<number | null>(null);

  const updateSimulation = useCallback(() => {
    if (status !== 'ON') return;

    setTelemetry(prev => {
      // Use manual TPS from state or Spacebar override
      let currentTps = isGasPedalDown ? manualTps : 0;

      // Idle Control Logic (Using Active Config)
      const tempIdx = tempLabels.findIndex((t, i) => coolantTemp >= t && (i === tempLabels.length - 1 || coolantTemp < tempLabels[i + 1]));
      const targetIdleRpm = activeIdleConfig.idleRpmCurve[tempIdx === -1 ? 0 : tempIdx];
      const baseIdleDuty = activeIdleConfig.idleDutyCurve[tempIdx === -1 ? 0 : tempIdx];
      
      // Calculate active idle TPS
      const idleTps = (baseIdleDuty / 100) * activeIdleConfig.maxIdleTps;
      
      // Idle disengages if throttle is pressed OR RPM is way above target (Fuel Cut / Decel)
      const isIdleActive = currentTps === 0 && prev.rpm < (targetIdleRpm + activeIdleConfig.idleRpmUpperLimit + 200);
      
      // Idle hunting effect (oscillation within the target + upper limit window)
      const idleOscillation = isIdleActive 
        ? Math.sin(Date.now() / 300) * (activeIdleConfig.idleRpmUpperLimit * 0.4) + (activeIdleConfig.idleRpmUpperLimit * 0.5)
        : 0;

      if (isIdleActive) {
        currentTps = idleTps;
      }

      // Find neighboring indices for bilinear interpolation
      const findNeighbors = (arr: number[], value: number) => {
        let low = -1, high = -1;
        for (let i = 0; i < arr.length - 1; i++) {
          if (value >= arr[i] && value <= arr[i+1]) {
            low = i;
            high = i + 1;
            break;
          }
        }
        if (low === -1) {
          if (value < arr[0]) { low = 0; high = 0; }
          else { low = arr.length - 1; high = arr.length - 1; }
        }
        return { low, high };
      };

      const rpmN = findNeighbors(fuelTable.rows, prev.rpm);
      const loadN = findNeighbors(fuelTable.cols, prev.load);

      // Bi-linear interpolation weights
      const getWeight = (arr: number[], lowIdx: number, highIdx: number, val: number) => {
        if (lowIdx === highIdx) return 1;
        return (val - arr[lowIdx]) / (arr[highIdx] - arr[lowIdx]);
      };

      const wRpm = getWeight(fuelTable.rows, rpmN.low, rpmN.high, prev.rpm);
      const wLoad = getWeight(fuelTable.cols, loadN.low, loadN.high, prev.load);

      // Interpolate values
      const interp = (table: number[][]) => {
        const v00 = table[rpmN.low][loadN.low];
        const v01 = table[rpmN.low][loadN.high];
        const v10 = table[rpmN.high][loadN.low];
        const v11 = table[rpmN.high][loadN.high];

        const top = v00 + wLoad * (v01 - v00);
        const bottom = v10 + wLoad * (v11 - v10);
        return top + wRpm * (bottom - top);
      };

      const targetAfrValue = interp(fuelTable.data);
      const timingDegrees = interp(timingTable.data);

      // AFR physics determined first so it can affect RPM logic
      const currentRevLimit = revLimit;
      const isCutting = prev.rpm >= currentRevLimit;
      let newAfr = targetAfrValue + (Math.random() - 0.5) * 0.2;
      if (isCutting) newAfr = 25.0; 

      // Logic for RPM
      // RPM gain multiplier based on AFR and Timing for "depth" and realism
      // More aggressive shifts: Perfect AFR (12.5) and good timing (25-30) gives max punch
      const afrEfficiency = newAfr >= 12.0 && newAfr <= 13.0 ? 1.2 : (newAfr > 15.5 || newAfr < 10) ? 0.6 : 0.9;
      const timingEfficiency = timingDegrees > 22 && timingDegrees < 34 ? 1.2 : (timingDegrees < 8) ? 0.5 : 1.0;
      
      let targetRpm = isIdleActive ? (targetIdleRpm + idleOscillation) : (currentTps > 0 ? (currentTps / 100 * MAX_RPM) : 0);
      
      if (isCutting) {
        targetRpm = (currentRevLimit - revHysteresis) - 100;
      }

      const rpmDiff = targetRpm - prev.rpm;
      // Acceleration speed is now much more sensitive to tune quality
      const baseResponse = isCutting ? 0.35 : 0.12;
      const responseMultiplier = baseResponse * afrEfficiency * timingEfficiency;
      const newRpm = Math.max(0, prev.rpm + rpmDiff * responseMultiplier);

      // Logic for Load
      const targetLoad = currentTps * 2.2; 
      const manifoldLag = currentTps > prev.load / 2.2 ? 0.18 : 0.22;
      const rpmEfficiencyFactor = 1 - (prev.rpm / MAX_RPM) * 0.1;
      const newLoad = prev.load + (targetLoad * rpmEfficiencyFactor - prev.load) * manifoldLag;

      // Mode Logic: if throttler is equal or less then the MAXIMUM IDLE TPS% (IAC THROW) then its idle
      const rawInputTps = isGasPedalDown ? manualTps : 0;
      const newMode = rawInputTps <= activeIdleConfig.maxIdleTps ? 'IDLE' : 'RUNNING';

      // Temperature Logic - Slowed down significantly
      const rpmHeat = (prev.rpm / MAX_RPM) * 0.04;
      const loadHeat = (newLoad / 220) * 0.08;
      const timingHeat = timingDegrees < 10 ? 0.05 : 0; // Low timing = high EGT
      const ambientCooling = (prev.engineTemp - 80) * 0.005;
      const newTemp = prev.engineTemp + (rpmHeat + loadHeat + timingHeat - ambientCooling);

      // Knock logic
      let newKnock = prev.knockCount;
      const isKnocking = !isCutting && timingDegrees > 28 && newLoad > 140 && newAfr > 13.0;
      if (isKnocking && Math.random() > 0.7) {
        newKnock += 1;
        audioService.playKnock();
      }
      
      // Auto-reset knock when in safe place (Idle/Low load)
      if (newRpm < 1500 && newLoad < 30 && newKnock > 0) {
        newKnock = Math.max(0, newKnock - 0.1);
      }

      // Check Death Conditions
      if (status === 'ON') {
        // Temperature Death
        if (newTemp > 125) {
          setStatus('DEAD');
          setDeathReason("ENGINE SEIZED: Sustained thermal expansion caused catastrophic internal failure.");
          return prev;
        }

        // Timing Death - Advanced (Piston failure)
        if (timingDegrees > 38 && newLoad > 160 && !isCutting) {
          setStatus('DEAD');
          setDeathReason("BOTTOM END FAILURE: Excessive ignition advance at high load physically shattered the piston crowns.");
          return prev;
        }

        // Timing Death - Retarded (EGT/Turbo failure)
        if (timingDegrees < 5 && newLoad > 180 && !isCutting) {
          setStatus('DEAD');
          setDeathReason("TURBO MELTDOWN: Extreme Exhaust Gas Temp (EGT) from retarded timing melted the turbine housing.");
          return prev;
        }

        if (newAfr > 18.0 && !isCutting) {
          setStatus('DEAD');
          setDeathReason(`CRITICAL LEAN DETECTED (${newAfr.toFixed(1)} AFR). Combustion temperature exceeded thermal limits.`);
          return prev;
        }
        if (newAfr < 9.0) {
          setStatus('DEAD');
          setDeathReason(`ENGINE FLOODED (${newAfr.toFixed(1)} AFR). Excessive fuel quenched the spark.`);
          return prev;
        }
      }

      if (newKnock > 150) {
        setStatus('DEAD');
        setDeathReason("CORE FAILURE: Sustained high-intensity detonation shattered connecting rod bearings.");
        return prev;
      }

      return {
        ...prev,
        rpm: newRpm,
        tps: currentTps,
        load: newLoad,
        afr: newAfr,
        mode: newMode,
        knockCount: newKnock,
        timing: timingDegrees,
        revLimit: revLimit,
        engineTemp: newTemp,
        engineStressed: (newAfr > 16 || newAfr < 11) && !isCutting || newKnock > 20 || newTemp > 105
      };
    });
  }, [status, fuelTable, timingTable, revLimit, revHysteresis, manualTps, isGasPedalDown, activeIdleConfig, coolantTemp]);

  useEffect(() => {
    if (status === 'ON') {
      audioService.startEngine();
      timerRef.current = window.setInterval(updateSimulation, TICK_RATE);
    } else {
      audioService.stopEngine();
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status, updateSimulation]);

  // Sync RPM and Limiter sounds
  useEffect(() => {
    if (status === 'ON') {
      const isLimiter = telemetry.rpm >= telemetry.revLimit - 100;
      audioService.updateRPM(telemetry.rpm, telemetry.load, isLimiter);
    }
  }, [telemetry.rpm, telemetry.load, status, telemetry.revLimit]);

  // Spacebar Interaction (Throttle Pedal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger game controls if typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Shortcut for multi-edit
      if (e.key === '=') {
        e.preventDefault();
        multiEditInputRef.current?.focus();
        multiEditInputRef.current?.select();
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (status === 'OFF') startEngine();
        setIsGasPedalDown(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsGasPedalDown(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [status]);

  // Axis Scaling Logic
  const redistributeAxes = (type: 'RPM' | 'Load') => {
    if (type === 'RPM') {
      const step = (rpmRange.end - rpmRange.start) / (fuelTable.rows.length - 1);
      const newRows = Array.from({ length: fuelTable.rows.length }, (_, i) => rpmRange.start + i * step);
      setFuelTable(prev => ({ ...prev, rows: newRows }));
      setTimingTable(prev => ({ ...prev, rows: newRows }));
    } else {
      const step = (loadRange.end - loadRange.start) / (fuelTable.cols.length - 1);
      const newCols = Array.from({ length: fuelTable.cols.length }, (_, i) => loadRange.start + i * step);
      setFuelTable(prev => ({ ...prev, cols: newCols }));
      setTimingTable(prev => ({ ...prev, cols: newCols }));
    }
  };

  // Mentor Update (Proactive)
  useEffect(() => {
    if (status === 'DEAD' || (status === 'ON' && Math.random() > 0.98)) {
      setIsMentorLoading(true);
      getMentorAdvice(telemetry, deathReason).then(msg => {
        setChatMessages(prev => {
          // Avoid duplicate death messages
          if (status === 'DEAD' && prev.some(m => m.text === msg)) return prev;
          return [...prev, { role: 'mentor', text: msg }];
        });
        setIsMentorLoading(false);
      });
    }
  }, [status, deathReason]);

  const startEngine = () => {
    if (status === 'DEAD' || status === 'ON') return;
    setTelemetry(prev => ({ ...prev, rpm: 950 }));
    setStatus('ON');
  };

  const restartEngine = () => {
    setTelemetry({
      rpm: 0,
      tps: 0,
      afr: 14.7,
      load: 0,
      knockCount: 0,
      timing: 15,
      revLimit: revLimit,
      engineStressed: false,
      engineTemp: 85,
      mode: 'IDLE',
    });
    setIsCurrentlyCutting(false);
    setManualTps(100);
    setDeathReason(null);
    setStatus('OFF');
  };

  const stopEngine = () => {
    setStatus('OFF');
    setManualTps(100);
    setTelemetry(prev => ({ ...prev, rpm: 0, tps: 0 }));
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-brand-bg text-text-body">
      {/* Header */}
      <header className="h-[60px] bg-panel-bg border-b border-panel-border flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center gap-6">
          <span className="font-extrabold text-[18px] tracking-tight uppercase">
            SSF TUNING <span className="text-accent italic">SIMULATOR</span>
          </span>
          <button 
            onClick={() => setIsMentorVisible(!isMentorVisible)}
            className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded transition-all ${isMentorVisible ? 'bg-accent text-white' : 'bg-zinc-800 text-zinc-500 hover:text-white'}`}
          >
            {isMentorVisible ? 'Hide Mentor' : 'Show Mentor'}
          </button>
        </div>
        
        <div className="flex items-center gap-5">
          <div className={`status-badge transition-all flex items-center gap-2 ${status === 'ON' ? 'status-active shadow-[0_0_10px_rgba(74,222,128,0.3)]' : status === 'DEAD' ? 'status-dead border-dashed' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
            <span>Engine: {status === 'ON' ? 'Active' : status === 'DEAD' ? 'Critical Failure' : 'Standby'}</span>
            {status === 'ON' && (
              <span className={`px-1.5 py-0.5 rounded text-[8px] font-black tracking-tighter uppercase border ${telemetry.mode === 'IDLE' ? 'border-blue-400/50 text-blue-400 bg-blue-400/10' : 'border-accent/50 text-accent bg-accent/10'}`}>
                {telemetry.mode}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {status === 'ON' ? (
              <button onClick={stopEngine} className="bg-red-600 hover:bg-red-500 text-white px-5 py-2 rounded text-[11px] font-black uppercase tracking-tight transition-all active:scale-95">
                Stop Engine
              </button>
            ) : (
              <button 
                onClick={restartEngine}
                className="btn-primary"
              >
                {status === 'DEAD' ? 'RECOVERY START' : 'IGNITION START'}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={saveCurrentState}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-400 text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 group"
          >
            <Activity className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
            Save Tune Point
          </button>
          <span className="text-text-muted font-mono text-sm tracking-tighter">0x3FF-STABLE</span>
        </div>
      </header>

      {/* Main Grid */}
      <main className={`flex-1 grid transition-all duration-500 gap-5 p-5 overflow-hidden ${isMentorVisible ? 'grid-cols-[260px_1fr_280px]' : 'grid-cols-[0px_1fr_320px]'}`}>
        
        {/* Left Panel: Mentor Chat */}
        <div className={`panel overflow-hidden transition-all duration-500 flex flex-col ${isMentorVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
          <div className="panel-header flex items-center justify-between">
            <span>AI Tuning Mentor</span>
            <div className={`w-2 h-2 rounded-full transition-colors ${isMentorLoading ? 'bg-accent animate-pulse' : 'bg-green-500'}`} />
          </div>
          
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Chat History */}
            <div 
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 scroll-smooth"
            >
              <AnimatePresence initial={false}>
                {chatMessages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div className={`max-w-[90%] px-3 py-2 rounded-lg text-[13px] leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-accent text-white rounded-br-none' 
                        : 'bg-zinc-800 text-zinc-200 rounded-bl-none border border-zinc-700/50'
                    }`}>
                      {msg.text}
                    </div>
                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-tighter">
                      {msg.role === 'user' ? 'Me' : 'Mentor'}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isMentorLoading && (
                <div className="flex gap-1 items-center px-3 py-2 bg-zinc-800/50 rounded-lg w-fit">
                  <div className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce" />
                </div>
              )}
            </div>

            {/* Chat Input */}
            <form 
              onSubmit={handleSendMessage}
              className="p-3 border-t border-panel-border bg-zinc-900/50 flex gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask advice..."
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-[12px] focus:border-accent outline-none transition-colors text-white"
              />
              <button
                type="submit"
                disabled={isMentorLoading || !chatInput.trim()}
                className="w-10 h-10 flex items-center justify-center bg-accent hover:bg-accent/80 disabled:opacity-50 disabled:bg-zinc-800 rounded transition-all active:scale-95 text-white"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Center Panel: Map Core */}
        <div className="panel flex flex-col overflow-hidden">
          <div className="panel-header flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="capitalize">{activeTab}</span>
                <span className="text-[9px] text-text-muted font-bold tracking-widest uppercase">Direct Table Control</span>
              </div>
              <button 
                onClick={resetMap}
                title="Reset Selection/Tab"
                className="p-1.5 rounded-full bg-zinc-800/50 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-500 hover:text-accent transition-all group"
              >
                <RotateCcw className="w-3.5 h-3.5 group-active:rotate-[-180deg] transition-transform duration-500" />
              </button>
            </div>

            {/* Inline Multi-Edit */}
            <div className="flex items-center gap-2 px-2 py-1 bg-zinc-900/50 rounded border border-panel-border ml-4 mr-auto h-7">
              <span className="text-accent font-black text-[12px]">=</span>
              <input 
                type="text"
                value={multiEditValue}
                onChange={e => setMultiEditValue(e.target.value)}
                placeholder="0.0"
                className="w-12 bg-zinc-950 border border-panel-border rounded px-1 py-0.5 text-[10px] font-mono text-center text-white focus:border-accent outline-none"
              />
              <div className="flex gap-1 h-full">
                <button 
                  onClick={() => handleMultiEdit('add')}
                  className="w-5 h-5 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-white font-black rounded border border-panel-border text-[10px] transition-all active:scale-90"
                >
                  +
                </button>
                <button 
                  onClick={() => handleMultiEdit('sub')}
                  className="w-5 h-5 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-white font-black rounded border border-panel-border text-[10px] transition-all active:scale-90"
                >
                  -
                </button>
                <button 
                  onClick={() => handleMultiEdit('set')}
                  className="px-2 h-5 flex items-center justify-center bg-accent/20 hover:bg-accent/40 text-accent font-bold rounded border border-accent/20 text-[8px] transition-all uppercase tracking-tighter active:scale-90"
                >
                  Set
                </button>
              </div>
            </div>

            <div className="flex gap-1">
               <button 
                onClick={() => setActiveTab('timing')}
                className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase transition-all ${activeTab === 'timing' ? 'bg-accent/20 text-accent border-accent/20 shadow-[0_0_8px_rgba(255,107,0,0.1)]' : 'text-text-muted border-transparent hover:text-white'}`}
               >
                 Ignition
               </button>
               <button 
                onClick={() => setActiveTab('fuel')}
                className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase transition-all ${activeTab === 'fuel' ? 'bg-accent/20 text-accent border-accent/20 shadow-[0_0_8px_rgba(255,107,0,0.1)]' : 'text-text-muted border-transparent hover:text-white'}`}
               >
                 Fuel
               </button>
               <button 
                onClick={() => setActiveTab('limiter')}
                className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase transition-all ${activeTab === 'limiter' ? 'bg-accent/20 text-accent border-accent/20 shadow-[0_0_8px_rgba(255,107,0,0.1)]' : 'text-text-muted border-transparent hover:text-white'}`}
               >
                 Limiter
               </button>
               <button 
                onClick={() => setActiveTab('axes')}
                className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase transition-all ${activeTab === 'axes' ? 'bg-accent/20 text-accent border-accent/20 shadow-[0_0_8px_rgba(255,107,0,0.1)]' : 'text-text-muted border-transparent hover:text-white'}`}
               >
                 Axes
               </button>
               <button 
                onClick={() => setActiveTab('idle')}
                className={`text-[9px] px-2 py-0.5 rounded border font-bold uppercase transition-all ${activeTab === 'idle' ? 'bg-accent/20 text-accent border-accent/20 shadow-[0_0_8px_rgba(255,107,0,0.1)]' : 'text-text-muted border-transparent hover:text-white'}`}
               >
                 Idle
               </button>
            </div>
          </div>
          
          <div className="p-4 flex flex-col gap-4 flex-1 overflow-hidden">
            <div className="flex-1 overflow-auto bg-black/10 rounded border border-panel-border">
              {activeTab === 'limiter' ? (
                <div className="h-full flex items-center justify-center p-8 bg-zinc-950/30">
                  <div className="max-w-md w-full grid grid-cols-1 gap-12">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-accent/20 rounded">
                            <Zap className="w-4 h-4 text-accent" />
                          </div>
                          <span className="font-bold text-sm uppercase tracking-widest text-white">RPM Hard Cut</span>
                        </div>
                        <span className="font-mono text-3xl font-black text-accent">{revLimit}</span>
                      </div>
                      <input 
                        type="range" 
                        min="2000" 
                        max="9000" 
                        step="50"
                        value={revLimit}
                        onChange={e => setRevLimit(parseInt(e.target.value))}
                        className="w-full accent-accent h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">
                        <span>2000 RPM</span>
                        <span>9000 RPM</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-indigo-500/20 rounded">
                            <RotateCcw className="w-4 h-4 text-indigo-400" />
                          </div>
                          <span className="font-bold text-sm uppercase tracking-widest text-white">Cut Hysteresis</span>
                        </div>
                        <span className="font-mono text-3xl font-black text-indigo-400">{revHysteresis}</span>
                      </div>
                      <input 
                        type="range" 
                        min="50" 
                        max="1000" 
                        step="10"
                        value={revHysteresis}
                        onChange={e => setRevHysteresis(parseInt(e.target.value))}
                        className="w-full accent-indigo-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">
                        <span>50 RPM (Tight)</span>
                        <span>1000 RPM (Wide)</span>
                      </div>
                    </div>

                    <div className="mt-4 p-4 rounded bg-accent/5 border border-accent/10">
                      <div className="text-[10px] font-black text-accent uppercase tracking-[0.2em] mb-2 text-center underline underline-offset-4">Logic Core Status</div>
                      <p className="text-[11px] text-zinc-400 italic text-center px-4 leading-relaxed">
                        Engine will cut fuel/spark at <span className="text-white font-bold">{revLimit} RPM</span> and return to active combustion at <span className="text-white font-bold">{revLimit - revHysteresis} RPM</span>.
                      </p>
                    </div>
                  </div>
                </div>
              ) : activeTab === 'idle' ? (
                <div className="h-full flex items-center justify-center p-8 bg-zinc-950/30">
                  <div className="max-w-2xl w-full grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="flex flex-col gap-6">
                        <div className="flex flex-col gap-4">
                          <label className="text-[11px] text-text-muted font-black uppercase tracking-widest border-b border-panel-border pb-2">Idle Hardware Config</label>
                          <div className="flex flex-col gap-2">
                             <span className="text-[9px] text-zinc-500 font-bold uppercase">Maximum Idle TPS% (IAC Throw)</span>
                             <input 
                               id="max-idle-tps-input"
                               type="text" 
                               value={focusedId === 'max-idle-tps-input' ? localValue : maxIdleTps} 
                               onFocus={() => { setFocusedId('max-idle-tps-input'); setLocalValue(maxIdleTps.toString()); }}
                               onBlur={() => setFocusedId(null)}
                               onChange={e => {
                                 setLocalValue(e.target.value);
                                 setMaxIdleTps(parseFloat(e.target.value) || 0);
                               }}
                               className="w-full bg-zinc-900 border border-panel-border text-[12px] px-3 py-2 text-white font-mono rounded focus:border-accent outline-none" 
                             />
                             <p className="text-[9px] text-zinc-500 italic">Effective throttle % at 100% duty cycle</p>
                          </div>
                          <div className="flex flex-col gap-2">
                             <span className="text-[9px] text-zinc-500 font-bold uppercase">Idle RPM Upper Limit Offset</span>
                             <input 
                               id="idle-rpm-offset-input"
                               type="text" 
                               value={focusedId === 'idle-rpm-offset-input' ? localValue : idleRpmUpperLimit} 
                               onFocus={() => { setFocusedId('idle-rpm-offset-input'); setLocalValue(idleRpmUpperLimit.toString()); }}
                               onBlur={() => setFocusedId(null)}
                               onChange={e => {
                                 setLocalValue(e.target.value);
                                 setIdleRpmUpperLimit(parseInt(e.target.value) || 0);
                               }}
                               className="w-full bg-zinc-900 border border-panel-border text-[12px] px-3 py-2 text-white font-mono rounded focus:border-accent outline-none" 
                             />
                          </div>
                          
                          <button 
                            onClick={applyIdleSettings}
                            className="w-full mt-2 bg-accent text-white py-3 rounded font-black uppercase tracking-widest hover:bg-orange-500 transition-all shadow-lg shadow-accent/10 active:scale-[0.98]"
                          >
                            Apply Idle Settings
                          </button>
                        </div>
                        
                        <div className="flex flex-col gap-4">
                          <label className="text-[11px] text-text-muted font-black uppercase tracking-widest border-b border-panel-border pb-2">Active Telemetry</label>
                        <div className="grid grid-cols-1 gap-4">
                          <div className="grid grid-cols-3 gap-2">
                            <div className="p-3 bg-black/40 rounded border border-panel-border">
                              <span className="text-[9px] text-zinc-500 uppercase block mb-1">Target RPM</span>
                              <span className="text-lg font-mono font-black text-white">{idleRpmCurve[tempLabels.findIndex((t, i) => coolantTemp >= t && (i === tempLabels.length - 1 || coolantTemp < tempLabels[i + 1]))] || 850}</span>
                            </div>
                            <div className="p-3 bg-black/40 rounded border border-panel-border">
                              <span className="text-[9px] text-accent uppercase block mb-1">Duty %</span>
                              <input 
                                id="telemetry-duty-input"
                                type="text"
                                value={focusedId === 'telemetry-duty-input' ? localValue : idleDutyCurve[tempLabels.findIndex((t, i) => coolantTemp >= t && (i === tempLabels.length - 1 || coolantTemp < tempLabels[i + 1]))]}
                                onFocus={() => {
                                  const idx = tempLabels.findIndex((t, i) => coolantTemp >= t && (i === tempLabels.length - 1 || coolantTemp < tempLabels[i + 1]));
                                  setFocusedId('telemetry-duty-input');
                                  setLocalValue(idleDutyCurve[idx].toString());
                                }}
                                onBlur={() => setFocusedId(null)}
                                onChange={e => {
                                  const text = e.target.value;
                                  setLocalValue(text);
                                  const idx = tempLabels.findIndex((t, i) => coolantTemp >= t && (i === tempLabels.length - 1 || coolantTemp < tempLabels[i + 1]));
                                  const newCurve = [...idleDutyCurve];
                                  newCurve[idx] = text === "" ? 0 : (parseInt(text) || 0);
                                  setIdleDutyCurve(newCurve);
                                }}
                                className="w-full bg-transparent text-lg font-mono font-black text-accent outline-none"
                              />
                            </div>
                            <div className="p-3 bg-black/40 rounded border border-panel-border">
                              <span className="text-[9px] text-blue-400 uppercase block mb-1">Temp °F</span>
                              <input 
                                type="text"
                                value={focusedId === 'telemetry-temp-input' ? localValue : coolantTemp}
                                onFocus={() => { setFocusedId('telemetry-temp-input'); setLocalValue(coolantTemp.toString()); }}
                                onBlur={() => setFocusedId(null)}
                                onChange={e => {
                                  const text = e.target.value;
                                  setLocalValue(text);
                                  setCoolantTemp(text === "" ? 0 : (parseInt(text) || 0));
                                }}
                                className="w-full bg-transparent text-lg font-mono font-black text-blue-400 outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-6">
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] text-text-muted font-black uppercase tracking-widest border-b border-panel-border pb-2">Target Idle RPM vs Temp</label>
                        <div className="grid grid-cols-6 gap-1">
                          {tempLabels.map((t, idx) => (                            <div key={t} className="flex flex-col gap-1">
                              <span className="text-[8px] text-zinc-600 text-center">{t}°</span>
                              <input 
                                id={`idle-rpm-${idx}`}
                                type="text" 
                                value={focusedId === `idle-rpm-${idx}` ? localValue : idleRpmCurve[idx]}
                                onFocus={() => { setFocusedId(`idle-rpm-${idx}`); setLocalValue(idleRpmCurve[idx].toString()); }}
                                onBlur={() => setFocusedId(null)}
                                onChange={e => {
                                  const text = e.target.value;
                                  setLocalValue(text);
                                  const newCurve = [...idleRpmCurve];
                                  newCurve[idx] = text === "" ? 0 : (parseInt(text) || 0);
                                  setIdleRpmCurve(newCurve);
                                }}
                                className="w-full bg-zinc-900 border border-panel-border text-[10px] p-1 text-white font-mono text-center rounded"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                             <div className="flex flex-col gap-2">
                               <label className="text-[11px] text-text-muted font-black uppercase tracking-widest border-b border-panel-border pb-2">Idle Duty vs Temp (%)</label>
                               <div className="grid grid-cols-6 gap-1">
                                 {tempLabels.map((t, idx) => (
                                   <div key={t} className="flex flex-col gap-1">
                                     <span className="text-[8px] text-zinc-600 text-center">{t}°</span>
                                     <input 
                                       id={`idle-duty-${idx}`}
                                       type="text" 
                                       value={focusedId === `idle-duty-${idx}` ? localValue : idleDutyCurve[idx]}
                                       onFocus={() => { setFocusedId(`idle-duty-${idx}`); setLocalValue(idleDutyCurve[idx].toString()); }}
                                       onBlur={() => setFocusedId(null)}
                                       onChange={e => {
                                         const text = e.target.value;
                                         setLocalValue(text);
                                         const newCurve = [...idleDutyCurve];
                                         newCurve[idx] = text === "" ? 0 : (parseInt(text) || 0);
                                         setIdleDutyCurve(newCurve);
                                       }}
                                       className="w-full bg-zinc-900 border border-panel-border text-[10px] p-1 text-white font-mono text-center rounded"
                                     />
                                   </div>
                                 ))}
                               </div>
                             </div>
                           </div>
                    </div>
                  </div>
              ) : activeTab === 'axes' ? (
                <div className="h-full flex items-center justify-center p-8 bg-zinc-950/30">
                  <div className="max-w-md w-full grid grid-cols-1 gap-12">
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-col gap-4">
                        <label className="text-[11px] text-text-muted font-black uppercase tracking-widest border-b border-panel-border pb-2 flex justify-between">
                          RPM Axis Scaling
                          <span className="text-accent">Horizontal Resolution</span>
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-2">
                             <span className="text-[9px] text-zinc-500 font-bold uppercase">Target Start</span>
                             <input 
                               id="rpm-range-start-input"
                               type="text" 
                               value={focusedId === 'rpm-range-start-input' ? localValue : rpmRange.start} 
                               onFocus={() => { setFocusedId('rpm-range-start-input'); setLocalValue(rpmRange.start.toString()); }}
                               onBlur={() => setFocusedId(null)}
                               onChange={e => {
                                 const val = e.target.value;
                                 setLocalValue(val);
                                 setRpmRange(prev => ({...prev, start: parseInt(val) || 0}));
                               }}
                               className="w-full bg-zinc-900 border border-panel-border text-[12px] px-3 py-2 text-white font-mono rounded" 
                             />
                          </div>
                          <div className="flex flex-col gap-2">
                             <span className="text-[9px] text-zinc-500 font-bold uppercase">Target End</span>
                             <input 
                               id="rpm-range-end-input"
                               type="text" 
                               value={focusedId === 'rpm-range-end-input' ? localValue : rpmRange.end} 
                               onFocus={() => { setFocusedId('rpm-range-end-input'); setLocalValue(rpmRange.end.toString()); }}
                               onBlur={() => setFocusedId(null)}
                               onChange={e => {
                                 const val = e.target.value;
                                 setLocalValue(val);
                                 setRpmRange(prev => ({...prev, end: parseInt(val) || 0}));
                               }}
                               className="w-full bg-zinc-900 border border-panel-border text-[12px] px-3 py-2 text-white font-mono rounded" 
                             />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4">
                        <label className="text-[11px] text-text-muted font-black uppercase tracking-widest border-b border-panel-border pb-2 flex justify-between">
                          Load Axis Scaling
                          <span className="text-accent">Vertical Resolution</span>
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex flex-col gap-2">
                             <span className="text-[9px] text-zinc-500 font-bold uppercase">Target Min %</span>
                             <input 
                               id="load-range-start-input"
                               type="text" 
                               value={focusedId === 'load-range-start-input' ? localValue : loadRange.start} 
                               onFocus={() => { setFocusedId('load-range-start-input'); setLocalValue(loadRange.start.toString()); }}
                               onBlur={() => setFocusedId(null)}
                               onChange={e => {
                                 const val = e.target.value;
                                 setLocalValue(val);
                                 setLoadRange(prev => ({...prev, start: parseInt(val) || 0}));
                               }}
                               className="w-full bg-zinc-900 border border-panel-border text-[12px] px-3 py-2 text-white font-mono rounded" 
                             />
                          </div>
                          <div className="flex flex-col gap-2">
                             <span className="text-[9px] text-zinc-500 font-bold uppercase">Target Max %</span>
                             <input 
                               id="load-range-end-input"
                               type="text" 
                               value={focusedId === 'load-range-end-input' ? localValue : loadRange.end} 
                               onFocus={() => { setFocusedId('load-range-end-input'); setLocalValue(loadRange.end.toString()); }}
                               onBlur={() => setFocusedId(null)}
                               onChange={e => {
                                 const val = e.target.value;
                                 setLocalValue(val);
                                 setLoadRange(prev => ({...prev, end: parseInt(val) || 0}));
                               }}
                               className="w-full bg-zinc-900 border border-panel-border text-[12px] px-3 py-2 text-white font-mono rounded" 
                             />
                          </div>
                        </div>
                      </div>

                      <button 
                        onClick={() => { redistributeAxes('RPM'); redistributeAxes('Load'); }}
                        className="w-full bg-accent text-white py-4 rounded font-black uppercase tracking-widest hover:bg-red-500 transition-colors shadow-lg shadow-accent/20"
                      >
                        Redistribute All Core Tables
                      </button>
                    </div>

                    <div className="p-4 rounded bg-blue-500/5 border border-blue-500/10 text-center">
                      <p className="text-[10px] text-zinc-400 leading-relaxed tabular-nums">
                        WARNING: Redistributing axes will linearly interpolate row/column headers. Table data remains static; verify map accuracy after shift.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div 
                  ref={tableContainerRef}
                  className="relative h-full overflow-auto cursor-none select-none"
                  onMouseEnter={() => setShowCrosshair(true)}
                  onMouseLeave={() => setShowCrosshair(false)}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }}
                >
                  {showCrosshair && (
                    <div 
                      className="absolute pointer-events-none z-[100] mix-blend-difference"
                      style={{ 
                        left: mousePos.x, 
                        top: mousePos.y,
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      <div className="w-[1px] h-2.5 bg-white" />
                      <div className="h-[1px] w-2.5 bg-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                  )}

                  <table 
                    className="tune-table group/table"
                    onMouseUp={() => setIsSelecting(false)}
                  >
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="w-16 relative group/reset">
                        RPM \ Load
                        <button 
                          onClick={resetMap}
                          className="absolute -top-1 -left-1 opacity-0 group-hover/reset:opacity-100 p-0.5 bg-accent text-white rounded-full transition-opacity z-50"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                        </button>
                      </th>
                      {activeMap.cols.map((col, i) => (
                        <th key={i}>{col.toFixed(0)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const activeRpmIdx = activeMap.rows.findIndex((r, i) => 
                        telemetry.rpm >= r && (telemetry.rpm < activeMap.rows[i + 1] || i === activeMap.rows.length - 1)
                      );
                      const activeLoadIdx = activeMap.cols.findIndex((c, i) => 
                        telemetry.load >= c && (telemetry.load < activeMap.cols[i + 1] || i === activeMap.cols.length - 1)
                      );

                      return activeMap.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          <th className="bg-panel-header text-[10px] py-1 border border-panel-border">{row.toFixed(0)}</th>
                          {activeMap.cols.map((_, cIdx) => {
                            const val = activeMap.data[rIdx][cIdx];
                            
                            const isInNeighborhood = (
                              (rIdx === activeRpmIdx || rIdx === activeRpmIdx + 1) &&
                              (cIdx === activeLoadIdx || cIdx === activeLoadIdx + 1)
                            );
  
                            const isMainCell = activeRpmIdx === rIdx && activeLoadIdx === cIdx;
                            const mainCellFlash = isMainCell ? (0.15 + Math.sin(Date.now() / 10) * 0.1) : 0;
                            
                            // Ultra-Tight High-Speed Circular Orbit Tracer
                            const orbitRadius = 0.8; 
                            const orbitSpeed = 0.045; 
                            const angle = Date.now() * orbitSpeed;
                            
                            const offR = Math.round(Math.sin(angle) * orbitRadius);
                            const offC = Math.round(Math.cos(angle) * orbitRadius);
                            const isCurrentlyFlashing = (rIdx === activeRpmIdx + offR) && (cIdx === activeLoadIdx + offC);

                            const jitterX = isCurrentlyFlashing ? Math.sin(Date.now() / 15) * 4 : 0;
                            const jitterY = isCurrentlyFlashing ? Math.cos(Date.now() / 12) * 4 : 0;
  
                            const isSelected = selectionStart && selectionEnd && (
                              rIdx >= Math.min(selectionStart.r, selectionEnd.r) && rIdx <= Math.max(selectionStart.r, selectionEnd.r) &&
                              cIdx >= Math.min(selectionStart.c, selectionEnd.c) && cIdx <= Math.max(selectionStart.c, selectionEnd.c)
                            );
  
                            return (
                              <td 
                                key={cIdx} 
                                onMouseDown={(e) => {
                                  const isCellSelected = selectionStart && selectionEnd && 
                                    rIdx >= Math.min(selectionStart.r, selectionEnd.r) && rIdx <= Math.max(selectionStart.r, selectionEnd.r) &&
                                    cIdx >= Math.min(selectionStart.c, selectionEnd.c) && cIdx <= Math.max(selectionStart.c, selectionEnd.c);

                                  if (!isCellSelected) {
                                    setSelectionStart({ r: rIdx, c: cIdx });
                                    setSelectionEnd({ r: rIdx, c: cIdx });
                                  }
                                  setIsSelecting(true);
                                }}
                                onMouseEnter={() => {
                                  if (isSelecting) setSelectionEnd({ r: rIdx, c: cIdx });
                                }}
                                style={{
                                  backgroundColor: isCurrentlyFlashing ? 'rgba(255, 255, 255, 0.4)' :
                                                   isSelected ? 'rgba(255, 255, 255, 0.15)' :
                                                   isMainCell ? `rgba(255, 255, 255, ${mainCellFlash})` : 'transparent',
                                  transform: isCurrentlyFlashing ? `translate(${jitterX}px, ${jitterY}px)` : 'none',
                                  boxShadow: isCurrentlyFlashing ? '0 0 15px rgba(255, 255, 255, 0.3)' : 
                                             isMainCell ? `0 0 10px rgba(255, 255, 255, ${mainCellFlash * 0.5})` : 'none',
                                  zIndex: isCurrentlyFlashing ? 50 : 10
                                }}
                                className={`p-0 relative transition-all duration-[20ms] overflow-hidden ${isSelected ? 'outline outline-1 outline-accent/40 -outline-offset-1' : ''}`}
                              >
                                {isMainCell && (
                                  <div className="absolute inset-0 border border-white/20 pointer-events-none z-10" />
                                )}
                                
                                <div className="absolute inset-0 pointer-events-none group-hover/table:opacity-100 opacity-0 flex items-center justify-center">
                                  <div className="w-[1px] h-3 bg-white/10" />
                                  <div className="h-[1px] w-3 bg-white/10 absolute" />
                                </div>
                                <input 
                                  id={`cell-${rIdx}-${cIdx}`}
                                  type="text"
                                  value={focusedId === `cell-${rIdx}-${cIdx}` ? localValue : val}
                                  onFocus={() => { setFocusedId(`cell-${rIdx}-${cIdx}`); setLocalValue(val.toString()); }}
                                  onBlur={() => setFocusedId(null)}
                                  readOnly={status === 'OFF' ? false : status === 'DEAD'}
                                  onKeyDown={(e) => {
                                    if (e.key === 'ArrowUp') {
                                      e.preventDefault();
                                      const next = document.getElementById(`cell-${rIdx - 1}-${cIdx}`);
                                      if (next) (next as HTMLInputElement).focus();
                                    } else if (e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      const next = document.getElementById(`cell-${rIdx + 1}-${cIdx}`);
                                      if (next) (next as HTMLInputElement).focus();
                                    } else if (e.key === 'ArrowLeft') {
                                      e.preventDefault();
                                      const next = document.getElementById(`cell-${rIdx}-${cIdx - 1}`);
                                      if (next) (next as HTMLInputElement).focus();
                                    } else if (e.key === 'ArrowRight') {
                                      e.preventDefault();
                                      const next = document.getElementById(`cell-${rIdx}-${cIdx + 1}`);
                                      if (next) (next as HTMLInputElement).focus();
                                    }
                                    
                                    if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                                      e.preventDefault();
                                      const diff = e.key === 'ArrowUp' ? 1 : -1;
                                      const newData = [...activeMap.data];
                                      if (selectionStart && selectionEnd) {
                                        const rMin = Math.min(selectionStart.r, selectionEnd.r), rMax = Math.max(selectionStart.r, selectionEnd.r);
                                        const cMin = Math.min(selectionStart.c, selectionEnd.c), cMax = Math.max(selectionStart.c, selectionEnd.c);
                                        for (let r = rMin; r <= rMax; r++) {
                                          for (let c = cMin; c <= cMax; c++) {
                                            newData[r][c] = parseFloat((newData[r][c] + diff).toFixed(2));
                                          }
                                        }
                                      } else {
                                        newData[rIdx][cIdx] = parseFloat((newData[rIdx][cIdx] + diff).toFixed(2));
                                      }
                                      setActiveMap(prev => ({ ...prev, data: newData }));
                                    }
                                  }}
                                  onChange={e => {
                                    const text = e.target.value;
                                    setLocalValue(text);
                                    const newVal = text === "" ? 0 : (parseFloat(text) || 0);
                                    const newData = [...activeMap.data];
                                    newData[rIdx][cIdx] = newVal;
                                    setActiveMap(prev => ({ ...prev, data: newData }));
                                  }}
                                  style={{
                                    color: isCurrentlyFlashing ? 'white' : isMainCell ? 'white' : isInNeighborhood ? 'rgba(255,255,255,0.2)' : '',
                                    textShadow: isCurrentlyFlashing ? '0 0 10px rgba(255, 255, 255, 1)' : 'none',
                                    fontSize: isCurrentlyFlashing ? '10px' : '9px'
                                  }}
                                  className={`w-full bg-transparent py-1 text-center font-mono focus:outline-none focus:bg-white/5 border border-transparent focus:border-accent/40 transition-all ${isCurrentlyFlashing ? 'font-black scale-110' : 'text-zinc-500'}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

        {/* Right Panel: Telemetry */}
        <div className="panel flex flex-col overflow-hidden">
          <div className="panel-header">Live Telemetry Diagnostics</div>
          <div className="flex flex-col flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-4 p-4">
              <div className="gauge-ring">
                <div className="text-[20px] font-bold font-mono tracking-tighter">{telemetry.rpm.toFixed(0)}</div>
                <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest">RPM</div>
              </div>
              <div className="gauge-ring">
                <div className={`text-[20px] font-bold font-mono tracking-tighter ${telemetry.afr > 16 || telemetry.afr < 11 ? 'text-dead-red' : 'text-text-body'}`}>
                  {telemetry.afr.toFixed(1)}
                </div>
                <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest">AFR</div>
              </div>
              <div className="gauge-ring">
                <div className="text-[20px] font-bold font-mono tracking-tighter">{telemetry.load.toFixed(0)}%</div>
                <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest">LOAD</div>
              </div>
              <div className="gauge-ring">
                <div className="text-[20px] font-bold font-mono tracking-tighter">{telemetry.tps.toFixed(1)}%</div>
                <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest">TPS</div>
              </div>
              <div className="gauge-ring">
                <div className="text-[20px] font-bold font-mono tracking-tighter">{telemetry.timing.toFixed(1)}°</div>
                <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest">IGN</div>
              </div>
              <div className="gauge-ring bg-accent/5">
                <div className={`text-[20px] font-bold font-mono tracking-tighter ${telemetry.engineTemp > 105 ? 'text-dead-red' : 'text-blue-400'}`}>
                  {telemetry.engineTemp.toFixed(1)}°C
                </div>
                <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest">TEMP</div>
              </div>
              <div className="gauge-ring bg-red-400/5">
                <div className={`text-[20px] font-bold font-mono tracking-tighter ${telemetry.knockCount > 10 ? 'text-dead-red' : 'text-text-body'}`}>
                  {telemetry.knockCount.toFixed(0)}
                </div>
                <div className="text-[9px] text-text-muted font-bold uppercase tracking-widest">KNOCK</div>
              </div>
            </div>

            <div className="p-4 border-t border-panel-border">
              <div className="text-[10px] text-text-muted font-bold uppercase mb-3">Injector Duty Cycle</div>
              <div className="w-full h-2.5 bg-panel-border rounded-sm overflow-hidden relative border border-panel-border">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (telemetry.load * 0.8) + 5)}%` }}
                  className={`h-full transition-colors ${telemetry.load > 85 ? 'bg-dead-red' : 'bg-accent'}`}
                />
              </div>
              <div className="flex justify-between mt-2 font-mono text-[12px] font-bold">
                <span className="text-accent">{Math.min(100, (telemetry.load * 0.8) + 5).toFixed(1)}%</span>
                <span className="text-text-muted">PEAK: 92%</span>
              </div>
            </div>

            <div className="p-4 mt-auto border-t border-panel-border bg-black/10">
               <div className="flex items-start gap-3">
                  <div className="p-2 bg-accent/10 rounded flex items-center justify-center">
                    <Activity className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <div className="text-[10px] text-text-muted font-bold uppercase tracking-widest">System Health</div>
                    <div className={`text-[12px] font-bold uppercase ${telemetry.engineStressed ? 'text-dead-red' : 'text-active-green'}`}>
                      {status === 'DEAD' ? 'CORE SHUTDOWN' : telemetry.engineStressed ? 'STRESS WARNING' : 'NOMINAL RANGE'}
                    </div>
                  </div>
               </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer / Pedal Area */}
      <footer className="h-[100px] bg-panel-bg border-t border-panel-border flex items-center px-6 gap-10 shrink-0">
        <div className="flex items-center gap-6 flex-1 max-w-2xl">
          <div className="flex flex-col items-center">
            <div id="gas-pedal" className={`pedal ${isGasPedalDown ? 'pedal-active' : ''}`} />
            <div className="text-[9px] text-text-muted font-extrabold uppercase mt-1 tracking-widest whitespace-nowrap">Pedal Interface</div>
          </div>
          
          <div className="flex flex-col gap-2 flex-1">
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-text-muted font-black uppercase tracking-[0.2em]">Throttle Stop / Target TPS</div>
              <div className="flex items-baseline gap-2">
                <span className="text-[20px] font-black font-mono text-accent">{manualTps.toFixed(0)}</span>
                <span className="text-[10px] text-zinc-500 font-bold uppercase">%</span>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="relative flex-1 group flex flex-col gap-1">
                <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${telemetry.tps}%` }}
                    className="h-full bg-accent shadow-[0_0_10px_rgba(255,107,0,0.5)]"
                  />
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  step="1"
                  value={manualTps}
                  onChange={e => setManualTps(parseInt(e.target.value))}
                  onMouseDown={() => { if(status === 'OFF') startEngine(); }}
                  className="w-full h-4 bg-transparent appearance-none cursor-pointer accent-accent"
                />
              </div>
              <button 
                onClick={() => setManualTps(0)}
                className="text-[9px] font-black uppercase text-zinc-500 hover:text-white border border-zinc-800 px-3 py-2 rounded bg-black/20 hover:bg-black/40 transition-all"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1 items-end min-w-[240px]">
          <div className="text-[10px] text-text-muted font-extrabold uppercase tracking-widest">Active Control Mode</div>
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1.5 rounded border text-[11px] font-mono font-bold uppercase transition-all ${isGasPedalDown ? 'bg-accent/20 border-accent text-accent' : 'bg-panel-border border-input-border text-zinc-500'}`}>
              SPACE: {isGasPedalDown ? 'APPLYING' : 'READY'}
            </div>
            <span className="text-[12px] text-zinc-500 font-medium">Space = {manualTps}% Throttle</span>
          </div>
        </div>
      </footer>

      {/* Global Overlays */}
      <AnimatePresence>
        {isMultiEditOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <div className="bg-panel-bg border border-accent/30 rounded-lg p-6 shadow-2xl w-full max-w-[320px] flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-widest text-accent">Multi-Cell Edit</span>
                <button 
                  onClick={() => setIsMultiEditOpen(false)}
                  className="text-zinc-500 hover:text-white"
                >
                  <RotateCcw className="w-4 h-4 rotate-45" />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                <input 
                  ref={multiEditInputRef}
                  type="text"
                  value={multiEditValue}
                  onChange={e => setMultiEditValue(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-zinc-900 border border-panel-border rounded px-4 py-3 text-2xl font-mono font-black text-center text-white focus:border-accent outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleMultiEdit('set');
                  }}
                />

                <div className="flex gap-2">
                  <button 
                    onClick={() => handleMultiEdit('add')}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-black py-3 rounded border border-panel-border transition-all active:scale-95"
                  >
                    +
                  </button>
                  <button 
                    onClick={() => handleMultiEdit('sub')}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-black py-3 rounded border border-panel-border transition-all active:scale-95"
                  >
                    -
                  </button>
                  <button 
                    onClick={() => handleMultiEdit('set')}
                    className="flex-[2] bg-accent hover:bg-orange-500 text-white font-black py-3 rounded transition-all active:scale-95 uppercase text-[11px] tracking-widest"
                  >
                    Set
                  </button>
                </div>
              </div>

              <div className="text-[9px] text-zinc-500 text-center uppercase tracking-tighter">
                Applies to all selected cells
              </div>
            </div>
          </motion.div>
        )}

        {status === 'DEAD' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-red-950/20 backdrop-blur-sm z-[100] flex items-center justify-center p-6"
          >
            <div className="max-w-md w-full bg-panel-bg border border-dead-red rounded-xl p-8 shadow-2xl flex flex-col gap-6 text-center">
              <div className="mx-auto p-4 bg-dead-red rounded-full">
                <AlertTriangle className="w-10 h-10 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-dead-red uppercase tracking-tight mb-2">CRITICAL ENGINE FAILURE</h2>
                <p className="text-zinc-400 font-medium leading-relaxed italic">"{deathReason}"</p>
              </div>
              <button 
                onClick={restartEngine}
                className="bg-dead-red hover:bg-red-500 text-white font-black py-4 rounded-lg uppercase tracking-widest shadow-lg shadow-red-900/40"
              >
                Reset Core Simulation
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
