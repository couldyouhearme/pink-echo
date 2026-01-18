
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ConnectionStatus, TranscriptionItem } from './types';
import { decode, decodeAudioData, createPcmBlob } from './utils/audio-utils';
import { MountainScene } from './components/MountainScene';
import { Visualizer } from './components/Visualizer';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [history, setHistory] = useState<TranscriptionItem[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [echoIntensity, setEchoIntensity] = useState(40); // 0 to 100

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Echo effect nodes
  const delayNodeRef = useRef<DelayNode | null>(null);
  const feedbackGainRef = useRef<GainNode | null>(null);
  const wetGainRef = useRef<GainNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);

  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    sourcesRef.current.forEach(source => {
        try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();
    setStatus(ConnectionStatus.IDLE);
    setIsSpeaking(false);
    setIsUserTalking(false);
  }, []);

  // Update audio nodes when intensity changes for a natural vast echo
  useEffect(() => {
    const outCtx = outputAudioContextRef.current;
    if (outCtx && delayNodeRef.current && feedbackGainRef.current && wetGainRef.current && filterNodeRef.current) {
      const t = outCtx.currentTime;
      const intensity = echoIntensity / 100;

      // Delay Time: 0.2s (near) to 1.2s (vast valley)
      const targetDelay = 0.2 + (intensity * 1.0);
      delayNodeRef.current.delayTime.setTargetAtTime(targetDelay, t, 0.2);

      // Feedback: 0.0 to 0.75 (high feedback creates multiple bounces)
      const targetFeedback = intensity * 0.75;
      feedbackGainRef.current.gain.setTargetAtTime(targetFeedback, t, 0.2);

      // Wet Gain: 0 to 0.9 (how loud the echo is compared to direct sound)
      const targetWet = intensity * 0.9;
      wetGainRef.current.gain.setTargetAtTime(targetWet, t, 0.2);

      // Low-pass Filter: Higher intensity means further mountains, which absorb high frequencies.
      // 100% intensity -> 800Hz (muffled, distant)
      // 0% intensity -> 15000Hz (crisp, near)
      const targetFreq = 15000 - (intensity * 14200);
      filterNodeRef.current.frequency.setTargetAtTime(targetFreq, t, 0.2);
    }
  }, [echoIntensity]);

  const startSession = async () => {
    try {
      setStatus(ConnectionStatus.CONNECTING);
      setErrorMessage(null);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAudioContextRef.current = outCtx;

      // Setup Advanced Echo Graph
      // Source -> WetGain -> DelayNode -> FilterNode -> FeedbackGain -> DelayNode
      // Source -> outCtx.destination (Dry)
      // DelayNode -> outCtx.destination (Echo Output)
      
      const wetGain = outCtx.createGain();
      const delayNode = outCtx.createDelay(2.0); // Max 2 seconds
      const feedbackGain = outCtx.createGain();
      const filterNode = outCtx.createBiquadFilter();
      
      filterNode.type = 'lowpass';
      filterNode.Q.value = 1;

      delayNodeRef.current = delayNode;
      feedbackGainRef.current = feedbackGain;
      wetGainRef.current = wetGain;
      filterNodeRef.current = filterNode;

      // Initial values based on current echoIntensity state
      const intensity = echoIntensity / 100;
      feedbackGain.gain.value = intensity * 0.75;
      wetGain.gain.value = intensity * 0.9;
      delayNode.delayTime.value = 0.2 + (intensity * 1.0);
      filterNode.frequency.value = 15000 - (intensity * 14200);

      // Wiring the feedback loop: Delay -> Filter -> Feedback -> Delay
      wetGain.connect(delayNode);
      delayNode.connect(filterNode);
      filterNode.connect(feedbackGain);
      feedbackGain.connect(delayNode);
      
      // Output: The wet signal comes from the delay node
      delayNode.connect(outCtx.destination);
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const volume = inputData.reduce((a, b) => a + Math.abs(b), 0) / inputData.length;
              setIsUserTalking(volume > 0.01);

              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              const outCtx = outputAudioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = audioBuffer;
              
              // Direct "Dry" output
              source.connect(outCtx.destination);
              // "Wet" output through the echo network
              source.connect(wetGainRef.current!);
              
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) {
                  setIsSpeaking(false);
                }
              });

              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = currentInputTranscription.current;
              const modelText = currentOutputTranscription.current;

              if (userText || modelText) {
                setHistory(prev => [
                  ...prev,
                  ...(userText ? [{ text: userText, type: 'user' as const, timestamp: Date.now() }] : []),
                  ...(modelText ? [{ text: modelText, type: 'model' as const, timestamp: Date.now() }] : [])
                ].slice(-10));
              }

              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => {
                  try { s.stop(); } catch(e) {}
              });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (e) => {
            console.error('Gemini Live Error:', e);
            setErrorMessage('The mountain fog is too thick. Reconnecting...');
            stopSession();
          },
          onclose: () => {
            setStatus(ConnectionStatus.IDLE);
            stopSession();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are an echo in a mystical, vast mountain range. Your primary function is to ECHO what the user says exactly. 
          Current Echo Intensity: ${echoIntensity}%. 
          When intensity is high (>70%), you are a distant peak, your voice might sound slightly more ethereal or resonant. When low, you are a nearby canyon wall.
          90% of your response should be a literal echo. Keep it concise, atmospheric, and resonant.`
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to start session. Check microphone permissions.');
      setStatus(ConnectionStatus.ERROR);
    }
  };

  useEffect(() => {
    return () => stopSession();
  }, [stopSession]);

  return (
    <div className="relative h-screen w-screen flex flex-col items-center justify-center text-white overflow-hidden">
      <MountainScene />

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-2xl px-6 py-8 text-center space-y-6">
        <header className="space-y-1">
          <h1 className="text-4xl md:text-5xl font-black font-display tracking-tight text-white drop-shadow-lg">
            MOUNTAIN <span className="text-cyan-400">ECHO</span>
          </h1>
          <p className="text-slate-400 font-light text-sm uppercase tracking-widest">
            Acoustic Landscape
          </p>
        </header>

        {/* Status Area */}
        <div className="w-full flex flex-col items-center space-y-2">
          <Visualizer isSpeaking={isSpeaking || isUserTalking} isModelThinking={status === ConnectionStatus.CONNECTING} />
          
          <div className="px-4 py-1 rounded-full bg-slate-900/60 backdrop-blur-md border border-white/5 text-xs font-semibold tracking-wide text-cyan-100 uppercase min-w-[140px]">
            {status === ConnectionStatus.IDLE && "Ready to start"}
            {status === ConnectionStatus.CONNECTING && "Scaling the peaks..."}
            {status === ConnectionStatus.CONNECTED && (isSpeaking ? "Resonating..." : isUserTalking ? "Capturing..." : "Silent air")}
            {status === ConnectionStatus.ERROR && <span className="text-red-400">{errorMessage}</span>}
          </div>
        </div>

        {/* Control Panel */}
        <div className="w-full max-w-sm bg-slate-900/40 backdrop-blur-lg rounded-2xl p-6 border border-white/10 shadow-xl space-y-6">
          {/* Echo Intensity Slider */}
          <div className="space-y-4">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <span>Canyon Wall</span>
              <span className="text-cyan-400 px-2 py-0.5 bg-cyan-950/50 rounded border border-cyan-500/30">
                Resonance: {echoIntensity}%
              </span>
              <span>Vast Valley</span>
            </div>
            <div className="relative flex items-center group">
              <input
                type="range"
                min="0"
                max="100"
                value={echoIntensity}
                onChange={(e) => setEchoIntensity(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all"
              />
              <div 
                className="absolute h-1.5 bg-cyan-500/30 rounded-lg pointer-events-none transition-all duration-300 group-hover:bg-cyan-500/50" 
                style={{ width: `${echoIntensity}%` }}
              />
            </div>
          </div>

          {/* Action Button */}
          <div className="flex justify-center">
            <button
              onClick={status === ConnectionStatus.CONNECTED ? stopSession : startSession}
              disabled={status === ConnectionStatus.CONNECTING}
              className={`group relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-500 shadow-2xl active:scale-90 ${
                status === ConnectionStatus.CONNECTED 
                  ? 'bg-rose-500 hover:bg-rose-600 ring-4 ring-rose-500/20 shadow-rose-500/40' 
                  : 'bg-cyan-500 hover:bg-cyan-400 ring-4 ring-cyan-500/20 shadow-cyan-500/40'
              }`}
            >
              <div className="absolute inset-0 rounded-full animate-ping bg-current opacity-10 pointer-events-none group-hover:animate-none" />
              {status === ConnectionStatus.CONNECTED ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Conversation Snippets */}
        <div className="w-full h-24 flex flex-col items-center justify-center space-y-2 overflow-hidden px-4">
          {history.length > 0 ? (
            history.slice(-3).map((item, i) => (
              <div
                key={i}
                className={`text-sm transition-all duration-700 animate-in fade-in slide-in-from-bottom-1 ${
                  item.type === 'user' ? 'text-slate-500 italic' : 'text-cyan-300 font-medium'
                }`}
              >
                {item.type === 'user' ? '“' : '— '}{item.text}{item.type === 'user' ? '”' : ''}
              </div>
            ))
          ) : (
             status === ConnectionStatus.CONNECTED && (
               <p className="text-slate-500 animate-pulse text-xs tracking-widest uppercase">The mountains are listening...</p>
             )
          )}
        </div>
      </div>

      {/* Decorative Gradients */}
      <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
      <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-slate-950 to-transparent opacity-80 pointer-events-none" />
    </div>
  );
};

export default App;
