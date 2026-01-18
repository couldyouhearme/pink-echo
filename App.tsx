
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
  const [echoIntensity, setEchoIntensity] = useState(60);

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

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

  useEffect(() => {
    const outCtx = outputAudioContextRef.current;
    if (outCtx && delayNodeRef.current && feedbackGainRef.current && wetGainRef.current && filterNodeRef.current) {
      const t = outCtx.currentTime;
      const intensity = echoIntensity / 100;
      const targetDelay = 0.15 + (intensity * 1.35);
      delayNodeRef.current.delayTime.setTargetAtTime(targetDelay, t, 0.2);
      const targetFeedback = intensity * 0.88;
      feedbackGainRef.current.gain.setTargetAtTime(targetFeedback, t, 0.2);
      const targetWet = intensity * 1.2;
      wetGainRef.current.gain.setTargetAtTime(targetWet, t, 0.2);
      const targetFreq = 18000 - (intensity * 17200);
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

      const wetGain = outCtx.createGain();
      const delayNode = outCtx.createDelay(3.0);
      const feedbackGain = outCtx.createGain();
      const filterNode = outCtx.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.Q.value = 1.5;

      delayNodeRef.current = delayNode;
      feedbackGainRef.current = feedbackGain;
      wetGainRef.current = wetGain;
      filterNodeRef.current = filterNode;

      const intensity = echoIntensity / 100;
      feedbackGain.gain.value = intensity * 0.88;
      wetGain.gain.value = intensity * 1.2;
      delayNode.delayTime.value = 0.15 + (intensity * 1.35);
      filterNode.frequency.value = 18000 - (intensity * 17200);

      wetGain.connect(delayNode);
      delayNode.connect(filterNode);
      filterNode.connect(feedbackGain);
      feedbackGain.connect(delayNode);
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
              setIsUserTalking(volume > 0.015);
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
              source.connect(outCtx.destination);
              source.connect(wetGainRef.current!);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }
            if (message.serverContent?.inputTranscription) currentInputTranscription.current += message.serverContent.inputTranscription.text;
            if (message.serverContent?.outputTranscription) currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            if (message.serverContent?.turnComplete) {
              const u = currentInputTranscription.current;
              const m = currentOutputTranscription.current;
              if (u || m) {
                setHistory(prev => [...prev, ...(u ? [{ text: u, type: 'user' as const, timestamp: Date.now() }] : []), ...(m ? [{ text: m, type: 'model' as const, timestamp: Date.now() }] : [])].slice(-10));
              }
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onerror: (e) => { stopSession(); setErrorMessage('Connection lost.'); },
          onclose: () => { stopSession(); }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are the Spirit of the Pink Peaks. Conversational, serene, feminine. End responses by verbally repeating the last phrase 2-3 times as an echo. Resonance: ${echoIntensity}%.`
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      setErrorMessage('Mic access denied.');
      setStatus(ConnectionStatus.ERROR);
    }
  };

  useEffect(() => { return () => stopSession(); }, [stopSession]);

  return (
    <div className="relative h-screen w-screen flex flex-col bg-black text-white overflow-hidden selection:bg-pink-500/30">
      <MountainScene />

      {/* iOS Status Bar Area Padding */}
      <div className="h-[env(safe-area-inset-top,44px)] w-full" />

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 flex flex-col px-6">
        {/* iOS Header */}
        <header className="py-6 flex justify-between items-start">
          <div className="space-y-0.5">
            <h1 className="text-3xl font-bold tracking-tight text-white/90">Pink Spirit</h1>
            <p className="text-pink-400 text-sm font-medium uppercase tracking-widest opacity-80">Ancient Echo</p>
          </div>
          <div className="flex space-x-2">
            <div className={`w-2.5 h-2.5 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-white/20'}`} />
          </div>
        </header>

        {/* Visualizer Area */}
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-sm">
            <Visualizer isSpeaking={isSpeaking || isUserTalking} isModelThinking={status === ConnectionStatus.CONNECTING} />
            {history.length > 0 && (
              <div className="mt-8 text-center px-4 animate-in fade-in duration-1000">
                <p className="text-lg font-medium text-pink-100 leading-relaxed">
                  {history[history.length - 1].text}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* iOS Card - Bottom Controls */}
        <div className="mb-[env(safe-area-inset-bottom,20px)] bg-white/10 backdrop-blur-2xl rounded-[38px] p-8 shadow-2xl border border-white/10 space-y-8">
          {/* Settings Section */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white/60 tracking-tight">Echo Depth</span>
              <span className="text-xs font-bold text-pink-400 bg-pink-500/10 px-2.5 py-1 rounded-full border border-pink-500/20">{echoIntensity}%</span>
            </div>
            
            <div className="relative pt-2">
               <input
                type="range"
                min="0"
                max="100"
                value={echoIntensity}
                onChange={(e) => setEchoIntensity(parseInt(e.target.value))}
                className="w-full appearance-none bg-transparent cursor-pointer"
              />
            </div>
          </div>

          {/* iOS Style Action Button */}
          <div className="flex flex-col items-center space-y-4">
            <button
              onClick={status === ConnectionStatus.CONNECTED ? stopSession : startSession}
              className={`w-full py-4.5 rounded-2xl font-bold text-lg transition-all active:scale-[0.98] ${
                status === ConnectionStatus.CONNECTED 
                ? 'bg-white text-black' 
                : 'bg-pink-600 text-white shadow-[0_8px_20px_rgba(219,39,119,0.4)]'
              }`}
            >
              {status === ConnectionStatus.IDLE && "Wake Spirit"}
              {status === ConnectionStatus.CONNECTING && "Connecting..."}
              {status === ConnectionStatus.CONNECTED && "Silence Spirit"}
              {status === ConnectionStatus.ERROR && "Retry"}
            </button>
            
            <p className="text-[11px] font-bold text-white/30 uppercase tracking-[0.2em]">
              {status === ConnectionStatus.CONNECTED ? "Listening to the peaks" : "Tap to begin journey"}
            </p>
          </div>
        </div>

        {/* Home Indicator Spacer */}
        <div className="h-2 w-32 bg-white/20 rounded-full mx-auto mb-2" />
      </div>

      {/* Global Background Overlays */}
      <div className="absolute top-0 inset-x-0 h-40 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
      {errorMessage && (
        <div className="absolute top-12 inset-x-6 z-50 bg-red-500/90 backdrop-blur-xl text-white text-xs font-bold py-3 px-4 rounded-xl text-center shadow-lg border border-red-400/20 animate-in slide-in-from-top-4">
          {errorMessage}
        </div>
      )}
    </div>
  );
};

export default App;
