
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isSpeaking: boolean;
  isModelThinking: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isSpeaking, isModelThinking }) => {
  const bars = Array.from({ length: 40 });
  
  return (
    <div className="flex items-center justify-center gap-1 h-32 w-full max-w-md">
      {bars.map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-300 ${
            isSpeaking 
              ? 'bg-cyan-400 animate-bounce' 
              : isModelThinking 
                ? 'bg-blue-600 animate-pulse' 
                : 'bg-slate-700 h-2'
          }`}
          style={{
            height: isSpeaking ? `${Math.random() * 100 + 20}%` : isModelThinking ? '40%' : '8px',
            animationDelay: `${i * 0.05}s`,
            animationDuration: isSpeaking ? '0.6s' : '1.5s'
          }}
        />
      ))}
    </div>
  );
};
