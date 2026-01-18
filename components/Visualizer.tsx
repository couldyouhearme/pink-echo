
import React from 'react';

interface VisualizerProps {
  isSpeaking: boolean;
  isModelThinking: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isSpeaking, isModelThinking }) => {
  const bars = Array.from({ length: 32 });
  
  return (
    <div className="flex items-center justify-center gap-[3px] h-24 w-full">
      {bars.map((_, i) => (
        <div
          key={i}
          className={`w-[3px] rounded-full transition-all duration-[400ms] ${
            isSpeaking 
              ? 'bg-pink-400' 
              : isModelThinking 
                ? 'bg-white/40' 
                : 'bg-white/10 h-[4px]'
          }`}
          style={{
            height: isSpeaking ? `${Math.max(10, Math.random() * 100)}%` : isModelThinking ? '40%' : '4px',
            opacity: isSpeaking ? 0.6 + Math.random() * 0.4 : 1,
            transform: isSpeaking ? `scaleY(${0.8 + Math.random() * 0.4})` : 'none',
            transitionDelay: `${i * 10}ms`
          }}
        />
      ))}
    </div>
  );
};
